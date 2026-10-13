import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Layer, ManagedRuntime } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { registerDevelopmentLifecycle } from 'sveltekit-effect/dev';
import { registerNodeLifecycle } from 'sveltekit-effect/node';
import { createIntegration } from 'sveltekit-effect/server';
import { ActionStoreLive } from './action-store.js';
import { PrinterServiceLive } from './printer-service.js';

const filename = process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite';
mkdirSync(dirname(filename), { recursive: true });
export const runtime = ManagedRuntime.make(
	PrinterServiceLive.pipe(
		Layer.provide(ActionStoreLive),
		Layer.provide(SqliteClient.layer({ filename }))
	)
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
