import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { Effect, SubscriptionRef } from 'effect';
import { authService, requireIdentity, sameOrigin } from './auth/index.js';
import { JobService } from './job-service.js';
import { runtime, shutdownSignal } from './runtime.js';
export async function jobUpload(event: RequestEvent, slicer = false) {
	const service = await runtime.runPromise(JobService);
	const token = event.request.headers.get('X-Api-Key');
	let identity;
	if (slicer && token) {
		if (!(await runtime.runPromise(service.validateKey(token))))
			error(401, 'Invalid or expired upload key.');
	} else {
		identity = requireIdentity(event, 'operator');
		sameOrigin(event.request);
	}
	const releaseUpload = await jobOperation(service.beginUpload);
	const lease = identity ? authService!.watch(identity) : null;
	const signal = AbortSignal.any([
		event.request.signal,
		shutdownSignal.signal,
		...(lease ? [lease.signal] : [])
	]);
	try {
		const state = await runtime.runPromise(SubscriptionRef.get(service.state));
		if (process.env.PERILUNE_MOONRAKER_URL?.trim() && process.env.PERILUNE_LIVE_CONTROLS !== 'true')
			error(409, 'Live files are read-only on this server.');
		if (!state.available) error(503, 'File library is unavailable.');
		const bytes = await runtime.runPromise(service.readBody(event.request, signal), { signal });
		const contentType = event.request.headers.get('content-type') ?? '';
		let name: string;
		let content: Uint8Array;
		if (contentType.startsWith('multipart/form-data')) {
			let form: FormData;
			try {
				form = await new Response(bytes as BodyInit, {
					headers: { 'Content-Type': contentType }
				}).formData();
			} catch {
				error(400, 'Invalid file upload.');
			}
			if (
				!['', 'false', '0'].includes((form.get('print') as string) ?? 'false') ||
				!['', 'false', '0'].includes((form.get('start_print') as string) ?? 'false')
			)
				error(409, 'Upload and print is disabled. Upload only, then review the job in Perilune.');
			if (form.get('path') || (form.get('root') && form.get('root') !== 'gcodes'))
				error(400, 'Upload to the G-code library without a subfolder.');
			const file = form.get('file');
			if (!(file instanceof File)) error(400, 'Choose one G-code file.');
			if (form.getAll('file').length !== 1) error(400, 'Upload one file at a time.');
			name = file.name;
			content = new Uint8Array(await file.arrayBuffer());
		} else {
			name = event.url.searchParams.get('name') ?? '';
			content = bytes;
		}
		if (signal.aborted) error(401, 'Upload authorization ended.');
		if (identity) requireIdentity(event, 'operator');
		else if (!token || !(await runtime.runPromise(service.validateKey(token))))
			error(401, 'Upload key was revoked.');
		const authorized = identity
			? Effect.sync(
					() =>
						!signal.aborted &&
						Boolean(authService!.valid(identity!)) &&
						['owner', 'operator'].includes(identity!.user.role)
				)
			: service.validateKey(token!).pipe(Effect.map((valid) => valid && !signal.aborted));
		const file = await runtime.runPromise(service.upload(name, content, authorized), { signal });
		return slicer
			? json({
					item: {
						path: file.name,
						root: 'gcodes',
						size: file.size,
						modified: file.modified / 1000
					},
					print_started: false,
					print_queued: false,
					action: 'create_file'
				})
			: json({ file });
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(
			400,
			cause instanceof Error && cause.name === 'JobError'
				? cause.message
				: 'Upload outcome is uncertain. Refresh the library before taking another action.'
		);
	} finally {
		lease?.release();
		releaseUpload();
	}
}
export async function jobOperation<A>(
	effect: Effect.Effect<A, unknown>,
	event?: RequestEvent
): Promise<A> {
	const identity = event ? requireIdentity(event) : undefined;
	const lease = identity ? authService!.watch(identity) : null;
	const signal = AbortSignal.any([
		shutdownSignal.signal,
		...(event ? [event.request.signal] : []),
		...(lease ? [lease.signal] : [])
	]);
	let result;
	try {
		result = await runtime.runPromise(effect.pipe(Effect.result), { signal });
		if (event) requireIdentity(event);
	} catch {
		error(409, 'Job operation interrupted. Retry if needed.');
	} finally {
		lease?.release();
	}
	if (result._tag === 'Failure')
		error(
			409,
			result.failure instanceof Error && result.failure.name === 'JobError'
				? result.failure.message
				: 'Job operation failed.'
		);
	return result.success;
}
