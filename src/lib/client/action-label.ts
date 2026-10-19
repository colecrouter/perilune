import type { ActionStatus } from '#lib/domain/printer.js';

/** Presentation only: completed commands do not imply a completed print or movement. */
export const actionStatusLabel: Record<ActionStatus, string> = {
	queued: 'Waiting to run',
	sending: 'In progress',
	completed: 'Command completed',
	failed: 'Failed',
	unknown: 'Outcome uncertain'
};
