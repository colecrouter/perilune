import { json } from '@sveltejs/kit';
import { Effect } from 'effect';
import { SlicerService } from './slicer-service.js';
import { runtime } from './runtime.js';

export async function slicerStart(token: string, filename: string, signal: AbortSignal) {
	const service = await runtime.runPromise(SlicerService);
	const result = await runtime.runPromise(service.start(token, filename).pipe(Effect.result), {
		signal
	});
	if (result._tag === 'Failure')
		return json(
			{ error: { code: result.failure.status, message: result.failure.message } },
			{ status: result.failure.status }
		);
	return result.success;
}
