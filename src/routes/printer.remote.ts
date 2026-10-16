import { LiveActionService } from '#lib/server/live-action-service.js';
import { error } from '@sveltejs/kit';
import { submitPrinterAction } from '#lib/server/printer-actions.js';
import { command, getRequestEvent, query } from '$app/server';
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

/** Latest-value queries may coalesce updates: every value is a recoverable snapshot. */
export const getDashboard = query.live(async function* () {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	const lease = authService!.watch(identity);
	const signal = AbortSignal.any([event.request.signal, shutdownSignal.signal, lease.signal]);
	try {
		const printer = await runtime.runPromise(PrinterService);
		const camera = await runtime.runPromise(CameraService);
		const stream = Stream.merge(
			SubscriptionRef.changes(printer.state).pipe(Stream.map(() => null)),
			SubscriptionRef.changes(camera.state).pipe(Stream.map(() => null))
		);
		const iterator = Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
		const abort = () => {
			void iterator.return?.();
		};
		signal.addEventListener('abort', abort, { once: true });
		try {
			while (!signal.aborted) {
				const next = await iterator.next();
				if (next.done || signal.aborted) break;
				const value = await runtime.runPromise(
					Effect.all({
						printer: SubscriptionRef.get(printer.state),
						camera: SubscriptionRef.get(camera.state)
					})
				);
				if (signal.aborted) break;
				yield value;
			}
		} finally {
			signal.removeEventListener('abort', abort);
			await iterator.return?.();
		}
	} finally {
		lease.release();
	}
});
/** History is sampled by the backend; a finite read avoids another held browser connection. */
export const getTemperatureHistory = query(async () => {
	requireIdentity(getRequestEvent());
	const service = await runtime.runPromise(PrinterService);
	return runtime.runPromise(SubscriptionRef.get(service.temperatureHistory));
});

export const submitAction = command(Schema.toStandardSchemaV1(ActionRequest), (request) =>
	submitPrinterAction(getRequestEvent(), request)
);
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

export const recoverLiveAction = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			id: Schema.String.check(Schema.isUUID()),
			confirmed: Schema.Literal(true),
			pausedJob: Schema.optional(Schema.Struct({ filename: Schema.String, runId: Schema.String }))
		})
	),
	async ({ id, pausedJob }) => {
		const identity = requireIdentity(getRequestEvent(), 'owner');
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				return yield* (yield* LiveActionService).recover(
					id,
					{
						id: identity.user.id,
						name: identity.user.name,
						role: identity.user.role,
						authorized: () => Boolean(authService?.valid(identity))
					},
					pausedJob
				);
			}).pipe(Effect.result)
		);
		if (result._tag === 'Failure') error(409, result.failure.message);
	}
);
