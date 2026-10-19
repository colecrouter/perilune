import { SubscriptionRef } from 'effect';
import { CameraSetupService } from './camera-setup-service.js';
import { CameraService } from './camera.js';
import { discoverCameraInputs, cameraCandidateSummary } from './camera-input.js';
import { MoonrakerService } from './moonraker.js';
import { runtime } from './runtime.js';

export async function cameraCandidates() {
	if (!process.env.PERILUNE_MOONRAKER_URL) return [];
	const moonraker = await runtime.runPromise(MoonrakerService);
	const snapshot = await runtime.runPromise(SubscriptionRef.get(moonraker.state));
	return discoverCameraInputs(snapshot.webcams, process.env.PERILUNE_PRINTER_WEB_ORIGIN);
}

/** Finite local reads only: opening settings never probes a source or companion. */
export async function cameraSetupSnapshot() {
	const service = await runtime.runPromise(CameraSetupService);
	const camera = await runtime.runPromise(CameraService);
	const [status, current, candidates] = await Promise.all([
		runtime.runPromise(service.status),
		runtime.runPromise(SubscriptionRef.get(camera.state)),
		cameraCandidates()
	]);
	return { status, current, candidates: candidates.map(cameraCandidateSummary) };
}
