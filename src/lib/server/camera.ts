import { randomUUID } from 'node:crypto';
import { Context, Effect, Layer, SubscriptionRef } from 'effect';
import type { CameraDescriptor } from '#lib/domain/camera.js';

export interface CameraSettings {
	baseUrl: string;
	source?: string;
	requestTimeoutMs?: number;
	maxBytes?: number;
}
export interface CameraSource {
	source: string;
	name: string;
	rotation?: 0 | 90 | 180 | 270;
	flipHorizontal?: boolean;
	flipVertical?: boolean;
}
export class CameraConfig extends Context.Service<CameraConfig, CameraSettings>()(
	'perilune/CameraConfig'
) {}
export type CameraResource =
	| 'stream.m3u8'
	| 'stream.mp4'
	| 'snapshot'
	| 'playlist.m3u8'
	| 'init.mp4'
	| 'segment.m4s';
export class CameraService extends Context.Service<
	CameraService,
	{
		state: SubscriptionRef.SubscriptionRef<CameraDescriptor>;
		getDescriptor: Effect.Effect<CameraDescriptor>;
		updateSource: (source: CameraSource | null) => Effect.Effect<void>;
		proxy: (resource: CameraResource, request: Request) => Effect.Effect<Response>;
	}
>()('perilune/CameraService') {}
const headers = {
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
	'Cross-Origin-Resource-Policy': 'same-origin'
};
const failure = (status: number) =>
	new Response('Camera temporarily unavailable.', { status, headers });
