import { calculateExtrusion, type ExtrusionProposal } from './extrusion.js';
import {
	configFields,
	configParts,
	updateConfigField,
	checkConfigChange,
	type ConfigDocument
} from './configuration.js';
import { referenceInventory } from './reference-configuration.js';
export interface CalibrationDraftProposal {
	id: string;
	ownerId: string;
	createdAt: number;
	source: ConfigDocument['source'];
	measurement: ExtrusionProposal;
}
export const CALIBRATION_PROPOSAL_LIFETIME = 30 * 60_000;
/** Recompute from measurements; a displayed or transferred proposed value is never authoritative. */
export function checkCalibrationProposal(
	proposal: CalibrationDraftProposal,
	source: ConfigDocument['source'],
	now = Date.now()
) {
	if (
		!proposal.ownerId ||
		!Number.isFinite(proposal.createdAt) ||
		proposal.createdAt > now ||
		now - proposal.createdAt > CALIBRATION_PROPOSAL_LIFETIME
	)
		throw new Error('This proposal expired. Reopen the calibration result and review it again.');
	if (proposal.source !== source)
		throw new Error(
			'Simulator measurements cannot be added to live configuration, or live measurements to simulator files.'
		);
	const result = calculateExtrusion(
		proposal.measurement.rotationDistance,
		proposal.measurement.before,
		proposal.measurement.after
	);
	if (result.proposed < 0.001 || result.proposed > 1000)
		throw new Error('The proposed rotation distance is outside the supported range.');
	return result;
}
export function calibrationDraftChange(
	text: string,
	proposal: CalibrationDraftProposal,
	source: ConfigDocument['source'],
	includesReviewed: boolean,
	now = Date.now()
) {
	const measurement = checkCalibrationProposal(proposal, source, now);
	const inventory = referenceInventory(text);
	if (inventory.parts.warning)
		throw new Error('Resolve the generated-settings warning before adding a calibration proposal.');
	if (
		inventory.generated.some((s) => s.name === 'extruder' && s.keys.includes('rotation_distance'))
	)
		throw new Error(
			'Rotation distance is in protected generated settings. Keep that block intact and review the configuration manually.'
		);
	if (inventory.hasIncludes && !includesReviewed)
		throw new Error('Review included files and any rotation-distance overrides first.');
	if (inventory.sections.filter((s) => s.name === 'extruder').length !== 1)
		throw new Error('The extruder section is missing or repeated. Review the source manually.');
	const fields = configFields(text).filter((field) => field.id === 'extruder.rotation_distance');
	const field = fields[0];
	if (fields.length !== 1 || !field?.editable)
		throw new Error(
			'Open the file containing one unambiguous, numeric [extruder] rotation_distance setting. Missing, duplicate and multiline settings require manual review.'
		);
	if (Number(field.value) !== measurement.rotationDistance)
		throw new Error(
			'This draft’s rotation distance differs from the value used for the measurement. Check runtime overrides and repeat the measurement with the current value.'
		);
	if (measurement.rotationDistance === measurement.proposed)
		throw new Error(
			'The measured result already matches this rotation distance. No configuration change is needed.'
		);
	const next = updateConfigField(text, field.id, measurement.proposed.toFixed(3));
	checkConfigChange(text, next);
	if (configParts(next).generated !== configParts(text).generated)
		throw new Error('Protected settings changed.');
	return { text: next, measurement };
}
