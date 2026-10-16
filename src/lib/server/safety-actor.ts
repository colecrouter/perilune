import type { RequestEvent } from '@sveltejs/kit';
import { authService, requireIdentity } from './auth/index.js';
export function safetyActor(event: RequestEvent) {
	const identity = requireIdentity(event, 'operator');
	return {
		id: identity.user.id,
		name: identity.user.name,
		role: identity.user.role,
		authorized: () =>
			Boolean(authService?.valid(identity)) && ['owner', 'operator'].includes(identity.user.role)
	};
}