const sessionTypes = new Set(['playlist.m3u8', 'init.mp4', 'segment.m4s']);
/** Fixed go2rtc endpoints only. No browser-supplied upstream URL, headers, or source. */
export const CameraServiceLive = Layer.effect(
	CameraService,
	Effect.gen(function* () {
		const config = yield* CameraConfig;
		let base: URL | null = null;
		if (config.baseUrl) {
			try {
				base = new URL(config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`);
			} catch {
				throw new Error('Camera base URL must be a valid HTTP(S) endpoint.');
			}
			if (
				!['http:', 'https:'].includes(base.protocol) ||
				base.username ||
				base.password ||
				base.search ||
				base.hash
			)
				throw new Error(
					'Camera base URL must use HTTP(S) without credentials, query, or fragment.'
				);
		}
		const validSource = (value: string) => /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
		if (config.source && !validSource(config.source))
			throw new Error('Camera source must be a registered go2rtc stream name.');
		let source: CameraSource | null = config.source
			? { source: config.source, name: 'Printer camera' }
			: null;
		let generation = 0;
		const active = new Set<AbortController>();
		const sessions = new Map<string, { upstream: string; touched: number }>();
		let disposed = false;
		const abortAll = () => {
			for (const controller of active) controller.abort();
			active.clear();
			sessions.clear();
		};
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				disposed = true;
				abortAll();
			})
		);
		const descriptor = (): CameraDescriptor => ({
			configured: Boolean(base && source),
			generation,
			name: source?.name ?? 'Printer camera',
			streamUrl: base && source ? '/api/camera/stream.m3u8' : null,
			mseUrl: base && source ? '/api/camera/stream.mp4' : null,
			snapshotUrl: base && source ? '/api/camera/snapshot' : null,
			rotation: source?.rotation ?? 0,
			flipHorizontal: source?.flipHorizontal ?? false,
			flipVertical: source?.flipVertical ?? false
		});
		const state = yield* SubscriptionRef.make(descriptor());
		const proxy = async (
			resource: CameraResource,
			request: Request,
			effectSignal: AbortSignal
		): Promise<Response> => {
			if (disposed || !base || !source || active.size >= 16) return failure(503);
			if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return failure(403);
			const query = new URL(request.url).searchParams;
			const allowed = sessionTypes.has(resource)
				? resource === 'segment.m4s'
					? ['session', 'n']
					: ['session']
				: [];
			if (
				[...query.keys()].some((key) => !allowed.includes(key)) ||
				allowed.some((key) => query.getAll(key).length > 1)
			)
				return failure(400);
			const now = Date.now();
			for (const [key, session] of sessions)
				if (now - session.touched > 30_000) sessions.delete(key);
			const upstream = new URL(
				resource === 'snapshot'
					? 'api/frame.jpeg'
					: resource === 'stream.m3u8' || resource === 'stream.mp4'
						? `api/${resource}`
						: `api/hls/${resource}`,
				base
			);
			if (sessionTypes.has(resource)) {
				const session = sessions.get(query.get('session') ?? '');
				if (!session) return failure(404);
				session.touched = now;
				upstream.searchParams.set('id', session.upstream);
				if (resource === 'segment.m4s') {
					const n = query.get('n');
					if (!n || !/^\d{1,12}$/.test(n)) return failure(400);
					upstream.searchParams.set('n', n);
				}
			} else {
				upstream.searchParams.set('src', source.source);
				if (resource === 'stream.m3u8' || resource === 'stream.mp4')
					upstream.searchParams.set('video', 'h264');
			}
			const controller = new AbortController();
			active.add(controller);
			const abort = () => controller.abort();
			request.signal.addEventListener('abort', abort, { once: true });
			effectSignal.addEventListener('abort', abort, { once: true });
			if (request.signal.aborted || effectSignal.aborted) abort();
			let timer = setTimeout(abort, config.requestTimeoutMs ?? 10_000);
			let transferred = false;
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			try {
				const response = await fetch(upstream, {
					signal: controller.signal,
					redirect: 'manual',
					headers: { Accept: resource === 'snapshot' ? 'image/jpeg' : '*/*' }
				});
				if (!response.ok || !response.body) return failure(response.status === 404 ? 404 : 502);
				const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
				const playlist = resource.endsWith('.m3u8');
				if (
					playlist
						? !['application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(type ?? '')
						: resource === 'snapshot'
							? type !== 'image/jpeg'
							: !['video/mp4', 'video/iso.segment', 'application/octet-stream'].includes(type ?? '')
				)
					return failure(502);
				reader = response.body.getReader();
				if (resource === 'stream.mp4') {
					const mime = response.headers.get('content-type') ?? '';
					const codec = /^video\/mp4\s*;\s*codecs="(avc1\.[0-9a-f]{6})"$/i.exec(mime)?.[1];
					if (!codec || controller.signal.aborted) return failure(502);
					const upstreamReader = reader;
					let ended = false;
					let output: ReadableStreamDefaultController<Uint8Array>;
					const finish = (error?: Error) => {
						if (ended) return;
						ended = true;
						clearTimeout(timer);
						request.signal.removeEventListener('abort', abort);
						effectSignal.removeEventListener('abort', abort);
						controller.signal.removeEventListener('abort', onAbort);
						controller.abort();
						active.delete(controller);
						void upstreamReader.cancel().catch(() => {});
						if (error) output.error(error);
					};
					const onAbort = () => finish(new Error('Camera stream interrupted.'));
					controller.signal.addEventListener('abort', onAbort, { once: true });
					const body = new ReadableStream<Uint8Array>(
						{
							start(streamController) {
								output = streamController;
							},
							async pull(streamController) {
								if (ended) return;
								clearTimeout(timer);
								timer = setTimeout(abort, config.requestTimeoutMs ?? 10_000);
								try {
									const { value, done } = await upstreamReader.read();
									if (ended) return;
									if (done) {
										finish();
										streamController.close();
										return;
									}
									if (value.byteLength > Math.min(config.maxBytes ?? 256 * 1024, 256 * 1024)) {
										finish(new Error('Camera stream chunk exceeds limit.'));
										return;
									}
									streamController.enqueue(value);
									clearTimeout(timer);
									timer = setTimeout(abort, config.requestTimeoutMs ?? 10_000);
								} catch {
									finish(new Error('Camera stream interrupted.'));
								}
							},
							cancel() {
								finish();
							}
						},
						{ highWaterMark: 0 }
					);
					transferred = true;
					return new Response(body, {
						headers: {
							...headers,
							'Content-Type': `video/mp4; codecs="${codec.toLowerCase()}"`,
							'X-Accel-Buffering': 'no'
						}
					});
				}
				const chunks: Uint8Array[] = [];
				let length = 0;
				const limit = playlist ? 64 * 1024 : (config.maxBytes ?? 8 * 1024 * 1024);
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					length += value.byteLength;
					if (length > limit) return failure(502);
					chunks.push(value);
				}
				if (controller.signal.aborted) return failure(504);
				const bytes = new Uint8Array(length);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				if (!playlist)
					return new Response(bytes, {
						headers: { ...headers, 'Content-Type': type!, 'Content-Length': String(length) }
					});
				const text = new TextDecoder().decode(bytes);
				if (!text.startsWith('#EXTM3U')) return failure(502);
				const rewrite = (uri: string) => {
					const resolved = new URL(uri, upstream);
					const expected = new URL('api/hls/', base!);
					const filename = resolved.pathname.slice(expected.pathname.length);
					if (
						resolved.origin !== expected.origin ||
						!resolved.pathname.startsWith(expected.pathname) ||
						!sessionTypes.has(filename) ||
						resolved.hash ||
						resolved.username ||
						resolved.password
					)
						throw new Error('Unsupported playlist URI');
					if ([...resolved.searchParams.keys()].some((key) => !['id', 'n'].includes(key)))
						throw new Error('Unsupported playlist query');
					const id = resolved.searchParams.get('id');
					if (!id || !/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Error('Invalid camera session');
					let token = [...sessions.entries()].find(([, session]) => session.upstream === id)?.[0];
					if (!token) {
						if (sessions.size >= 64) throw new Error('Too many camera sessions');
						token = randomUUID();
						sessions.set(token, { upstream: id, touched: now });
					}
					const local = new URLSearchParams({ session: token });
					if (filename === 'segment.m4s') {
						const n = resolved.searchParams.get('n');
						if (!n || !/^\d{1,12}$/.test(n)) throw new Error('Invalid segment');
						local.set('n', n);
					}
					return `/api/camera/${filename}?${local}`;
				};
				if (/URI=(?!")/.test(text)) return failure(502);
				const rewritten = text
					.split('\n')
					.map((line) =>
						line.startsWith('#')
							? line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${rewrite(uri)}"`)
							: line.trim()
								? rewrite(line.trim())
								: line
					)
					.join('\n');
				return new Response(rewritten, {
					headers: { ...headers, 'Content-Type': 'application/vnd.apple.mpegurl' }
				});
			} catch {
				return failure(controller.signal.aborted ? 504 : 502);
			} finally {
				if (!transferred) {
					clearTimeout(timer);
					request.signal.removeEventListener('abort', abort);
					effectSignal.removeEventListener('abort', abort);
					controller.abort();
					active.delete(controller);
					await reader?.cancel().catch(() => {});
				}
			}
		};
		return {
			state,
			getDescriptor: SubscriptionRef.get(state),
			updateSource: (next) =>
				Effect.gen(function* () {
					if (next && !validSource(next.source))
						throw new Error('Camera source must be a registered go2rtc stream name.');
					const selected = config.source
						? { ...next, source: config.source, name: next?.name ?? 'Printer camera' }
						: next;
					if (JSON.stringify(source) !== JSON.stringify(selected)) {
						source = selected;
						generation++;
						abortAll();
						yield* SubscriptionRef.set(state, descriptor());
					}
				}),
			proxy: (resource, request) => Effect.promise((signal) => proxy(resource, request, signal))
		};
	})
);
