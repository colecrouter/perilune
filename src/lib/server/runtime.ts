import { PreferenceServiceLive } from './preference-service.js';
import { SafetyServiceLive, SafetySettings, SafetyDisabled } from './safety-service.js';
import {
	LiveActionServiceLive,
	LiveActionSettings,
	LiveActionDisabled
} from './live-action-service.js';
import { SlicerServiceLive } from './slicer-service.js';
import { ConsoleServiceLive } from './console-service.js';
import { NotificationServiceLive, NotificationSettings } from './notification-service.js';
import {
	ConfigurationApplicationServiceLive,
	ConfigurationApplicationSettings
} from './config-application-service.js';
import { ConfigurationServiceLive, ConfigurationSettings } from './config-service.js';
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
import { LiveMeshServiceLive, LiveMeshDisabled } from './live-mesh-service.js';
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
const databaseLayer = SqliteClient.layer({ filename });
const actionStoreLayer = ActionStoreLive.pipe(Layer.provide(databaseLayer));
const printerLayer = (moonrakerUrl ? makePrinterService('moonraker') : PrinterServiceLive).pipe(
	Layer.provideMerge(actionStoreLayer)
);
const moonrakerConfigLayer = Layer.succeed(MoonrakerConfig, {
	url: moonrakerUrl ?? '',
	discoverWebcams: Boolean(cameraBaseUrl && !cameraSource),
	liveMeshEnabled: process.env.PERILUNE_LIVE_MESH === 'true',
	liveControlsEnabled: process.env.PERILUNE_LIVE_CONTROLS === 'true',
	pidCalibrationEnabled:
		process.env.PERILUNE_LIVE_PID === 'true' && process.env.PERILUNE_LIVE_CONTROLS === 'true',
	...(process.env.PERILUNE_MOONRAKER_API_KEY
		? { apiKey: process.env.PERILUNE_MOONRAKER_API_KEY }
		: {})
});
const liveServices = Layer.mergeAll(
	printerLayer,
	cameraLayer,
	MoonrakerServiceLive.pipe(Layer.provide(moonrakerConfigLayer))
);
const coreLayer = moonrakerUrl
	? Layer.merge(MoonrakerBridgeLive, WebcamBridgeLive).pipe(Layer.provideMerge(liveServices))
	: Layer.merge(printerLayer, cameraLayer);
const safetyLayer = moonrakerUrl
	? SafetyServiceLive.pipe(
			Layer.provide(moonrakerConfigLayer),
			Layer.provide(
				Layer.succeed(SafetySettings, {
					enabled: [
						'PERILUNE_LIVE_CONTROLS',
						'PERILUNE_LIVE_MESH',
						'PERILUNE_LIVE_CONFIGURATION'
					].some((name) => process.env[name] === 'true')
				})
			),
			Layer.provide(databaseLayer),
			Layer.provide(liveServices),
			Layer.provideMerge(coreLayer)
		)
	: Layer.merge(coreLayer, SafetyDisabled);
const commandsLayer = moonrakerUrl
	? LiveMeshServiceLive.pipe(
			Layer.provide(actionStoreLayer),
			Layer.provide(databaseLayer),
			Layer.provideMerge(safetyLayer),
			Layer.provide(liveServices)
		)
	: Layer.merge(safetyLayer, LiveMeshDisabled);
const jobsLayer = JobServiceLive.pipe(
	Layer.provide(
		Layer.succeed(JobsConfig, {
			moonrakerUrl: moonrakerUrl ?? '',
			liveFiles: process.env.PERILUNE_LIVE_CONTROLS === 'true',
			apiKey: process.env.PERILUNE_MOONRAKER_API_KEY,
			checkPrintKey: (id, owner, epoch) => {
				const key = authService?.db
					.prepare(
						`SELECT k.id FROM slicer_keys k JOIN user u ON u.id=k.owner WHERE k.id=? AND k.owner=? AND k.epoch=? AND (k.expires=0 OR k.expires>?) AND k.can_print=1 AND u.authVersion=k.epoch AND u.role IN ('owner','operator')`
					)
					.get(id, owner, epoch, Date.now());
				return Boolean(key);
			},
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
	Layer.provideMerge(commandsLayer)
);
const liveActionsLayer = moonrakerUrl
	? LiveActionServiceLive.pipe(
			Layer.provide(
				Layer.succeed(LiveActionSettings, {
					enabled: process.env.PERILUNE_LIVE_CONTROLS === 'true',
					filamentEnabled: process.env.PERILUNE_LIVE_FILAMENT === 'true',
					zEnabled: process.env.PERILUNE_LIVE_Z_CALIBRATION === 'true',
					consoleEnabled: process.env.PERILUNE_LIVE_CONSOLE === 'true',
					pidEnabled: process.env.PERILUNE_LIVE_PID === 'true',
					target: moonrakerUrl
				})
			),
			Layer.provide(databaseLayer),
			Layer.provide(actionStoreLayer),
			Layer.provide(liveServices),
			Layer.provideMerge(jobsLayer)
		)
	: Layer.merge(jobsLayer, LiveActionDisabled);
const configurationLayer = ConfigurationServiceLive.pipe(
	Layer.provide(
		Layer.succeed(ConfigurationSettings, {
			moonrakerUrl: moonrakerUrl ?? '',
			apiKey: process.env.PERILUNE_MOONRAKER_API_KEY,
			klipperWorkingDirectory: process.env.PERILUNE_KLIPPER_WORKING_DIRECTORY
		})
	),
	Layer.provide(databaseLayer)
);
const applicationLayer = ConfigurationApplicationServiceLive.pipe(
	Layer.provide(
		Layer.succeed(ConfigurationApplicationSettings, {
			enabled: process.env.PERILUNE_LIVE_CONFIGURATION === 'true'
		})
	),
	Layer.provide(
		Layer.succeed(ConfigurationSettings, {
			moonrakerUrl: moonrakerUrl ?? '',
			apiKey: process.env.PERILUNE_MOONRAKER_API_KEY,
			klipperWorkingDirectory: process.env.PERILUNE_KLIPPER_WORKING_DIRECTORY
		})
	),
	Layer.provide(configurationLayer),
	Layer.provide(databaseLayer),
	Layer.provideMerge(liveActionsLayer)
);
const notificationLayer = NotificationServiceLive.pipe(
	Layer.provide(databaseLayer),
	Layer.provide(
		Layer.succeed(NotificationSettings, {
			origin: process.env.PERILUNE_ORIGIN ?? 'http://localhost:4181',
			valid: ({ id, epoch }) => {
				const user = authService?.db.prepare('SELECT authVersion FROM user WHERE id=?').get(id);
				return Boolean(user && Number(user.authVersion) === epoch);
			}
		})
	),
	Layer.provideMerge(applicationLayer)
);
const consoleLayer = ConsoleServiceLive.pipe(
	Layer.provide(databaseLayer),
	Layer.provideMerge(notificationLayer)
);
const slicerLayer = SlicerServiceLive.pipe(
	Layer.provide(databaseLayer),
	Layer.provideMerge(consoleLayer)
);
export const runtime = ManagedRuntime.make(
	Layer.mergeAll(
		slicerLayer,
		configurationLayer,
		PreferenceServiceLive.pipe(Layer.provide(databaseLayer))
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
		authService?.close();
	}
};
registerDevelopmentLifecycle(import.meta.hot, lifecycle);
const unregister = registerNodeLifecycle(lifecycle);
import.meta.hot?.dispose(unregister);
