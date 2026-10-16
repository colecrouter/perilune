import { liveZActive, type LiveZState } from '#lib/domain/live-z.js';
import type { ActionRequest, PrinterSnapshot } from '#lib/domain/printer.js';
import type { CalibrationActor } from '#lib/domain/calibration.js';
import type { MoonrakerSnapshot, ControlOperation } from './moonraker.js';
import { extrusionActive } from '#lib/domain/extrusion.js';
export function zProbePlan(
	request: ActionRequest,
	s: PrinterSnapshot,
	fresh: MoonrakerSnapshot,
	actor: CalibrationActor
): { operations: ControlOperation[]; state: LiveZState; expectedZ?: number } {
	const c = request.command;
	if (!('run' in c)) throw Error('Not a Z probe command.');
	const capability = fresh.zProbe;
	if (!capability?.method || !s.availableObjects.includes('manual_probe'))
		throw Error('A supported probe or physical Z endstop with manual probe telemetry is required.');
	if (
		!['standby', 'complete', 'cancelled'].includes(s.job.state) ||
		(c.type !== 'zProbeAbort' && s.motion.busy !== false) ||
		extrusionActive(s.extrusion)
	)
		throw Error('Wait for an idle printer.');
	if (c.type !== 'zProbeAbort' && (s.heaters.nozzle.target !== 0 || s.heaters.bed.target !== 0))
		throw Error('Turn off heater targets before the paper test.');
	const previous = s.liveZ?.session;
	let state: LiveZState, script: string, expectedZ: number | undefined;
	if (c.type === 'zProbeBegin') {
		if (!c.confirmed || liveZActive(s.liveZ) || capability.active || capability.pending)
			throw Error('Resolve the active helper or pending calibration before beginning.');
		if (!['x', 'y', 'z'].every((a) => s.motion.homed.includes(a as 'x' | 'y' | 'z')))
			throw Error('Home all axes before beginning.');
		if (!capability.offset) throw Error('Probe offsets are unknown.');
		for (const [axis, index] of [
			['x', 0],
			['y', 1]
		] as const) {
			const pos = s.motion.position[axis],
				limit = s.motion.limits[axis];
			if (
				pos === null ||
				!limit ||
				pos < limit.min ||
				pos > limit.max ||
				pos + capability.offset[index] < limit.min ||
				pos + capability.offset[index] > limit.max
			)
				throw Error('Move to a point where both the nozzle and probe remain inside travel bounds.');
		}
		state = {
			session: {
				id: c.run,
				ownerId: actor.id,
				ownerName: actor.name.slice(0, 80),
				version: 0,
				stage: 'active',
				method: capability.method,
				z: null,
				candidate: null,
				previousOffset: capability.configuredOffset ?? null,
				setting: capability.setting,
				startedAt: Date.now(),
				expiresAt: Date.now() + 10 * 60_000,
				message: null
			}
		};
		script = capability.method === 'probe' ? 'PROBE_CALIBRATE' : 'Z_ENDSTOP_CALIBRATE';
	} else {
		if (
			!previous ||
			(!liveZActive(s.liveZ) && !(c.type === 'zProbeAbort' && previous.stage === 'interrupted')) ||
			previous.id !== c.run ||
			previous.version !== c.version
		)
			throw Error('Z calibration changed. Review the current step.');
		if (previous.ownerId !== actor.id && !(c.type === 'zProbeAbort' && actor.role === 'owner'))
			throw Error('Another operator owns this Z calibration.');
		if (!capability.active) throw Error('The manual probe helper is no longer active.');
		if (previous.expiresAt <= Date.now() && c.type !== 'zProbeAbort')
			throw Error('The calibration expired. Abort the helper before starting again.');
		state = {
			session: { ...previous, version: previous.version + 1, expiresAt: Date.now() + 10 * 60_000 }
		};
		if (c.type === 'zProbeAbort') {
			script = 'ABORT';
			state.session!.stage = 'aborted';
			state.session!.message = 'Manual probing aborted. No calibration setting was saved.';
		} else {
			if (capability.z === null || Math.abs(c.expectedZ - capability.z) > 0.0001)
				throw Error('The nozzle height changed. Review its observed position.');
			if (c.type === 'zProbeAdjust') {
				expectedZ = capability.z + c.delta;
				const limits = fresh.motion.limits.z;
				if (!limits || expectedZ < limits.min || expectedZ > limits.max)
					throw Error('This step exceeds configured Z travel.');
				script = `TESTZ Z=${c.delta}`;
			} else {
				if (!c.confirmed) throw Error('Confirm the paper test before accepting.');
				script = 'ACCEPT';
				state.session!.stage = 'staged';
				state.session!.paperZ = c.expectedZ;
			}
		}
	}
	return { state, expectedZ, operations: [{ type: 'controlScript', script: script + '\nM400' }] };
}
