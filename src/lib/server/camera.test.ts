import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Layer, ManagedRuntime } from 'effect';
import { CameraConfig, CameraService, CameraServiceLive, type CameraSettings } from './camera.js';

const runtimes: Array<ReturnType<typeof makeRuntime>> = [];
function makeRuntime(settings: Partial<CameraSettings> = {}) {
	return ManagedRuntime.make(
		CameraServiceLive.pipe(
			Layer.provide(
				Layer.succeed(CameraConfig, {
					baseUrl: 'http://camera.invalid/',
					source: 'printer',
					...settings
				})
			)
		)
	);
}
async function service(settings: Partial<CameraSettings> = {}) {
	const runtime = makeRuntime(settings);
	runtimes.push(runtime);
	return { runtime, camera: await runtime.runPromise(CameraService) };
}
const request = (query = '', signal?: AbortSignal) =>
	new Request(`http://perilune.invalid/api/camera/stream.m3u8${query}`, { signal });
const playlist = (text: string) =>
	new Response(text, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
const master =
	'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=192000,CODECS="avc1.640029"\nhls/playlist.m3u8?id=ABC123';
afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe('same-origin camera gateway', () => {
	it('rewrites master, init and segments to opaque local session routes', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(playlist(master))
			.mockResolvedValueOnce(
				playlist(
					'#EXTM3U\n#EXT-X-MAP:URI="init.mp4?id=ABC123"\n#EXTINF:0.500,\nsegment.m4s?id=ABC123&n=2'
				)
			);
		vi.stubGlobal('fetch', fetcher);
		const { runtime, camera } = await service();
		const response = await runtime.runPromise(camera.proxy('stream.m3u8', request()));
		const text = await response.text();
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(text).not.toContain('ABC123');
		const local = text.split('\n').at(-1)!;
		expect(local).toMatch(/^\/api\/camera\/playlist.m3u8\?session=/);
		const child = await runtime.runPromise(
			camera.proxy('playlist.m3u8', new Request(`http://perilune.invalid${local}`))
		);
		expect(await child.text()).toContain('/api/camera/init.mp4?session=');
		expect(fetcher.mock.calls[0]![0].toString()).toBe(
			'http://camera.invalid/api/stream.m3u8?src=printer&video=h264'
		);
	});
	it('rejects client sources, unknown sessions and invalid segment numbers without fetching', async () => {
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		const { runtime, camera } = await service();
		expect(
			(await runtime.runPromise(camera.proxy('stream.m3u8', request('?src=other')))).status
		).toBe(400);
		expect(
			(await runtime.runPromise(camera.proxy('playlist.m3u8', request('?session=arbitrary'))))
				.status
		).toBe(404);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each([
		'https://private.invalid/api/hls/playlist.m3u8?id=ABC123',
		'hls/playlist.m3u8?id=ABC123&src=other',
		'hls/../stream.mp4?id=ABC123'
	])('rejects unsafe playlist URL %s', async (uri) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(playlist(`#EXTM3U\n${uri}`)));
		const { runtime, camera } = await service();
		expect((await runtime.runPromise(camera.proxy('stream.m3u8', request()))).status).toBe(502);
	});
	it('does not follow redirects or disclose upstream failures/headers', async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response('private credentials', {
				status: 302,
				headers: { Location: 'http://private.invalid/', 'Set-Cookie': 'private=secret' }
			})
		);
		vi.stubGlobal('fetch', fetcher);
		const { runtime, camera } = await service();
		const response = await runtime.runPromise(camera.proxy('snapshot', request()));
		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain('private');
		expect(response.headers.get('Location')).toBeNull();
		expect(response.headers.get('Set-Cookie')).toBeNull();
		expect(fetcher.mock.calls[0]![1].redirect).toBe('manual');
	});
	it('serves JPEG bytes with only safe response headers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(new Uint8Array([255, 216, 255]), {
					headers: {
						'Content-Type': 'image/jpeg',
						'Set-Cookie': 'secret=hidden',
						'Access-Control-Allow-Origin': '*'
					}
				})
			)
		);
		const { runtime, camera } = await service();
		const response = await runtime.runPromise(camera.proxy('snapshot', request()));
		expect(response.status).toBe(200);
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([255, 216, 255]);
		expect(response.headers.get('Content-Length')).toBe('3');
		expect(response.headers.get('Set-Cookie')).toBeNull();
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
	it('rejects dynamic upstream inputs as registered sources', async () => {
		const { runtime, camera } = await service({ source: undefined });
		await expect(
			runtime.runPromise(camera.updateSource({ source: 'rtsp://private.invalid', name: 'Invalid' }))
		).rejects.toThrow('registered go2rtc stream name');
	});
	it('caps buffered media and rejects incorrect content types', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(
					new Response('too large', { headers: { 'Content-Type': 'image/jpeg' } })
				)
				.mockResolvedValueOnce(new Response('html', { headers: { 'Content-Type': 'text/html' } }))
		);
		const { runtime, camera } = await service({ maxBytes: 3 });
		for (let i = 0; i < 2; i++)
			expect((await runtime.runPromise(camera.proxy('snapshot', request()))).status).toBe(502);
	});
	it('refreshes source generation and invalidates old media sessions', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(playlist(master)));
		const { runtime, camera } = await service({ source: undefined });
		await runtime.runPromise(camera.updateSource({ source: 'first', name: 'First' }));
		const masterResponse = await runtime.runPromise(camera.proxy('stream.m3u8', request()));
		const local = (await masterResponse.text()).split('\n').at(-1)!;
		await runtime.runPromise(camera.updateSource({ source: 'second', name: 'Second' }));
		expect((await runtime.runPromise(camera.getDescriptor)).generation).toBe(2);
		expect(
			(
				await runtime.runPromise(
					camera.proxy('playlist.m3u8', new Request(`http://perilune.invalid${local}`))
				)
			).status
		).toBe(404);
	});
	it.each(['request', 'effect', 'shutdown', 'source', 'timeout'])(
		'aborts in-flight upstream fetch on %s',
		async (reason) => {
			let started!: () => void;
			const ready = new Promise<void>((resolve) => {
				started = resolve;
			});
			let upstreamSignal: AbortSignal | undefined;
			vi.stubGlobal(
				'fetch',
				vi.fn(
					(_url, init) =>
						new Promise((_resolve, reject) => {
							upstreamSignal = init.signal;
							started();
							upstreamSignal!.addEventListener('abort', () => reject(new Error('aborted')), {
								once: true
							});
						})
				)
			);
			const { runtime, camera } = await service({
				source: undefined,
				requestTimeoutMs: reason === 'timeout' ? 20 : 1000
			});
			await runtime.runPromise(camera.updateSource({ source: 'first', name: 'First' }));
			const controller = new AbortController();
			const invocation = new AbortController();
			const response = runtime.runPromise(
				camera.proxy('stream.m3u8', request('', controller.signal)),
				{ signal: invocation.signal }
			);
			await ready;
			if (reason === 'request') controller.abort();
			if (reason === 'effect') {
				const rejected = expect(response).rejects.toThrow();
				invocation.abort();
				await rejected;
				expect(upstreamSignal?.aborted).toBe(true);
				expect(controller.signal.aborted).toBe(false);
				return;
			}
			if (reason === 'shutdown') {
				const rejected = expect(response).rejects.toThrow();
				await runtime.dispose();
				await rejected;
				expect(upstreamSignal?.aborted).toBe(true);
				return;
			}
			if (reason === 'source') await runtime.runPromise(camera.updateSource(null));
			expect((await response).status).toBe(504);
			expect(upstreamSignal?.aborted).toBe(true);
		}
	);
	it('sanitizes malformed base URL failures', async () => {
		const runtime = makeRuntime({ baseUrl: 'private invalid hostname and secret' });
		runtimes.push(runtime);
		await expect(runtime.runPromise(CameraService)).rejects.toThrow(
			'Camera base URL must be a valid HTTP(S) endpoint.'
		);
		await expect(runtime.runPromise(CameraService)).rejects.not.toThrow('secret');
	});
	it('exposes no camera URLs without configured base and source', async () => {
		const { runtime, camera } = await service({ baseUrl: '' });
		expect(await runtime.runPromise(camera.getDescriptor)).toMatchObject({
			configured: false,
			streamUrl: null,
			snapshotUrl: null
		});
	});
});

