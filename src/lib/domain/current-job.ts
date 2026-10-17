import type { PrinterSnapshot } from './printer.js';
import { safetyReason } from './safety.js';

/** Presentation only: execution-time checks remain owned by the shared worker. */
export function jobControlReason(
	snapshot: PrinterSnapshot,
	available = true,
	operator = true
): string | null {
	if (!operator) return 'An operator account is required to control a print.';
	if (!available || snapshot.connection !== 'connected')
		return 'Waiting for the printer connection. Last known progress is retained.';
	if (!snapshot.telemetryReady)
		return 'Waiting for fresh printer status. Last known progress is retained.';
	if (snapshot.klippy !== 'ready')
		return `Klipper is ${snapshot.klippy}. Print controls are unavailable.`;
	const safety = safetyReason(snapshot.safety);
	if (safety) return safety;
	if (snapshot.liveRecovery) return snapshot.liveRecovery.message;
	if (snapshot.mode === 'moonraker' && !snapshot.liveControls)
		return 'Live print controls are disabled on this server.';
	if (snapshot.storage !== 'healthy') return 'Action storage is recovering. Please wait.';
	if (snapshot.configurationBusy || snapshot.motion.calibration)
		return 'Finish the active configuration or calibration workflow first.';
	if (snapshot.actions.some((action) => ['queued', 'sending'].includes(action.status)))
		return 'Waiting for the pending action to finish.';
	return null;
}
export const jobDescriptions: Record<
	PrinterSnapshot['job']['state'],
	{ title: string; description: string }
> = {
	printing: { title: 'Printing', description: 'Your print is in progress.' },
	paused: {
		title: 'Print paused',
		description:
			'Check the printer and console messages before resuming. A filament change may need a purge followed by another Resume.'
	},
	complete: {
		title: 'Print complete',
		description: 'Your print has finished. Clear the bed before starting another job.'
	},
	cancelled: {
		title: 'Print stopped',
		description: 'This job was cancelled. Clear the bed and review the file before trying again.'
	},
	error: {
		title: 'Print interrupted',
		description:
			'Check the console and printer status to understand what happened before starting another job.'
	},
	standby: {
		title: 'Ready for your next print',
		description: 'Choose a file from your library to get started.'
	},
	unknown: {
		title: 'Waiting for printer status',
		description: 'Job details will appear when the printer reports its state.'
	}
};
