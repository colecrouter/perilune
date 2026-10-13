import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { registerDevelopmentLifecycle } from 'sveltekit-effect/dev';
import { registerNodeLifecycle } from 'sveltekit-effect/node';
import { createIntegration } from 'sveltekit-effect/server';
import { ActionStoreLive } from './action-store.js';
import { PrinterServiceLive, makePrinterService } from './printer-service.js';
import { MoonrakerConfig, MoonrakerServiceLive } from './moonraker.js';
import { MoonrakerBridgeLive } from './moonraker-bridge.js';

const filename = process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite';
mkdirSync(dirname(filename), { recursive: true });
const moonrakerUrl = process.env.PERILUNE_MOONRAKER_URL?.trim();
if (moonrakerUrl) {
	let url: URL;
	try {
		url = new URL(moonrakerUrl);
	} catch {
		throw new Error('PERILUNE_MOONRAKER_URL must be a valid ws/wss endpoint.');
	}
	if (
		!['ws:', 'wss:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			'PERILUNE_MOONRAKER_URL must be a ws/wss endpoint without credentials, query, or fragment. Use PERILUNE_MOONRAKER_API_KEY for authentication.'
		);
}
const printerLayer = (moonrakerUrl ? makePrinterService('moonraker') : PrinterServiceLive).pipe(
	Layer.provide(ActionStoreLive),
	Layer.provide(SqliteClient.layer({ filename }))
);
const liveServices = Layer.merge(
	printerLayer,
	MoonrakerServiceLive.pipe(
		Layer.provide(
			Layer.succeed(MoonrakerConfig, {
				url: moonrakerUrl ?? '',
				...(process.env.PERILUNE_MOONRAKER_API_KEY
					? { apiKey: process.env.PERILUNE_MOONRAKER_API_KEY }
					: {})
			})
		)
	)
);
export const runtime = ManagedRuntime.make(
	moonrakerUrl ? MoonrakerBridgeLive.pipe(Layer.provideMerge(liveServices)) : printerLayer
);
export const shutdownSignal = new AbortController();
export const integration = createIntegration();
export const requestEffect = integration.effect;
const lifecycle = {
	dispose: async () => {
		shutdownSignal.abort();
		await integration.dispose();
		await runtime.dispose();
	}
};
registerDevelopmentLifecycle(import.meta.hot, lifecycle);
const unregister = registerNodeLifecycle(lifecycle);
import.meta.hot?.dispose(unregister);
