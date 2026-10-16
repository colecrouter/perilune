import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { Effect } from 'effect';
import { JobService } from '#lib/server/job-service.js';
import { slicerStart } from '#lib/server/slicer-http.js';
import { sameOrigin } from '#lib/server/auth/index.js';
import { runtime } from '#lib/server/runtime.js';

export async function POST(event: RequestEvent) {
	if (event.request.headers.has('Origin')) sameOrigin(event.request);
	const token = event.request.headers.get('X-Api-Key');
	if (!token) error(401, 'Supply a Perilune slicer key.');
	const jobs = await runtime.runPromise(JobService);
	const key = await runtime.runPromise(jobs.printKey(token));
	if (!key) error(401, 'Invalid or expired slicer key.');
	if (!key.canPrint)
		return json(
			{
				error: {
					code: 403,
					message:
						'This key allows uploads only. Create an upload-and-print key in Perilune Jobs, or choose Upload only in your slicer.'
				}
			},
			{ status: 403 }
		);
	const bytes = await runtime.runPromise(
		jobs.readBody(event.request, event.request.signal, 4096).pipe(Effect.result)
	);
	if (bytes._tag === 'Failure') error(400, 'Invalid print request.');
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes.success));
	} catch {
		error(400, 'Invalid print request.');
	}
	if (
		!body ||
		typeof body !== 'object' ||
		!('filename' in body) ||
		typeof body.filename !== 'string'
	)
		error(400, 'Supply a G-code filename.');
	const receipt = await slicerStart(token, body.filename, event.request.signal);
	if (receipt instanceof Response) return receipt;
	return json({ result: 'ok', perilune: { receiptId: receipt.id, status: receipt.status } });
}
