import { readFileSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import { afterEach, expect, it } from 'vite-plus/test';
import { CameraCompanion } from './camera-companion.js';
const id = `perilune_${'a'.repeat(32)}`;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});
async function fixture(handler: RequestListener) {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Fixture not listening');
	const client = new CameraCompanion(`http://127.0.0.1:${address.port}/`);
	cleanup.push(async () => {
		client.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
	});
	return client;
}
it('registers only a validated endpoint and fixed shared encoding templates', async () => {
	const requests: Array<{ method: string; name: string | null; src: string | null }> = [];
	const client = await fixture((request, response) => {
		const url = new URL(request.url!, 'http://fixture.invalid');
		requests.push({
			method: request.method!,
			name: url.searchParams.get('name'),
			src: url.searchParams.get('src')
		});
		response.end();
	});
	const profiles = await client.prepare(id, {
		kind: 'network',
		name: 'Fixture',
		streamUrl: 'rtsp://camera.example.invalid/video',
		rotation: 0,
		flipHorizontal: false,
		flipVertical: false
	});
	expect(requests).toHaveLength(4);
	expect(requests[0]).toEqual({
		method: 'PATCH',
		name: id,
		src: 'rtsp://camera.example.invalid/video'
	});
	expect(requests[1].src).toBe(`ffmpeg:${id}#video=h264`);
	expect(requests.every((request) => request.method === 'PATCH')).toBe(true);
	expect(profiles['data-saver']).toBe(`${id}_data_saver`);
});
it('cancels a preview body after receiving its initial bytes', async () => {
	let closed = false;
	const client = await fixture((request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4; codecs="avc1.64001f"' });
		response.write(
			readFileSync(new URL('../../../scripts/fixtures/camera/init.mp4', import.meta.url))
		);
		request.on('close', () => {
			closed = true;
		});
	});
	expect(await client.probe(id)).toEqual({ codec: 'H.264', width: 320, height: 180 });
	await expect.poll(() => closed).toBe(true);
});
it('aborts a pending preview when the service stops', async () => {
	let received!: () => void;
	const headers = new Promise<void>((resolve) => {
		received = resolve;
	});
	const client = await fixture((_request, response) => {
		response.writeHead(200, { 'Content-Type': 'video/mp4; codecs="avc1.64001f"' });
		response.flushHeaders();
		received();
	});
	const result = client.probe(id).catch((e) => e.message);
	await headers;
	client.dispose();
	expect(['Camera companion unavailable.', 'Camera did not provide compatible video.']).toContain(
		await result
	);
});
it('rejects redirects and hides private upstream error bodies', async () => {
	const client = await fixture((_request, response) => {
		response.writeHead(302, { Location: 'http://private.example.invalid' });
		response.end('private password');
	});
	await expect(client.probe(id)).rejects.toThrow('Camera did not provide compatible video.');
});
it('rejects directives before making any control request', async () => {
	let requests = 0;
	const client = await fixture((_request, response) => {
		requests++;
		response.end();
	});
	await expect(
		client.prepare(id, {
			kind: 'network',
			name: 'Fixture',
			streamUrl: 'ffmpeg:camera#raw=command',
			rotation: 0,
			flipHorizontal: false,
			flipVertical: false
		})
	).rejects.toThrow();
	await expect(client.probe('ffmpeg:camera')).rejects.toThrow();
	expect(requests).toBe(0);
});

it('remuxes encoded HTTP with a fixed copy template and encodes argument/template characters', async () => {
	const sources: string[] = [];
	const client = await fixture((request, response) => {
		sources.push(new URL(request.url!, 'http://fixture.invalid').searchParams.get('src')!);
		response.end();
	});
	await client.prepare(
		id,
		{
			kind: 'network',
			name: 'HTTP camera',
			streamUrl: 'http://camera.example.invalid/video.mp4?token={output}',
			rotation: 0,
			flipHorizontal: false,
			flipVertical: false
		},
		undefined,
		true
	);
	expect(sources[0]).toBe(
		'ffmpeg:http://camera.example.invalid/video.mp4?token=%7Boutput%7D#video=copy'
	);
	expect(sources[1]).toBe(`ffmpeg:${id}#video=h264`);
});

it('reads local devices only from the private fixed discovery endpoint', async () => {
	const client = await fixture((request, response) => {
		expect(request.url).toBe('/api/v4l2');
		response.end(
			JSON.stringify({
				sources: [
					{
						url: 'v4l2:device?video=/dev/video0&input_format=h264&video_size=1280x720&framerate=30'
					}
				]
			})
		);
	});
	const [candidate] = await client.devices();
	expect(candidate.input.kind).toBe('local');
});
it('treats no devices as empty and rejects oversized discovery responses', async () => {
	const empty = await fixture((_request, response) => {
		response.writeHead(404);
		response.end('no sources');
	});
	expect(await empty.devices()).toEqual([]);
	const huge = await fixture((_request, response) => {
		response.end(' '.repeat(262145));
	});
	await expect(huge.devices()).rejects.toThrow('Local camera discovery unavailable.');
});

it.each([
	['mjpeg', 'mjpeg'],
	['yuyv422', null],
	['nv12', null],
	['h264', null],
	['hevc', null]
])(
	'converts local %s through a shared capture with the appropriate transport',
	async (format, transport) => {
		const sources: string[] = [];
		const client = await fixture((request, response) => {
			sources.push(new URL(request.url!, 'http://fixture.invalid').searchParams.get('src')!);
			response.end();
		});
		const endpoint = `v4l2:device?video=/dev/video0&input_format=${format}&video_size=640x480&framerate=30`;
		await client.prepare(id, {
			kind: 'local',
			name: 'USB fixture',
			streamUrl: endpoint,
			rotation: 0,
			flipHorizontal: false,
			flipVertical: false
		});
		expect(decodeURIComponent(sources[0])).toBe(endpoint);
		const source = transport ? `http://127.0.0.1:1984/api/stream.${transport}?src=${id}` : id;
		expect(sources.slice(1)).toEqual([
			`ffmpeg:${source}#video=h264`,
			`ffmpeg:${source}#video=h264#width=640`,
			`ffmpeg:${source}#video=h264#width=320`
		]);
	}
);
