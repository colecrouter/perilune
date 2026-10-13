import { Effect } from 'effect';
import type { RequestEvent } from '@sveltejs/kit';
import { CameraService, type CameraResource } from '#lib/server/camera.js';
import { runtime } from '#lib/server/runtime.js';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
const resources = new Set<CameraResource>([
	'stream.m3u8',
	'stream.mp4',
	'snapshot',
	'playlist.m3u8',
	'init.mp4',
	'segment.m4s'
]);
export async function GET(event: RequestEvent) {
	const identity = requireIdentity(event);
	if (!resources.has(event.params.resource as CameraResource))
		return new Response('Not found.', { status: 404 });
	const lease = authService!.watch(identity);
	const controller = new AbortController();
	const signal = AbortSignal.any([event.request.signal, lease.signal, controller.signal]);
	try {
		const request = new Request(event.request, { signal });
		const response = await runtime.runPromise(
			Effect.flatMap(CameraService, (service) =>
				service.proxy(event.params.resource as CameraResource, request)
			)
		);
		if (!response.body) {
			lease.release();
			return response;
		}
		const reader = response.body.getReader();
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			lease.release();
			signal.removeEventListener('abort', abort);
		};
		const abort = () => {
			void reader
				.cancel()
				.catch(() => {})
				.finally(finish);
		};
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		const body = new ReadableStream<Uint8Array>(
			{
				async pull(output) {
					try {
						const next = await reader.read();
						if (next.done || signal.aborted) {
							finish();
							output.close();
						} else output.enqueue(next.value);
					} catch (cause) {
						finish();
						output.error(cause);
					}
				},
				async cancel() {
					controller.abort();
					await reader.cancel().catch(() => {});
					finish();
				}
			},
			{ highWaterMark: 0 }
		);
		return new Response(body, { status: response.status, headers: response.headers });
	} catch (cause) {
		lease.release();
		controller.abort();
		throw cause;
	}
}
