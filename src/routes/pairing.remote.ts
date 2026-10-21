import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
const attempts = new Map<string, { count: number; expires: number }>();
const text = Schema.String.check(Schema.isMaxLength(1024));
export const pairBrowser = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			operation: Schema.Literals(['start', 'cancel', 'poll', 'inspect', 'approve']),
			name: Schema.optional(text),
			token: Schema.optional(text),
			code: Schema.optional(text),
			approve: Schema.optional(Schema.Boolean),
			integrationId: Schema.optional(text)
		})
	),
	async (body) => {
		const event = getRequestEvent();
		const now = Date.now();
		for (const [ip, value] of attempts) if (value.expires <= now) attempts.delete(ip);
		const polling = body.operation === 'poll';
		const ip = `${polling ? 'poll' : 'action'}:${event.getClientAddress()}`;
		const entry = attempts.get(ip) ?? { count: 0, expires: now + 60_000 };
		if (entry.count >= (polling ? 600 : 30) || (!attempts.has(ip) && attempts.size >= 1000))
			error(429, 'Too many pairing attempts. Wait a minute and try again.');
		entry.count++;
		attempts.set(ip, entry);
		try {
			switch (body.operation) {
				case 'start':
					if (body.name === undefined) error(400, 'Name this browser.');
					return authService!.startPairing(body.name);
				case 'cancel':
					if (body.token === undefined) error(400, 'Invalid pairing request.');
					authService!.cancelPairing(body.token);
					return { ok: true };
				case 'poll': {
					if (body.token === undefined) error(400, 'Invalid pairing request.');
					const cookie = await authService!.redeemPairing(body.token);
					if (cookie)
						event.cookies.set(cookie.name, cookie.value, {
							httpOnly: true,
							secure: cookie.attributes.secure,
							sameSite: 'lax',
							maxAge: cookie.attributes.maxAge,
							path: '/'
						});
					return { approved: Boolean(cookie) };
				}
				case 'inspect':
					requireIdentity(event);
					if (body.code === undefined) error(400, 'Enter the pairing code.');
					return { request: authService!.pairingRequest(body.code) ?? null };
				case 'approve':
					if (body.code === undefined || body.approve === undefined)
						error(400, 'Invalid approval.');
					authService!.approvePairing(
						requireIdentity(event),
						body.code,
						body.approve,
						body.integrationId
					);
					return { ok: true };
			}
		} catch (cause) {
			if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
			error(400, cause instanceof Error ? cause.message : 'Pairing failed.');
		}
	}
);
