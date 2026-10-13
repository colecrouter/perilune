import { Effect } from 'effect';
import { CameraService, type CameraResource } from '#lib/server/camera.js';
import { runtime } from '#lib/server/runtime.js';

const resources = new Set<CameraResource>([
	'stream.m3u8',
	'stream.mp4',
	'snapshot',
	'playlist.m3u8',
	'init.mp4',
	'segment.m4s'
]);
export async function GET({ params, request }: { params: { resource: string }; request: Request }) {
	if (!resources.has(params.resource as CameraResource))
		return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
	return runtime.runPromise(
		Effect.flatMap(CameraService, (service) =>
			service.proxy(params.resource as CameraResource, request)
		)
	);
}
