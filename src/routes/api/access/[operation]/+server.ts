import { error, json } from '@sveltejs/kit';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
import type { RequestHandler } from './$types.js';
export const POST: RequestHandler = async (event) => {
	const service = authService!;
	if (!service.publicLimit(event.getClientAddress()))
		error(429, 'Too many requests. Wait before trying again.');
	const body = await event.request.text();
	if (body.length > 4096) error(413, 'Request is too large.');
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(body);
		if (!value || typeof value !== 'object') throw Error();
	} catch {
		error(400, 'Invalid request.');
	}
	const token = typeof value.token === 'string' ? value.token : '';
	try {
		switch (event.params.operation) {
			case 'invitation':
				return json(service.invitationInfo(token));
			case 'request-reset': {
				const email = typeof value.email === 'string' ? value.email : '';
				if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
					error(400, 'Enter a valid email address.');
				const started = Date.now();
				try {
					service.requestReset(email, event.getClientAddress());
				} catch {
					/* Keep public recovery responses independent of account/storage state. */
				}
				await new Promise((resolve) =>
					setTimeout(resolve, Math.max(0, 200 - (Date.now() - started)))
				);
				return json({
					message:
						'If this account has a verified recovery address, a reset link will be sent. Check your inbox or contact the host.'
				});
			}
			case 'reset': {
				if (typeof value.password !== 'string') error(400, 'Choose a new password.');
				await service.resetPassword(token, value.password);
				return json({
					message:
						'Password updated. Sign in again. Browser sessions were signed out; passkeys and integrations were preserved.'
				});
			}
			case 'verify':
				service.verifyEmail(token);
				return json({
					message: 'Recovery email verified. You can now request password resets by email.'
				});
			case 'request-verification':
				service.requestVerification(requireIdentity(event).user.id);
				return json({
					message:
						'Verification email queued. Open the link and confirm the address within 30 minutes.'
				});
			case 'test':
				service.testMail(requireIdentity(event, 'owner').user.id);
				return json({
					message:
						'Test email queued. Acceptance status appears below; inbox delivery depends on your mail server.'
				});
			default:
				error(404, 'Unknown account action.');
		}
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(400, cause instanceof Error ? cause.message : 'Account action failed.');
	}
};
