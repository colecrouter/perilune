import {
	ExtrusionCommand,
	emptyExtrusion,
	applyExtrusion,
	extrusionActive,
	type ExtrusionState
} from './extrusion.js';
import {
	MeshProbeCommand,
	emptyMeshProbe,
	applyMeshProbe,
	meshProbeActive,
	type MeshProbeState
} from './mesh-probe.js';
import { emptyBedMesh, simulatedBedMesh, type BedMeshState } from './bed-mesh.js';
import {
	CalibrationCommand,
	emptyCalibration,
	applyCalibration,
	calibrationActive,
	type CalibrationState,
	type CalibrationActor
} from './calibration.js';
import { temperatureReason, type TemperatureSensor } from './temperature.js';
import {
	checkedMove,
	motionReason,
	emptyMotion,
	simulatedMotion,
	type MotionSnapshot
} from './motion.js';
import { startReason, type JobFile } from './jobs.js';
import { Schema } from 'effect';
import type { LiveMeshPlan } from './live-mesh.js';
import { CommandRejected } from './errors.js';
export { CommandRejected } from './errors.js';

const coordinate = Schema.Number.check(Schema.isFinite());
const position = Schema.Struct({ x: coordinate, y: coordinate, z: coordinate });
const expectedJob = Schema.optional(
	Schema.Struct({ filename: Schema.String, runId: Schema.NullOr(Schema.String) })
);
export const PrinterCommand = Schema.Union([
	ExtrusionCommand,
	CalibrationCommand,
	MeshProbeCommand,
	Schema.Struct({
		type: Schema.Literal('start'),
		fileId: Schema.Union([
			Schema.String.check(Schema.isUUID()),
			Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
		])
	}),
	Schema.Struct({
		type: Schema.Literal('move'),
		target: Schema.Struct({
			x: Schema.optional(coordinate),
			y: Schema.optional(coordinate),
			z: Schema.optional(coordinate)
		}),
		expectedPosition: position,
		confirmedLowering: Schema.optional(Schema.Boolean)
	}),
	Schema.Struct({ type: Schema.Literal('home'), axes: Schema.Literals(['xy', 'z', 'all']) }),
	Schema.Struct({
		type: Schema.Literal('releaseMotors'),
		axes: Schema.Literals(['xy', 'z', 'all']),
		confirmed: Schema.Boolean
	}),
	Schema.Struct({ type: Schema.Literal('cooldown') }),
	Schema.Struct({ type: Schema.Literal('pause'), expectedJob }),
	Schema.Struct({ type: Schema.Literal('resume'), expectedJob }),
	Schema.Struct({
		type: Schema.Literal('cancel'),
		expectedJob,
		coolBed: Schema.Boolean,
		coolNozzle: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('temperature'),
		heater: Schema.Literals(['bed', 'nozzle']),
		target: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 300 }))
	})
]);
export type PrinterCommand = typeof PrinterCommand.Type;
export const ActionRequest = Schema.Struct({
	id: Schema.String.check(Schema.isUUID()),
	command: PrinterCommand
});
export type ActionRequest = typeof ActionRequest.Type;
export type ActionStatus = 'queued' | 'sending' | 'completed' | 'failed' | 'unknown';
export interface ActionRecord {
	id: string;
	label: string;
	status: ActionStatus;
	createdAt: number;
	message: string | null;
}
export interface PrinterSnapshot {
	configurationBusy?: boolean;
	liveControls?: boolean;
	liveRecovery?: { id: string; message: string } | null;
	revision: number;
	updatedAt: number;
	mode: 'simulator' | 'moonraker';
	connection: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
	klippy: 'unknown' | 'ready' | 'startup' | 'shutdown' | 'error' | 'disconnected';
	telemetryAt: number | null;
	telemetryReady: boolean;
	availableObjects: string[];
	connectionGeneration: number;
	storage: 'healthy' | 'degraded';
	job: {
		filename: string;
		runId?: string;
		state: 'unknown' | 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error';
		progress: number | null;
		layer: number | null;
		totalLayers: number | null;
		remainingMinutes: number | null;
	};
	heaters: {
		nozzle: { current: number | null; target: number | null };
		bed: { current: number | null; target: number | null };
	};
	additionalTemperatures: TemperatureSensor[];
	motion: MotionSnapshot;
	calibration: CalibrationState;
	bedMesh: BedMeshState;
	meshProbe: MeshProbeState;
	extrusion: ExtrusionState;
	liveMesh: { enabled: boolean; plan: LiveMeshPlan | null; pendingConfig: boolean };
	actions: ActionRecord[];
}
export const initialSnapshot = (): PrinterSnapshot => ({
	revision: 0,
	updatedAt: Date.now(),
	mode: 'simulator',
	connection: 'connected',
	klippy: 'ready',
	telemetryAt: Date.now(),
	telemetryReady: true,
	availableObjects: ['extruder', 'heater_bed', 'print_stats', 'virtual_sdcard'],
	connectionGeneration: 0,
	storage: 'healthy',
	job: {
		filename: 'orbital-bracket.gcode',
		runId: crypto.randomUUID(),
		state: 'printing',
		progress: 42,
		layer: 84,
		totalLayers: 200,
		remainingMinutes: 38
	},
	heaters: { nozzle: { current: 210, target: 210 }, bed: { current: 60, target: 60 } },
	additionalTemperatures: [],
	motion: simulatedMotion(),
	calibration: emptyCalibration(),
	bedMesh: simulatedBedMesh(),
	meshProbe: emptyMeshProbe(),
	extrusion: emptyExtrusion(),
	liveMesh: { enabled: false, plan: null, pendingConfig: false },
	actions: []
});
export function actionLabel(command: PrinterCommand): string {
	switch (command.type) {
		case 'extrusionBegin':
			return 'Begin measured simulator extrusion';
		case 'extrusionFeed':
			return `Simulator filament ${command.distance > 0 ? 'feed' : 'retract'} ${Math.abs(command.distance)} mm`;
		case 'extrusionMeasure':
			return 'Record filament measurement';
		case 'extrusionFinish':
			return 'Finish extrusion measurement (proposal only)';
		case 'extrusionCancel':
			return 'Cancel filament workflow';
		case 'meshProbeBegin':
			return 'Begin simulator bed mesh probing';
		case 'meshProbeFinish':
			return command.outcome === 'save'
				? 'Save simulator mesh profile'
				: 'Apply temporary simulator mesh';
		case 'meshProbeCancel':
			return 'Cancel bed mesh workflow';
		case 'calibrationBegin':
			return 'Begin Z-offset calibration';
		case 'calibrationAdjust':
			return `Adjust calibration ${command.delta > 0 ? '+' : ''}${command.delta} mm`;
		case 'calibrationStage':
			return `Calibration: ${command.stage}`;
		case 'calibrationFinish':
			return command.outcome === 'save' ? 'Save simulator offset' : 'Apply temporary offset';
		case 'calibrationCancel':
			return 'Cancel calibration';
		case 'start':
			return 'Start print';
		case 'move':
			return `Move ${Object.entries(command.target)
				.map(([axis, value]) => `${axis.toUpperCase()} ${value} mm`)
				.join(' · ')}`;
		case 'releaseMotors':
			return `Release ${command.axes === 'all' ? 'all motors' : command.axes === 'xy' ? 'X and Y motors' : 'Z motor'}`;
		case 'home':
			return `Home ${command.axes === 'xy' ? 'X and Y' : command.axes === 'z' ? 'Z' : 'all axes'}`;
		case 'pause':
			return 'Pause print';
		case 'resume':
			return 'Resume print';
		case 'cancel':
			return 'Stop print';
		case 'cooldown':
			return 'Cool down nozzle and bed';
		case 'temperature':
			return `Set ${command.heater} to ${command.target}°C`;
	}
}
/** Validate against the current state at execution time, not the browser's stale view. */
export function applyCommand(
	state: PrinterSnapshot,
	command: PrinterCommand,
	file?: JobFile,
	actor?: CalibrationActor
): PrinterSnapshot {
	if (state.configurationBusy)
		throw new CommandRejected({
			message: 'Configuration recovery owns the printer. Finish it before sending commands.'
		});
	if ('runId' in command) return applyExtrusion(state, command, actor);
	if (extrusionActive(state.extrusion) && command.type !== 'cooldown')
		throw new CommandRejected({
			message: 'Filament calibration owns the printer. Finish or cancel it first.'
		});
	if ('probeId' in command) return applyMeshProbe(state, command, actor);
	if (meshProbeActive(state.meshProbe) && command.type !== 'cooldown')
		throw new CommandRejected({
			message: 'Bed mesh calibration owns the printer. Finish or cancel it first.'
		});
	if ('sessionId' in command) return applyCalibration(state, command, actor);
	if (calibrationActive(state.calibration) && command.type !== 'cooldown')
		throw new CommandRejected({
			message: 'Calibration owns the printer controls. Finish or cancel it first.'
		});
	const next = structuredClone(state);
	if (
		'expectedJob' in command &&
		command.expectedJob &&
		(command.expectedJob.filename !== state.job.filename ||
			command.expectedJob.runId !== (state.job.runId ?? null))
	) {
		throw new CommandRejected({
			message: 'The active job changed. Review the current job before trying again.'
		});
	}
	if (command.type === 'start') {
		const reason = startReason(state, false);
		if (reason) throw new CommandRejected({ message: reason });
		if (!file || file.id !== command.fileId || file.source !== 'local')
			throw new CommandRejected({ message: 'The selected file is no longer available.' });
		next.job = {
			filename: file.name,
			state: 'printing',
			progress: 0,
			layer: 0,
			totalLayers: file.metadata?.layers ?? null,
			remainingMinutes: file.metadata?.estimatedSeconds
				? Math.ceil(file.metadata.estimatedSeconds / 60)
				: null
		};
	} else if (command.type === 'move') {
		next.motion.position = checkedMove(
			state,
			command.target,
			command.expectedPosition,
			command.confirmedLowering
		);
	} else if (command.type === 'home') {
		const selected =
			command.axes === 'xy'
				? (['x', 'y'] as const)
				: command.axes === 'z'
					? (['z'] as const)
					: (['x', 'y', 'z'] as const);
		const reason = motionReason(state, selected, true, false);
		if (reason) throw new CommandRejected({ message: reason });
		for (const axis of selected) {
			next.motion.position[axis] = next.motion.limits[axis]!.min;
			if (!next.motion.homed.includes(axis)) next.motion.homed.push(axis);
		}
	} else if (command.type === 'releaseMotors') {
		const reason = motionReason(state, [], true, false);
		if (reason) throw new CommandRejected({ message: reason });
		if (!command.confirmed)
			throw new CommandRejected({ message: 'Confirm motor release and loss of homing first.' });
		const selected =
			command.axes === 'all' ? ['x', 'y', 'z'] : command.axes === 'xy' ? ['x', 'y'] : ['z'];
		next.motion.homed = next.motion.homed.filter((axis) => !selected.includes(axis));
		for (const axis of selected as ('x' | 'y' | 'z')[]) next.motion.position[axis] = null;
	} else if (command.type === 'cooldown') {
		const reason = temperatureReason(state, undefined, false);
		if (reason) throw new CommandRejected({ message: reason });
		next.heaters.nozzle.target = 0;
		next.heaters.bed.target = 0;
	} else if (command.type === 'temperature') {
		const reason = temperatureReason(state, command.heater, false);
		if (reason) throw new CommandRejected({ message: reason });
		const maximum = command.heater === 'bed' ? 120 : 300;
		if (!Number.isInteger(command.target) || command.target < 0 || command.target > maximum)
			throw new CommandRejected({ message: `Target must be between 0 and ${maximum}°C` });
		next.heaters[command.heater].target = command.target;
	} else if (command.type === 'pause') {
		if (state.job.state !== 'printing')
			throw new CommandRejected({ message: 'The print is no longer running' });
		next.job.state = 'paused';
	} else if (command.type === 'resume') {
		if (state.job.state !== 'paused')
			throw new CommandRejected({ message: 'The print is no longer paused' });
		next.job.state = 'printing';
	} else {
		if (state.job.state !== 'printing' && state.job.state !== 'paused')
			throw new CommandRejected({ message: 'The print is already stopped' });
		next.job.state = 'cancelled';
		if (command.coolBed) next.heaters.bed.target = 0;
		if (command.coolNozzle) next.heaters.nozzle.target = 0;
	}
	return next;
}

/** Empty live state never presents demo telemetry as physical printer values. */
export const initialLiveSnapshot = (): PrinterSnapshot => ({
	...initialSnapshot(),
	mode: 'moonraker',
	bedMesh: emptyBedMesh(),
	additionalTemperatures: [],
	motion: emptyMotion(),
	connection: 'connecting',
	klippy: 'unknown',
	telemetryAt: null,
	telemetryReady: false,
	availableObjects: [],
	job: {
		filename: '',
		state: 'unknown',
		progress: null,
		layer: null,
		totalLayers: null,
		remainingMinutes: null
	},
	heaters: { nozzle: { current: null, target: null }, bed: { current: null, target: null } }
});
