import { error } from '@sveltejs/kit';
import { Effect } from 'effect';
import { runtime } from '#lib/server/runtime.js';
import { SafetyService } from '#lib/server/safety-service.js';
import { safetyActor } from '#lib/server/safety-actor.js';
import type { PageServerLoad } from './$types.js';
export const load: PageServerLoad = async (event) => {
	const actor = safetyActor(event);
	if (!/^[a-f0-9-]{36}$/i.test(event.params.id)) error(404, 'Receipt not found.');
	const result = await runtime.runPromise(
		Effect.gen(function* () {
			return yield* (yield* SafetyService).receipt(event.params.id, actor);
		}).pipe(Effect.result)
	);
	if (result._tag === 'Failure') error(404, 'Receipt not found.');
	return { receipt: result.success };
};
