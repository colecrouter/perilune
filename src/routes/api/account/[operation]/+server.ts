import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
import { roles, type Role } from '#lib/server/auth/service.js';
export async function GET(event: RequestEvent) {
	if (event.params.operation === 'status') return json({ setup: authService!.needsSetup() });
	if (event.params.operation === 'browsers') {
		const identity = requireIdentity(event);
		return json({
			browsers: authService!
				.browsers(identity.user.id)
				.map((browser) => ({ ...browser, current: browser.id === identity.session.id }))
		});
	}
	requireIdentity(event, 'owner');
	if (event.params.operation !== 'manage') error(404, 'Unknown account action.');
	return json({ accounts: authService!.accounts(), invitations: authService!.invitations() });
}
export async function POST(event: RequestEvent) {
	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid request.');
	}
	try {
		if (event.params.operation === 'enroll') {
			if (!['token', 'name', 'email', 'password'].every((key) => typeof body[key] === 'string'))
				error(400, 'Complete every field.');
			await authService!.enroll(
				body as { token: string; name: string; email: string; password: string }
			);
			return json({ ok: true });
		}
		if (event.params.operation === 'disconnect-integration' && typeof body.id === 'string') {
			authService!.disconnectIntegration(requireIdentity(event, 'operator').user.id, body.id);
			return json({ ok: true });
		}
		if (event.params.operation === 'revoke-browser' && typeof body.id === 'string') {
			authService!.revokeBrowser(requireIdentity(event).user.id, body.id);
			return json({ ok: true });
		}
		const identity = requireIdentity(event, 'owner');
		if (event.params.operation === 'invite') {
			if (!roles.includes(body.role as Role)) error(400, 'Choose a valid role.');
			return json({
				url: authService!.invite(
					identity.user.id,
					body.role as Role,
					typeof body.email === 'string' ? body.email : undefined
				)
			});
		}
		if (event.params.operation === 'revoke-invite' && typeof body.hash === 'string')
			authService!.revokeInvite(identity.user.id, body.hash);
		else if (event.params.operation === 'revoke-account' && typeof body.id === 'string')
			authService!.revokeAccount(identity.user.id, body.id);
		else error(404, 'Unknown account action.');
		return json({ ok: true });
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(
			400,
			event.params.operation === 'enroll'
				? 'Could not create this account. Check your details and enrollment token.'
				: cause instanceof Error
					? cause.message
					: 'Account action failed.'
		);
	}
}
