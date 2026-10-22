import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { command, query, getRequestEvent } from '$app/server';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
export const getAccess = query(() => {
	const identity = requireIdentity(getRequestEvent());
	return {
		recovery: authService!.recoveryStatus(identity.user.id),
		resetLinks: identity.user.role === 'owner' ? authService!.ownerResetStatus(identity) : null,
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

const textId = Schema.toStandardSchemaV1(
	Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
);
function mutation<A>(run: () => A): A {
	try {
		return run();
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(400, cause instanceof Error ? cause.message : 'Account action failed.');
	}
}
export const inviteAccount = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			role: Schema.Literals(['owner', 'operator', 'viewer']),
			email: Schema.optional(Schema.String.check(Schema.isMaxLength(254)))
		})
	),
	(input) => {
		const identity = requireIdentity(getRequestEvent(), 'owner');
		return mutation(() => ({
			url: authService!.invite(identity.user.id, input.role, input.email)
		}));
	}
);
export const revokeAccount = command(textId, (id) => {
	const identity = requireIdentity(getRequestEvent(), 'owner');
	mutation(() => authService!.revokeAccount(identity.user.id, id));
});
export const revokeInvitation = command(textId, (hash) => {
	const identity = requireIdentity(getRequestEvent(), 'owner');
	mutation(() => authService!.revokeInvite(identity.user.id, hash));
});
export const requestRecoveryVerification = command(() => {
	const identity = requireIdentity(getRequestEvent());
	mutation(() => authService!.requestVerification(identity.user.id));
	return {
		message: 'Verification email queued. Open the link and confirm the address within 30 minutes.'
	};
});
export const sendTestEmail = command(() => {
	const identity = requireIdentity(getRequestEvent(), 'owner');
	mutation(() => authService!.testMail(identity.user.id));
	return {
		message:
			'Test email queued. Acceptance status appears below; inbox delivery depends on your mail server.'
	};
});

export const createOwnerReset = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			target: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
			confirmed: Schema.Literal(true)
		})
	),
	(input) => {
		const identity = requireIdentity(getRequestEvent(), 'owner');
		return mutation(() => authService!.createOwnerReset(identity, input.target, input.confirmed));
	}
);
export const revokeOwnerReset = command(textId, (id) => {
	const identity = requireIdentity(getRequestEvent(), 'owner');
	mutation(() => authService!.revokeOwnerReset(identity, id));
});
