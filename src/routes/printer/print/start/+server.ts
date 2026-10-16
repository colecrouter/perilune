import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { JobService } from '#lib/server/job-service.js';
import { runtime } from '#lib/server/runtime.js';

/** Native slicer keys grant uploads only; never dispatch physical work here. */
export async function POST(event: RequestEvent) {
	const token = event.request.headers.get('X-Api-Key');
	if (!token) error(401, 'Supply a Perilune upload key. Start jobs from the Perilune Jobs page.');
	const jobs = await runtime.runPromise(JobService);
	if (!(await runtime.runPromise(jobs.validateKey(token))))
		error(401, 'Invalid or expired upload key.');
	return json(
		{
			error: {
				code: 403,
				message:
					'This key allows uploads only. Choose Upload only in your slicer, then review and start the uploaded file in Perilune Jobs.'
			}
		},
		{ status: 403 }
	);
}
