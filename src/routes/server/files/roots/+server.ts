import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { JobService } from '#lib/server/job-service.js';
import { requireIdentity } from '#lib/server/auth/index.js';
import { runtime } from '#lib/server/runtime.js';
export async function GET(event: RequestEvent) {
	const token = event.request.headers.get('X-Api-Key');
	if (token) {
		const service = await runtime.runPromise(JobService);
		if (!(await runtime.runPromise(service.validateKey(token)))) error(401, 'Invalid upload key.');
	} else requireIdentity(event);
	return json({
		result: [
			{ name: 'gcodes', permissions: process.env.PERILUNE_MOONRAKER_URL?.trim() ? 'r' : 'rw' }
		]
	});
}
