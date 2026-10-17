import { fail, redirect } from '@sveltejs/kit';
import { Effect, SubscriptionRef } from 'effect';
import { sameOrigin } from '#lib/server/auth/index.js';
import { safetyActor } from '#lib/server/safety-actor.js';
import { runtime } from '#lib/server/runtime.js';
import { PrinterService } from '#lib/server/printer-service.js';
import { SafetyService } from '#lib/server/safety-service.js';
import { readActionBody } from '#lib/server/action-body.js';
import { parseSafetyForm } from '#lib/domain/safety.js';
import type { Actions, PageServerLoad } from './$types.js';
export const load: PageServerLoad = async (event) => {
	safetyActor(event);
	const snapshot = await runtime.runPromise(
		Effect.gen(function* () {
			return yield* SubscriptionRef.get((yield* PrinterService).state);
		})
	);
	const intent = event.url.searchParams.get('intent');
	return {
		snapshot,
		intent: ['stop', 'cooldown', 'emergency', 'review', 'abortProbe', 'restart'].includes(
			intent ?? ''
		)
			? intent!
			: 'emergency'
	};
};
export const actions: Actions = {
	default: async (event) => {
		sameOrigin(event.request);
		const actor = safetyActor(event),
			data = await readActionBody(event.request);
		const service = await runtime.runPromise(SafetyService);
		if (['review', 'acknowledge', 'verify'].includes(String(data.get('intent')))) {
			const id = data.get('actionId');
			if (
				data.getAll('intent').length !== 1 ||
				data.getAll('actionId').length !== 1 ||
				typeof id !== 'string' ||
				!/^[a-f0-9-]{36}$/i.test(id) ||
				data.getAll('confirmed').length !== 1 ||
				data.get('confirmed') !== 'true'
			)
				return fail(400, { message: 'Confirm the safety review.' });
			const operation =
				data.get('intent') === 'acknowledge'
					? service.acknowledge
					: data.get('intent') === 'verify'
						? service.verify
						: service.review;
			const result = await runtime.runPromise(operation(id, actor).pipe(Effect.result));
			if (result._tag === 'Failure') return fail(409, { message: result.failure.message });
			if (
				event.request.headers.get('x-sveltekit-action') === 'true' &&
				data.get('intent') !== 'review'
			)
				return { recoveryUpdated: true };
			redirect(303, '/');
		}
		let request;
		try {
			request = parseSafetyForm(data);
		} catch {
			return fail(400, { message: 'Check and confirm the safety action. Nothing was submitted.' });
		}
		const result = await runtime.runPromise(service.submit(request, actor).pipe(Effect.result));
		if (result._tag === 'Failure') return fail(409, { message: result.failure.message });
		if (event.request.headers.get('x-sveltekit-action') === 'true')
			return { receipt: result.success };
		redirect(303, `/safety/${result.success.id}`);
	}
};
