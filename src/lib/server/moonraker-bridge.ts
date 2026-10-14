import { Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { MoonrakerService } from './moonraker.js';
import { PrinterService } from './printer-service.js';

/** One subscription per process; browsers consume the shared printer snapshot. */
export const MoonrakerBridgeLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const moonraker = yield* MoonrakerService;
		const printer = yield* PrinterService;
		yield* SubscriptionRef.changes(moonraker.state).pipe(
			Stream.runForEach((telemetry) =>
				printer.ingest({
					connection: telemetry.connection,
					klippy: telemetry.klippy,
					telemetryAt: telemetry.updatedAt,
					telemetryReady: telemetry.telemetryReady,
					availableObjects: telemetry.availableObjects,
					job:
						telemetry.updatedAt === null ? { ...telemetry.job, state: 'unknown' } : telemetry.job,
					heaters: telemetry.heaters,
					motion: telemetry.motion,
					bedMesh: telemetry.bedMesh,
					additionalTemperatures: telemetry.additionalTemperatures
				})
			),
			Effect.forkScoped
		);
	})
);
