import { SubscriptionRef } from 'effect';
import { isHttpError } from '@sveltejs/kit';
import { parseJobQuery, queryJobCatalog } from '#lib/domain/job-query.js';
import { JobService } from '#lib/server/job-service.js';
import { jobOperation } from '#lib/server/job-http.js';
import { requireIdentity } from '#lib/server/auth/index.js';
import { runtime } from '#lib/server/runtime.js';
import type { LayoutServerLoad } from './$types.js';
export const load: LayoutServerLoad = async (event) => {
	requireIdentity(event);
	event.depends('perilune:jobs');
	const service = await runtime.runPromise(JobService);
	const id = event.params.id;
	const before = await jobOperation(SubscriptionRef.get(service.state), event);
	let selected = before.files.find((file) => file.id === id) ?? null;
	let inspectionError: string | null = null;
	if (selected && !selected.metadata) {
		try {
			selected = await jobOperation(service.inspect(selected.id), event);
		} catch (cause) {
			if (!isHttpError(cause) || cause.status !== 409) throw cause;
			inspectionError = cause.body.message;
		}
	}
	const catalog = await jobOperation(SubscriptionRef.get(service.state), event);
	selected = catalog.files.find((file) => file.id === id) ?? null;
	return {
		catalog: queryJobCatalog(catalog, parseJobQuery(event.url.searchParams)),
		selected,
		missingFile: Boolean(id && !selected),
		inspectionError
	};
};
