import { error, type RequestEvent } from '@sveltejs/kit';
import { Effect, SubscriptionRef } from 'effect';
import { authService, requireIdentity } from './auth/index.js';
import { PrinterService } from './printer-service.js';
import { LiveMeshService } from './live-mesh-service.js';
import { runtime } from './runtime.js';
import type { ActionRequest } from '#lib/domain/printer.js';
/** Forms and interactive commands enter the same process-owned queue. */
export async function submitPrinterAction(event: RequestEvent, request: ActionRequest) {
	const identity = requireIdentity(event, 'operator');
	const actor = {
		id: identity.user.id,
		name: identity.user.name,
		role: identity.user.role,
		authorized: () =>
			Boolean(authService?.valid(identity)) && ['owner', 'operator'].includes(identity.user.role)
	};
	const result = await runtime.runPromise(
		Effect.gen(function* () {
			const service = yield* PrinterService;
			const snapshot = yield* SubscriptionRef.get(service.state);
			return yield* snapshot.mode === 'moonraker'
				? (yield* LiveMeshService).submit(request, actor)
				: service.submit(request, actor);
		}).pipe(Effect.result)
	);
	if (result._tag === 'Failure') error(409, result.failure.message);
	return result.success;
}
