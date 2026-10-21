import { remoteRecord } from '#lib/server/remote-input.js';
import { error } from '@sveltejs/kit';
import { CameraService } from '#lib/server/camera.js';
import { Effect } from 'effect';
import { write } from '#lib/server/camera-setup-operations.js';
import { CameraSetupService } from '#lib/server/camera-setup-service.js';
import { cameraCandidateSummary } from '#lib/server/camera-input.js';
import { runtime } from '#lib/server/runtime.js';
import { command, query, getRequestEvent } from '$app/server';
import { authService, requireIdentity, installationOrigin } from '#lib/server/auth/index.js';
import { cameraSetupSnapshot } from '#lib/server/camera-setup-read.js';

export const getCameraSetup = query(async () => {
	const event = getRequestEvent();
	requireIdentity(event, 'owner');
	const settings = await cameraSetupSnapshot();
	requireIdentity(event, 'owner');
	return settings;
});

export const getLocalCameras = query(async () => {
	const event = getRequestEvent();
	const identity = requireIdentity(event, 'owner');
	const lease = authService!.watch(identity);
	try {
		const service = await runtime.runPromise(CameraSetupService);
		const devices = await runtime.runPromise(
			service.devices(AbortSignal.any([event.request.signal, lease.signal]))
		);
		requireIdentity(event, 'owner');
		return devices.map(cameraCandidateSummary);
	} finally {
		lease.release();
	}
});

export const updateCameraSetup = command(remoteRecord(8192), async (input) =>
	write(getRequestEvent(), input)
);

export const captureCamera = command(async () => {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	const lease = authService!.watch(identity);
	try {
		const response = await runtime.runPromise(
			Effect.flatMap(CameraService, (service) =>
				service.proxy(
					'snapshot',
					new Request(installationOrigin + '/api/camera/snapshot', {
						signal: AbortSignal.any([event.request.signal, lease.signal])
					})
				)
			),
			{ signal: AbortSignal.any([event.request.signal, lease.signal]) }
		);
		if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) {
			await response.body?.cancel();
			error(503, 'Snapshot unavailable. Live video may still work; try again shortly.');
		}
		const bytes = await response.arrayBuffer();
		requireIdentity(event);
		return new Uint8Array(bytes);
	} finally {
		lease.release();
	}
});
