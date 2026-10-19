import { error, json, type RequestEvent } from '@sveltejs/kit';
import { Effect } from 'effect';
import { authService, requireIdentity, sameOrigin } from '#lib/server/auth/index.js';
import { readBoundedBody } from '#lib/server/action-body.js';
import { CameraSetupService, CameraSetupError } from '#lib/server/camera-setup-service.js';
import { cameraCandidates, cameraSetupSnapshot } from '#lib/server/camera-setup-read.js';
import { runtime } from '#lib/server/runtime.js';
export async function GET(event: RequestEvent) {
	requireIdentity(event, 'owner');
	const settings = await cameraSetupSnapshot();
	requireIdentity(event, 'owner');
	return json(settings, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(event: RequestEvent) {
	const identity = requireIdentity(event, 'owner');
	sameOrigin(event.request);
	const bytes = await readBoundedBody(event.request, 8192);
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
	} catch {
		error(400, 'Enter valid camera settings.');
	}
	const service = await runtime.runPromise(CameraSetupService);
	const actor = identity.session.id;
	const lease = authService!.watch(identity);
	try {
		let operation: Effect.Effect<unknown, Error>;
		if (body.operation === 'test') {
			let input = body.input;
			if (typeof body.localCandidate === 'string') {
				const devices = await runtime.runPromise(
					service.devices(AbortSignal.any([event.request.signal, lease.signal]))
				);
				const selected = devices.find((item) => item.id === body.localCandidate);
				if (!selected) error(409, 'This local camera is no longer available. Scan again.');
				input = selected.input;
			} else if ((input as { kind?: unknown })?.kind === 'local')
				error(400, 'Choose a detected local camera.');
			else if (typeof body.candidate === 'string') {
				const candidate = (await cameraCandidates()).find((item) => item.id === body.candidate);
				if (!candidate) error(409, 'The discovered camera changed. Refresh and choose it again.');
				input = candidate.input;
			}
			operation = service.test(actor, input, AbortSignal.any([event.request.signal, lease.signal]));
		} else if (body.operation === 'save' && typeof body.token === 'string') {
			operation = service.save(actor, body.token, () => {
				try {
					requireIdentity(event, 'owner');
					return true;
				} catch {
					return false;
				}
			});
		} else if (body.operation === 'reset' && Number.isSafeInteger(body.revision)) {
			operation = service.reset(Number(body.revision), () => {
				try {
					requireIdentity(event, 'owner');
					return true;
				} catch {
					return false;
				}
			});
		} else error(400, 'Choose a camera setup action.');
		const result = await runtime.runPromise(
			operation.pipe(
				Effect.match({
					onSuccess: (value) => ({ ok: true as const, value }),
					onFailure: (cause) => ({
						ok: false as const,
						message:
							cause instanceof CameraSetupError
								? cause.message
								: 'Camera settings could not be saved. Try again.'
					})
				})
			)
		);
		requireIdentity(event, 'owner');
		if (!result.ok) error(400, result.message);
		return json(result.value, { headers: { 'Cache-Control': 'no-store' } });
	} finally {
		lease.release();
	}
}
