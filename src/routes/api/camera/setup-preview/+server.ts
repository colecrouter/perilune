import { error, type RequestEvent } from '@sveltejs/kit';
import { Effect } from 'effect';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
import { CameraSetupService } from '#lib/server/camera-setup-service.js';
import { runtime } from '#lib/server/runtime.js';
export async function GET(event: RequestEvent) {
	const identity = requireIdentity(event, 'owner');
	const token = event.url.searchParams.get('token');
	if (!token || !/^[a-f0-9-]{36}$/.test(token) || event.url.searchParams.size !== 1)
		error(400, 'Choose a valid camera preview.');
	const lease = authService!.watch(identity);
	try {
		const service = await runtime.runPromise(CameraSetupService);
		// The token is scoped to the owner session; upstream receives no browser query.
		const request = new Request(new URL('/api/camera/snapshot', event.url), {
			signal: AbortSignal.any([event.request.signal, lease.signal])
		});
		const response = await runtime.runPromise(
			service
				.preview(identity.session.id, token, request)
				.pipe(Effect.orElseSucceed(() => new Response(null, { status: 404 })))
		);
		if (!response.ok) {
			await response.body?.cancel();
			return new Response('Snapshot preview unavailable.', {
				status: response.status,
				headers: { 'Cache-Control': 'no-store' }
			});
		}
		const bytes = await response.arrayBuffer();
		requireIdentity(event, 'owner');
		return new Response(bytes, {
			headers: {
				'Content-Type': 'image/jpeg',
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff',
				'Cross-Origin-Resource-Policy': 'same-origin'
			}
		});
	} finally {
		lease.release();
	}
}
