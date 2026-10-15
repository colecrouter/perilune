import { command, query, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { Effect, Schema, Stream, SubscriptionRef } from 'effect';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
import { ConsoleService } from '#lib/server/console-service.js';
import { runtime, shutdownSignal } from '#lib/server/runtime.js';
const actor = () => {
	const identity = requireIdentity(getRequestEvent(), 'operator');
	return { id: identity.user.id, authorized: () => Boolean(authService!.valid(identity)) };
};
export const getConsole = query.live(async function* () {
	const identity = requireIdentity(getRequestEvent(), 'operator');
	const lease = authService!.watch(identity);
	const signal = AbortSignal.any([
		getRequestEvent().request.signal,
		shutdownSignal.signal,
		lease.signal
	]);
	try {
		const service = await runtime.runPromise(ConsoleService);
		const iterator = Stream.toAsyncIterable(SubscriptionRef.changes(service.state))[
			Symbol.asyncIterator
		]();
		const abort = () => {
			void iterator.return?.();
		};
		signal.addEventListener('abort', abort, { once: true });
		try {
			while (!signal.aborted) {
				const next = await iterator.next();
				if (next.done || signal.aborted) break;
				const pins = await runtime.runPromise(
					service.pins({
						id: identity.user.id,
						authorized: () => Boolean(authService!.valid(identity))
					})
				);
				if (signal.aborted) break;
				yield { ...next.value, pins };
			}
		} finally {
			signal.removeEventListener('abort', abort);
			await iterator.return?.();
		}
	} finally {
		lease.release();
	}
});
export const runConsole = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			id: Schema.String.check(Schema.isUUID()),
			script: Schema.String.check(Schema.isMaxLength(2048))
		})
	),
	async (input) => {
		const current = actor();
		const service = await runtime.runPromise(ConsoleService);
		const result = await runtime.runPromise(
			service.submit(input.id, input.script, current).pipe(Effect.result)
		);
		if (result._tag === 'Failure') error(409, result.failure.message);
		return result.success;
	}
);
export const findConsole = query(
	Schema.toStandardSchemaV1(Schema.String.check(Schema.isUUID())),
	async (id) => {
		const current = actor();
		const service = await runtime.runPromise(ConsoleService);
		const result = await runtime.runPromise(service.find(id, current).pipe(Effect.result));
		if (result._tag === 'Failure') error(409, result.failure.message);
		return result.success;
	}
);
export const pinMacro = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(64)), pinned: Schema.Boolean })
	),
	async (input) => {
		const current = actor();
		const service = await runtime.runPromise(ConsoleService);
		const result = await runtime.runPromise(
			service.pin(input.name, input.pinned, current).pipe(Effect.result)
		);
		if (result._tag === 'Failure') error(409, result.failure.message);
		return { ok: true };
	}
);
