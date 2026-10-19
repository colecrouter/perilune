import { CameraSetupService } from '#lib/server/camera-setup-service.js';
import { cameraCandidateSummary } from '#lib/server/camera-input.js';
import { runtime } from '#lib/server/runtime.js';
import { query, getRequestEvent } from '$app/server';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
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
