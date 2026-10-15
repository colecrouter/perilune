import { error, json } from '@sveltejs/kit';
import { requireIdentity, sameOrigin } from '#lib/server/auth/index.js';
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
	return json({ publicKey: service.publicKey });
};
export const POST = async (event) => {
	sameOrigin(event.request);
	const identity = requireIdentity(event);
	const text = await event.request.text();
	if (text.length > 8192) error(413, 'Notification request is too large.');
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(text);
		if (!body || typeof body !== 'object') throw new Error();
	} catch {
		error(400, 'Invalid notification request.');
	}
	const service = await runtime.runPromise(NotificationService);
	try {
		return json(
			await runtime.runPromise(
				service.manage({ id: identity.user.id, epoch: identity.user.authVersion }, body)
			)
		);
	} catch {
		error(
			400,
			'Could not update notifications. Re-enable notifications or check your preferences and try again. Test messages are limited to one every 30 seconds.'
		);
	}
};
