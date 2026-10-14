import { authService } from './auth/index.js';
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
import { CameraConfig, CameraServiceLive } from './camera.js';
import { JobServiceLive, JobsConfig } from './job-service.js';
import { WebcamBridgeLive } from './webcam-discovery.js';

const filename = process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite';
mkdirSync(dirname(filename), { recursive: true });
const cameraBaseUrl = process.env.PERILUNE_CAMERA_BASE_URL?.trim() ?? '';
const cameraSource = process.env.PERILUNE_CAMERA_SOURCE?.trim();
const cameraLayer = CameraServiceLive.pipe(
	Layer.provide(
		Layer.succeed(CameraConfig, {
			baseUrl: cameraBaseUrl,
			...(cameraSource ? { source: cameraSource } : {})
		})
	)
);
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
const liveServices = Layer.mergeAll(
	printerLayer,
	cameraLayer,
	MoonrakerServiceLive.pipe(
		Layer.provide(
			Layer.succeed(MoonrakerConfig, {
				url: moonrakerUrl ?? '',
				discoverWebcams: Boolean(cameraBaseUrl && !cameraSource),
				...(process.env.PERILUNE_MOONRAKER_API_KEY
					? { apiKey: process.env.PERILUNE_MOONRAKER_API_KEY }
					: {})
			})
		)
	)
);
const coreLayer = moonrakerUrl
	? Layer.merge(MoonrakerBridgeLive, WebcamBridgeLive).pipe(Layer.provideMerge(liveServices))
	: Layer.merge(printerLayer, cameraLayer);
const jobsLayer = JobServiceLive.pipe(
	Layer.provide(
		Layer.succeed(JobsConfig, {
			moonrakerUrl: moonrakerUrl ?? '',
			apiKey: process.env.PERILUNE_MOONRAKER_API_KEY,
			checkUser: (id, epoch) => {
				const user = authService?.db
					.prepare('SELECT role, authVersion FROM user WHERE id=?')
					.get(id) as { role: string; authVersion: number } | undefined;
				return Boolean(
					user && ['owner', 'operator'].includes(user.role) && user.authVersion === epoch
				);
			}
		})
	),
	Layer.provide(SqliteClient.layer({ filename })),
	Layer.provideMerge(coreLayer)
);
export const runtime = ManagedRuntime.make(jobsLayer);
export const shutdownSignal = new AbortController();
export const integration = createIntegration();
export const requestEffect = integration.effect;
const lifecycle = {
	dispose: async () => {
		shutdownSignal.abort();
		authService?.close();
		await integration.dispose();
		await runtime.dispose();
	}
};
registerDevelopmentLifecycle(import.meta.hot, lifecycle);
const unregister = registerNodeLifecycle(lifecycle);
import.meta.hot?.dispose(unregister);
