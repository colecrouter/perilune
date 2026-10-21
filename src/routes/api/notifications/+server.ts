import { error } from '@sveltejs/kit';
import { requireIdentity } from '#lib/server/auth/index.js';
import { runtime } from '#lib/server/runtime.js';
import { NotificationService } from '#lib/server/notification-service.js';
export const GET = async (event) => {
	const identity = requireIdentity(event);
	const service = await runtime.runPromise(NotificationService);
	const image = event.url.searchParams.get('image');
	if (image) {
		const result = await runtime.runPromise(
			service.image({ id: identity.user.id, epoch: identity.user.authVersion }, image)
		);
		if (!result) error(404, 'Snapshot expired or unavailable.');
		return new Response(new Uint8Array(result.bytes), {
			headers: {
				'Content-Type': result.mime,
				'Cache-Control': 'no-store',
				'Cross-Origin-Resource-Policy': 'same-origin'
			}
		});
	}
	error(404, 'Choose a notification image.');
};
