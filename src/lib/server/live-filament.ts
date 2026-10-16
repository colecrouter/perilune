import {
	applyExtrusion,
	extrusionReason,
	extrusionActive,
	type ExtrusionState
} from '#lib/domain/extrusion.js';
import type { ActionRequest, PrinterSnapshot } from '#lib/domain/printer.js';
import type { CalibrationActor } from '#lib/domain/calibration.js';
import type { MoonrakerSnapshot, ControlOperation } from './moonraker.js';
export function filamentPlan(
	request: ActionRequest,
	s: PrinterSnapshot,
	fresh: MoonrakerSnapshot,
	actor: CalibrationActor
): { operations: ControlOperation[]; state: ExtrusionState } {
	const c = request.command;
	if (!('runId' in c)) throw Error('Not a filament operation.');
	if (
		!['standby', 'complete', 'cancelled'].includes(s.job.state) ||
		s.motion.busy !== false ||
		fresh.motion.calibration
	)
		throw Error('Wait for an idle printer with no active manual probe.');
	const starts = c.type === 'extrusionBegin' || c.type === 'extrusionFeed';
	if (starts) {
		const reason = extrusionReason(s, false);
		if (reason) throw Error(reason);
		const distance = c.type === 'extrusionBegin' ? 50 : Math.abs(c.distance);
		if (
			!fresh.filament ||
			fresh.filament.active !== 'extruder' ||
			!fresh.filament.canExtrude ||
			fresh.filament.position === null ||
			fresh.filament.maxDistance === null ||
			distance > fresh.filament.maxDistance
		)
			throw Error(
				'Extrusion exceeds the configured single-move limit or the extruder is not ready.'
			);
	} else {
		if (!extrusionActive(s.extrusion)) throw Error('This filament workflow is no longer active.');
		if (['feeding', 'extruding'].includes(s.extrusion.session!.stage))
			throw Error(
				'Wait for the acknowledged movement to finish; use emergency stop for an urgent shutdown.'
			);
	}
	const next = applyExtrusion(
		{ ...s, mode: 'simulator', motion: { ...s.motion, calibration: false } },
		c,
		actor
	);
	const distance =
		c.type === 'extrusionBegin' ? 50 : c.type === 'extrusionFeed' ? c.distance : null;
	const operations: ControlOperation[] =
		distance !== null
			? [
					{
						type: 'controlScript',
						script: `SAVE_GCODE_STATE NAME=perilune_filament\nM83\nM220 S100\nM221 S100\nG1 E${distance} F60\nM400\nRESTORE_GCODE_STATE NAME=perilune_filament`
					}
				]
			: (c.type === 'extrusionFinish' || c.type === 'extrusionCancel') && c.coolNozzle
				? [{ type: 'controlScript', script: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0' }]
				: [];
	return { operations, state: next.extrusion };
}
