import { query, getRequestEvent } from '$app/server';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
export const getAccess = query(() => {
	const identity = requireIdentity(getRequestEvent());
	return {
		recovery: authService!.recoveryStatus(identity.user.id),
		accounts:
			identity.user.role === 'owner'
				? (authService!.accounts() as unknown as Array<{
						id: string;
						name: string;
						email: string;
						role: string;
					}>)
				: [],
		invitations:
			identity.user.role === 'owner'
				? (authService!.invitations() as unknown as Array<{
						hash: string;
						role: string;
						expires: number;
						claimed: number | null;
						email: string | null;
						revoked: number;
					}>)
				: []
	};
});
