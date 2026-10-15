import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { Effect } from 'effect';
import { authService, requireIdentity } from './auth/index.js';
import { ConfigurationError, ConfigurationService, type ConfigActor } from './config-service.js';
import type { ConfigurationApplicationService } from './config-application-service.js';
import { runtime } from './runtime.js';
export function configActor(event: RequestEvent): ConfigActor {
	const identity = requireIdentity(event, 'owner');
	return {
		id: identity.user.id,
		name: identity.user.name,
		authorized: () => Boolean(authService?.valid(identity)) && identity.user.role === 'owner'
	};
}
export async function configResult<A>(
	event: RequestEvent,
	effect: Effect.Effect<
		A,
		ConfigurationError,
		ConfigurationService | ConfigurationApplicationService
	>
) {
	const result = await runtime.runPromise(effect.pipe(Effect.result), {
		signal: event.request.signal
	});
	if (result._tag === 'Failure') error(409, result.failure.message);
	return result.success;
}
export async function configBody(request: Request) {
	const reader = request.body?.getReader();
	if (!reader) error(400, 'A configuration save request is required.');
	const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
	let rejectRead: (reason: Error) => void = () => {};
	const aborted = new Promise<never>((_, reject) => {
		rejectRead = reject;
	});
	const abort = () =>
		rejectRead(new Error('Configuration request body timed out or was cancelled.'));
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) abort();
	let length = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (true) {
			const part = await Promise.race([reader.read(), aborted]).catch(() =>
				error(408, 'Configuration request body timed out or was cancelled.')
			);
			if (part.done) break;
			length += part.value.length;
			if (length > 2 * 1024 * 1024) error(413, 'Configuration save request is too large.');
			chunks.push(part.value);
		}
	} finally {
		signal.removeEventListener('abort', abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
	} catch {
		error(400, 'Use a JSON configuration save request.');
	}
}
