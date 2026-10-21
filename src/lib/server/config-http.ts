import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { Effect } from 'effect';
import { authService, requireIdentity } from './auth/index.js';
import { ConfigurationError, ConfigurationService, type ConfigActor } from './config-service.js';
import type { ConfigurationApplicationService } from './config-application-service.js';
import { runtime } from './runtime.js';
export function configActor(event: RequestEvent): ConfigActor {
	const identity = requireIdentity(event, 'owner');
	return {
		id: identity.user.id,
		name: identity.user.name,
		authorized: () => Boolean(authService?.valid(identity)) && identity.user.role === 'owner'
	};
}
export async function configResult<A>(
	event: RequestEvent,
	effect: Effect.Effect<
		A,
		ConfigurationError,
		ConfigurationService | ConfigurationApplicationService
	>
) {
	const result = await runtime.runPromise(effect.pipe(Effect.result), {
		signal: event.request.signal
	});
	if (result._tag === 'Failure') error(409, result.failure.message);
	return result.success;
}
