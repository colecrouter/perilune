import { Effect, SubscriptionRef } from 'effect';
import { JobService } from '#lib/server/job-service.js';
import { readActionBody } from '#lib/server/action-body.js';
import { ActionStore } from '#lib/server/action-store.js';
import { runtime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types.js';
export const load: PageServerLoad = async (event) => {
	requireIdentity(event, 'operator');
	const intent = event.url.searchParams.get('intent');
	if (intent === 'cancel')
		return {
			review: {
				intent,
				filename: (event.url.searchParams.get('filename') ?? '').slice(0, 1024),
				runId: (event.url.searchParams.get('runId') ?? '').slice(0, 128),
				fileId: '',
				name: ''
			}
		};
	if (intent === 'start') {
		const fileId = event.url.searchParams.get('fileId') ?? '';
		if (!/^(?:[a-f0-9-]{36}|[a-f0-9]{64})$/i.test(fileId)) return { review: null };
		const store = await runtime.runPromise(ActionStore);
		const file =
			fileId.length === 64
				? await runtime.runPromise(
						Effect.gen(function* () {
							const jobs = yield* JobService;
							if (jobs.refresh) yield* jobs.refresh;
							return (yield* SubscriptionRef.get(jobs.state)).files.find(
								(file) => file.id === fileId
							);
						}).pipe(Effect.catch(() => Effect.succeed(undefined)))
					)
				: await runtime.runPromise(store.jobFile(fileId));
		if (file) return { review: { intent, fileId, name: file.name, filename: '', runId: '' } };
	}
	return { review: null };
};
import { fail, isHttpError, redirect } from '@sveltejs/kit';
import { sameOrigin, requireIdentity } from '#lib/server/auth/index.js';
import { parseActionForm } from '#lib/domain/action-form.js';
import { submitPrinterAction } from '#lib/server/printer-actions.js';
import type { Actions } from './$types.js';
export const actions: Actions = {
	default: async (event) => {
		sameOrigin(event.request);
		requireIdentity(event, 'operator');

		const data = await readActionBody(event.request);
		let request;
		try {
			request = parseActionForm(data);
		} catch {
			return fail(400, { message: 'Check the action fields. No action was submitted.' });
		}
		let receipt;
		try {
			receipt = await submitPrinterAction(event, request);
		} catch (cause) {
			if (isHttpError(cause)) return fail(cause.status, { message: cause.body.message });
			throw cause;
		}
		if (event.request.headers.get('x-sveltekit-action') === 'true') return { receipt };
		redirect(303, `/actions/${receipt.id}`);
	}
};
