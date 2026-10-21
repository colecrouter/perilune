import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { authService } from '#lib/server/auth/index.js';
const text = Schema.String.check(Schema.isMaxLength(4096));
const input = Schema.toStandardSchemaV1(
	Schema.Struct({
		operation: Schema.Literals(['invitation', 'request-reset', 'reset', 'verify', 'enroll']),
		token: Schema.optional(text),
		name: Schema.optional(text),
		email: Schema.optional(text),
		password: Schema.optional(text)
	})
);
export const accountEntry = command(input, async (value) => {
	const event = getRequestEvent();
	const service = authService!;
	if (!service.publicLimit(event.getClientAddress()))
		error(429, 'Too many requests. Wait before trying again.');
	try {
		switch (value.operation) {
			case 'invitation':
				return service.invitationInfo(value.token ?? '');
			case 'enroll': {
				if (
					value.token === undefined ||
					value.name === undefined ||
					value.email === undefined ||
					value.password === undefined
				)
					error(400, 'Complete every field.');
				await service.enroll({
					token: value.token,
					name: value.name,
					email: value.email,
					password: value.password
				});
				return { ok: true };
			}
			case 'request-reset': {
				const email = value.email ?? '';
				if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
					error(400, 'Enter a valid email address.');
				const started = Date.now();
				try {
					service.requestReset(email, event.getClientAddress());
				} catch {
					/* Avoid account enumeration. */
				}
				await new Promise((resolve) =>
					setTimeout(resolve, Math.max(0, 200 - (Date.now() - started)))
				);
				return {
					message:
						'If this account has a verified recovery address, a reset link will be sent. Check your inbox or contact the host.'
				};
			}
			case 'reset':
				await service.resetPassword(value.token ?? '', value.password ?? '');
				return {
					message:
						'Password updated. Sign in again. Browser sessions were signed out; passkeys and integrations were preserved.'
				};
			case 'verify':
				service.verifyEmail(value.token ?? '');
				return {
					message: 'Recovery email verified. You can now request password resets by email.'
				};
		}
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(
			400,
			value.operation === 'enroll'
				? 'Could not create this account. Check your details and enrollment token.'
				: cause instanceof Error
					? cause.message
					: 'Account action failed.'
		);
	}
});
