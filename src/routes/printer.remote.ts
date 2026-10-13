import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { Effect, Schema, Stream, SubscriptionRef } from 'effect';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
import { ActionRequest } from '#lib/domain/printer.js';
import { CameraService } from '#lib/server/camera.js';
import { PrinterService } from '#lib/server/printer-service.js';
import { requestEffect, runtime, shutdownSignal } from '#lib/server/runtime.js';

export const getPrinter = query.live(async function* () {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	const lease = authService!.watch(identity);
	const signal = AbortSignal.any([event.request.signal, shutdownSignal.signal, lease.signal]);
	try {
		const service = await runtime.runPromise(PrinterService);
		// Live iteration has its own request abort scope; never use a request runner for its lifetime.
		const stream = SubscriptionRef.changes(service.state);
		const iterable = Stream.toAsyncIterable(stream);
		const iterator = iterable[Symbol.asyncIterator]();
		const abort = () => {
			void iterator.return?.();
		};
		signal.addEventListener('abort', abort, { once: true });
		try {
			while (!signal.aborted) {
				const next = await iterator.next();
				if (next.done || signal.aborted) break;
				yield next.value;
			}
		} finally {
			signal.removeEventListener('abort', abort);
			await iterator.return?.();
		}
	} finally {
		lease.release();
	}
});

export const getCamera = query.live(async function* () {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	const lease = authService!.watch(identity);
	const signal = AbortSignal.any([event.request.signal, shutdownSignal.signal, lease.signal]);
	try {
		const service = await runtime.runPromise(CameraService);
		// Live iteration has its own request abort scope; never use a request runner for its lifetime.
		const stream = SubscriptionRef.changes(service.state);
		const iterable = Stream.toAsyncIterable(stream);
		const iterator = iterable[Symbol.asyncIterator]();
		const abort = () => {
			void iterator.return?.();
		};
		signal.addEventListener('abort', abort, { once: true });
		try {
			while (!signal.aborted) {
				const next = await iterator.next();
				if (next.done || signal.aborted) break;
				yield next.value;
			}
		} finally {
			signal.removeEventListener('abort', abort);
			await iterator.return?.();
		}
	} finally {
		lease.release();
	}
});

export const submitAction = command(Schema.toStandardSchemaV1(ActionRequest), async (request) => {
	requireIdentity(getRequestEvent(), 'operator');
	const result = await requestEffect(
		Effect.promise(() =>
			runtime.runPromise(
				Effect.flatMap(PrinterService, (service) => service.submit(request)).pipe(Effect.result)
			)
		)
	);
	if (result._tag === 'Failure') error(409, result.failure.message);
	return result.success;
});
export const setSimulatorConnection = command(
	Schema.toStandardSchemaV1(Schema.Boolean),
	requestEffect.handler((connected) => {
		requireIdentity(getRequestEvent(), 'operator');
		return Effect.promise(() =>
			runtime.runPromise(
				Effect.flatMap(PrinterService, (service) => service.setConnection(connected))
			)
		);
	})
);
export const resetSimulator = command(
	requestEffect.handler(() => {
		requireIdentity(getRequestEvent(), 'operator');
		return Effect.promise(() =>
			runtime.runPromise(Effect.flatMap(PrinterService, (service) => service.reset))
		);
	})
);