describe('continuous MSE camera output', () => {
	const media = (body: ReadableStream<Uint8Array>, mime = 'video/mp4; codecs="avc1.640029"') =>
		new Response(body, { headers: { 'Content-Type': mime } });
	it('forwards sanitized codec metadata, disables buffering, and reads only on demand', async () => {
		let reads = 0;
		const cancel = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				media(
					new ReadableStream(
						{
							pull(controller) {
								reads++;
								controller.enqueue(new Uint8Array([1, 2, 3]));
							},
							cancel
						},
						{ highWaterMark: 0 }
					)
				)
			)
		);
		const { runtime, camera } = await service();
		const response = await runtime.runPromise(camera.proxy('stream.mp4', request()));
		expect(response.headers.get('Content-Type')).toBe('video/mp4; codecs="avc1.640029"');
		expect(response.headers.get('X-Accel-Buffering')).toBe('no');
		expect(reads).toBe(0);
		const reader = response.body!.getReader();
		expect([...(await reader.read()).value!]).toEqual([1, 2, 3]);
		expect(reads).toBe(1);
		await reader.cancel();
		expect(cancel).toHaveBeenCalledOnce();
	});
	it.each([
		'video/mp4',
		'video/mp4; codecs="hvc1.private"',
		'video/mp4; codecs="avc1.640029";secret=private'
	])('rejects unsafe or unsupported MIME %s', async (mime) => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				media(
					new ReadableStream({
						start(controller) {
							controller.close();
						}
					}),
					mime
				)
			)
		);
		const { runtime, camera } = await service();
		expect((await runtime.runPromise(camera.proxy('stream.mp4', request()))).status).toBe(502);
	});
	it('bounds upstream chunks and cleans up instead of buffering an unlimited stream', async () => {
		const cancel = vi.fn();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				media(
					new ReadableStream(
						{
							pull(controller) {
								controller.enqueue(new Uint8Array(256 * 1024 + 1));
							},
							cancel
						},
						{ highWaterMark: 0 }
					)
				)
			)
		);
		const { runtime, camera } = await service();
		const response = await runtime.runPromise(camera.proxy('stream.mp4', request()));
		await expect(response.body!.getReader().read()).rejects.toThrow('exceeds limit');
		expect(cancel).toHaveBeenCalledOnce();
	});
	it.each(['body', 'request', 'source', 'shutdown', 'inactivity'])(
		'closes a returned continuous stream on %s',
		async (reason) => {
			const cancel = vi.fn();
			let signal: AbortSignal | undefined;
			vi.stubGlobal(
				'fetch',
				vi.fn((_url, init) => {
					signal = init.signal;
					return Promise.resolve(media(new ReadableStream({ cancel }, { highWaterMark: 0 })));
				})
			);
			const { runtime, camera } = await service({
				source: undefined,
				requestTimeoutMs: reason === 'inactivity' ? 20 : 1000
			});
			await runtime.runPromise(camera.updateSource({ source: 'printer', name: 'Camera' }));
			const client = new AbortController();
			const response = await runtime.runPromise(
				camera.proxy('stream.mp4', request('', client.signal))
			);
			const reader = response.body!.getReader();
			const pending = reader.read();
			const settled =
				reason === 'body'
					? expect(pending).resolves.toMatchObject({ done: true })
					: expect(pending).rejects.toThrow('interrupted');
			if (reason === 'body') await reader.cancel();
			if (reason === 'request') client.abort();
			if (reason === 'source') await runtime.runPromise(camera.updateSource(null));
			if (reason === 'shutdown') await runtime.dispose();
			await settled;
			expect(signal?.aborted).toBe(true);
			expect(cancel).toHaveBeenCalledOnce();
		}
	);
	it('renews inactivity timeout across an ongoing stream instead of expiring its total lifetime', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				media(
					new ReadableStream(
						{
							async pull(controller) {
								await new Promise((resolve) => setTimeout(resolve, 20));
								controller.enqueue(new Uint8Array([1]));
							}
						},
						{ highWaterMark: 0 }
					)
				)
			)
		);
		const { runtime, camera } = await service({ requestTimeoutMs: 50 });
		const response = await runtime.runPromise(camera.proxy('stream.mp4', request()));
		const reader = response.body!.getReader();
		for (let i = 0; i < 4; i++) expect((await reader.read()).value).toEqual(new Uint8Array([1]));
		await reader.cancel();
	});
	it('retains the active request limit until streamed bodies close', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(media(new ReadableStream({}, { highWaterMark: 0 }))))
		);
		const { runtime, camera } = await service();
		const responses = [];
		for (let i = 0; i < 16; i++)
			responses.push(await runtime.runPromise(camera.proxy('stream.mp4', request())));
		expect((await runtime.runPromise(camera.proxy('stream.mp4', request()))).status).toBe(503);
		await responses[0]!.body!.cancel();
		const next = await runtime.runPromise(camera.proxy('stream.mp4', request()));
		expect(next.status).toBe(200);
		await Promise.all([...responses.slice(1), next].map((response) => response.body!.cancel()));
	});
});
