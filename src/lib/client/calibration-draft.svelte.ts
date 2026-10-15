import type { CalibrationDraftProposal } from '#lib/domain/calibration-draft.js';
/** One transient handoff per tab. No configuration, measurements or credentials in URLs/storage. */
export const calibrationHandoff = $state<{ proposal: CalibrationDraftProposal | null }>({
	proposal: null
});
