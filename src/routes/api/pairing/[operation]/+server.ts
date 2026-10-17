import { readBoundedBody } from '#lib/server/action-body.js';
import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authService, requireIdentity, sameOrigin } from '#lib/server/auth/index.js';

const attempts = new Map<string, { count: number; expires: number }>();
export async function POST(event: RequestEvent) {
	sameOrigin(event.request);
	const now = Date.now();
	for (const [ip, value] of attempts) if (value.expires <= now) attempts.delete(ip);
	const polling = event.params.operation === 'poll';
	const ip = `${polling ? 'poll' : 'action'}:${event.getClientAddress()}`;
	const entry = attempts.get(ip) ?? { count: 0, expires: now + 60_000 };
	if (entry.count >= (polling ? 600 : 30) || (!attempts.has(ip) && attempts.size >= 1000))
		error(429, 'Too many pairing attempts. Wait a minute and try again.');
	entry.count++;
	attempts.set(ip, entry);
	if (Number(event.request.headers.get('content-length')) > 2048) error(413, 'Request too large.');
	const text = new TextDecoder().decode(await readBoundedBody(event.request, 2048));
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, 'Invalid pairing request.');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body))
		error(400, 'Invalid pairing request.');
	try {
		switch (event.params.operation) {
			case 'start':
				if (typeof body.name !== 'string') error(400, 'Name this browser.');
				return json(authService!.startPairing(body.name));
			case 'cancel':
				if (typeof body.token !== 'string') error(400, 'Invalid pairing request.');
				authService!.cancelPairing(body.token);
				return json({ ok: true });
			case 'poll': {
				if (typeof body.token !== 'string') error(400, 'Invalid pairing request.');
				const cookie = await authService!.redeemPairing(body.token);
				if (cookie)
					event.cookies.set(cookie.name, cookie.value, {
						httpOnly: true,
						secure: cookie.attributes.secure,
						sameSite: 'lax',
						maxAge: cookie.attributes.maxAge,
						path: '/'
					});
				return json({ approved: Boolean(cookie) });
			}
			case 'inspect':
				requireIdentity(event);
				if (typeof body.code !== 'string') error(400, 'Enter the pairing code.');
				return json({ request: authService!.pairingRequest(body.code) ?? null });
			case 'approve':
				if (typeof body.code !== 'string' || typeof body.approve !== 'boolean')
					error(400, 'Invalid approval.');
				authService!.approvePairing(
					requireIdentity(event),
					body.code,
					body.approve,
					typeof body.integrationId === 'string' ? body.integrationId : undefined
				);
				return json({ ok: true });
			default:
				error(404, 'Unknown pairing operation.');
		}
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(400, cause instanceof Error ? cause.message : 'Pairing failed.');
	}
}
