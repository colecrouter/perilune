import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireIdentity } from '#lib/server/auth/index.js';
import { JobService } from '#lib/server/job-service.js';
import { jobOperation, jobUpload } from '#lib/server/job-http.js';
import { runtime } from '#lib/server/runtime.js';
export async function GET(event: RequestEvent) {
	requireIdentity(event);
	const service = await runtime.runPromise(JobService);
	const id = event.url.searchParams.get('id') ?? '';
	switch (event.params.operation) {
		case 'thumbnail': {
			const bytes = await jobOperation(service.thumbnail(id), event);
			requireIdentity(event);
			return new Response(bytes as BodyInit, {
				headers: {
					'Content-Type': 'image/png',
					'X-Content-Type-Options': 'nosniff',
					'Cache-Control': 'no-store'
				}
			});
		}
		default:
			error(404, 'Unknown job operation.');
	}
}
export async function POST(event: RequestEvent) {
	if (event.params.operation === 'upload') return jobUpload(event);
	error(404, 'Unknown job operation.');
}
