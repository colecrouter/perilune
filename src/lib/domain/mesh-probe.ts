import { filamentChangeActive } from './filament-change.js';
import { Schema } from 'effect';
import { simulatedBedMesh, type BedMesh } from './bed-mesh.js';
import { CommandRejected } from './errors.js';
import { motionReason } from './motion.js';
import type { CalibrationActor } from './calibration.js';
import type { LiveMeshPlan } from './live-mesh.js';
import type { PrinterSnapshot } from './printer.js';
export const MESH_PROBE_IDLE_MS = 10 * 60 * 1000;
export const probePlan = { min: [20, 20], max: [200, 200], columns: 5, rows: 5 } as const;
const probeId = Schema.String.check(Schema.isUUID());
export const MeshProbeCommand = Schema.Union([
	Schema.Struct({ type: Schema.Literal('meshProbeReconcile'), probeId, confirmed: Schema.Boolean }),
	Schema.Struct({
		type: Schema.Literal('meshProbeProfile'),
		probeId,
		operation: Schema.Literals(['load', 'clear', 'delete']),
		name: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
		expected: Schema.String.check(Schema.isMaxLength(100000)),
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('meshProbeBegin'),
		probeId,
		confirmed: Schema.Boolean,
		usual: Schema.optional(Schema.Boolean),
		newProfile: Schema.optional(Schema.Boolean),
		target: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
		expectedTarget: Schema.optional(Schema.String.check(Schema.isMaxLength(100000)))
	}),
	Schema.Struct({
		type: Schema.Literal('meshProbeFinish'),
		probeId,
		outcome: Schema.Literals(['apply', 'save']),
		name: Schema.optional(Schema.String.check(Schema.isMaxLength(40)))
	}),
	Schema.Struct({
		type: Schema.Literal('meshProbeCancel'),
		probeId,
		confirmed: Schema.Boolean,
		force: Schema.optional(Schema.Boolean)
	})
]);
export type MeshProbeCommand = typeof MeshProbeCommand.Type;
export interface MeshProbeSession {
	id: string;
	ownerId: string;
	ownerName: string;
	stage:
		| 'probing'
		| 'review'
		| 'applied'
		| 'saved'
		| 'cancelled'
		| 'interrupted'
		| 'uncertain'
		| 'saving';
	live?: boolean;
	usual?: boolean;
	newProfile?: boolean;
	discardStarted?: boolean;
	target?: string;
	copyName?: string;
	previousTarget?: BedMesh | null;
	operation?: 'load' | 'clear' | 'delete';
	plan?: LiveMeshPlan;
	previousProfile?: string | null;
	previousMesh?: BedMesh | null;
	completedSamples: number;
	startedAt: number;
	expiresAt: number;
	result: BedMesh | null;
	message: string | null;
}
export interface MeshProbeState {
	savedProfiles: BedMesh[];
	removedProfiles?: string[];
	session: MeshProbeSession | null;
}
export const emptyMeshProbe = (): MeshProbeState => ({ savedProfiles: [], session: null });
export const meshProbeActive = (state: MeshProbeState) =>
	Boolean(
		state.session && ['probing', 'review', 'uncertain', 'saving'].includes(state.session.stage)
	);
export function interruptMeshProbe(state: MeshProbeState, message: string): MeshProbeState {
	return meshProbeActive(state) || state.session?.stage === 'applied'
		? { ...state, session: { ...state.session!, stage: 'interrupted', result: null, message } }
		: state;
}
export const restartMeshProbe = (state: MeshProbeState) =>
	interruptMeshProbe(
		state,
		'Backend restarted. The unfinished run or temporary application was not resumed. Saved profiles are retained.'
	);
export function meshProbeReason(state: PrinterSnapshot, pending = true): string | null {
	if (filamentChangeActive(state.filamentChange))
		return 'Filament-change guidance owns this print. Continue or end it first.';
	if (meshProbeActive(state.meshProbe))
		return 'A bed mesh workflow already owns the printer. Finish or cancel it first.';
	const reason = motionReason(state, ['x', 'y', 'z'], false, pending);
	if (reason) return reason;
	if (state.heaters.nozzle.target !== 0 || state.heaters.bed.target !== 0)
		return 'Turn off both heater targets for this cold simulator exercise.';
	for (const [i, axis] of (['x', 'y'] as const).entries()) {
		const limits = state.motion.limits[axis]!;
		if (limits.min > probePlan.min[i] || limits.max < probePlan.max[i])
			return 'The reviewed probing area is outside the simulator travel limits.';
	}
	return null;
}
export function probeSample(index: number) {
	const row = Math.floor(index / probePlan.columns);
	const column =
		row % 2 ? probePlan.columns - 1 - (index % probePlan.columns) : index % probePlan.columns;
	return { x: 20 + column * 45, y: 20 + row * 45 };
}
export function advanceMeshProbe(state: MeshProbeState, now = Date.now()): MeshProbeState {
	const session = state.session;
	if (!meshProbeActive(state)) return state;
	if (session!.expiresAt <= now)
		return interruptMeshProbe(state, 'The workflow expired. Its unsaved result was discarded.');
	if (session!.stage !== 'probing') return state;
	const completedSamples = Math.min(25, session!.completedSamples + 1);
	return {
		...state,
		session: {
			...session!,
			completedSamples,
			stage: completedSamples === 25 ? 'review' : 'probing',
			result:
				completedSamples === 25 ? { ...simulatedBedMesh().active!, name: 'temporary-probe' } : null
		}
	};
}
export function applyMeshProbe(
	state: PrinterSnapshot,
	command: MeshProbeCommand,
	actor?: CalibrationActor
): PrinterSnapshot {
	if (state.mode !== 'simulator')
		throw new CommandRejected({ message: 'Live probing requires coordinated printer testing.' });
	if (!actor || !['owner', 'operator'].includes(actor.role ?? '') || actor.authorized?.() === false)
		throw new CommandRejected({ message: 'An authorized operator account is required.' });
	if (command.type === 'meshProbeReconcile')
		throw new CommandRejected({
			message: 'Reconciliation is only available for a live uncertain workflow.'
		});
	const next = structuredClone(state);
	if (command.type === 'meshProbeProfile') {
		const reason = motionReason(state, [], false, false);
		if (reason || meshProbeActive(state.meshProbe))
			throw new CommandRejected({ message: reason ?? 'Finish the current bed mesh workflow.' });
		const profile = state.bedMesh.profiles.find((p) => p.name === command.name);
		const target = command.operation === 'clear' ? state.bedMesh.active : profile;
		if (!command.confirmed || JSON.stringify(target ?? null) !== command.expected)
			throw new CommandRejected({ message: 'The selected mesh changed. Review it again.' });
		if (command.operation === 'delete') {
			if (state.bedMesh.active?.name === command.name || actor.role !== 'owner')
				throw new CommandRejected({
					message:
						'An owner can delete an unused named mesh. Clear or replace the active mesh first.'
				});
			next.bedMesh.profiles = next.bedMesh.profiles.filter((p) => p.name !== command.name);
			next.meshProbe.savedProfiles = next.bedMesh.profiles;
			next.meshProbe.removedProfiles = [
				...new Set([...(state.meshProbe.removedProfiles ?? []), command.name!])
			];
		} else {
			next.bedMesh.active = command.operation === 'clear' ? null : profile!;
			next.bedMesh.status = next.bedMesh.active ? 'ready' : 'empty';
		}
		return next;
	}

	if (command.type === 'meshProbeBegin') {
		const reason = meshProbeReason(state, false);
		if (reason) throw new CommandRejected({ message: reason });
		if (command.usual && actor.role !== 'owner')
			throw new CommandRejected({ message: 'An owner is required for saved calibration.' });
		if (
			command.newProfile &&
			(!command.usual || command.target !== undefined || command.expectedTarget !== undefined)
		)
			throw new CommandRejected({ message: 'New calibration has no replacement target.' });
		const previousTarget =
			state.bedMesh.profiles.find((p) => p.name === (command.target ?? 'default')) ?? null;
		if (
			command.usual &&
			!command.newProfile &&
			command.expectedTarget !== JSON.stringify(previousTarget)
		)
			throw new CommandRejected({ message: 'The replacement target changed. Review it again.' });
		if (!command.confirmed)
			throw new CommandRejected({
				message: 'Review bed clearance and the simulator probing plan first.'
			});
		next.meshProbe.session = {
			id: command.probeId,
			ownerId: actor.id,
			ownerName: actor.name,
			stage: 'probing',
			usual: command.usual,
			newProfile: command.newProfile,
			previousTarget: command.usual && !command.newProfile ? previousTarget : undefined,
			target: command.target,
			completedSamples: 0,
			startedAt: Date.now(),
			expiresAt: Date.now() + MESH_PROBE_IDLE_MS,
			result: null,
			message: null
		};
		next.motion.calibration = true;
		return next;
	}
	const session = state.meshProbe.session;
	if (
		!session ||
		session.id !== command.probeId ||
		!meshProbeActive(state.meshProbe) ||
		session.expiresAt <= Date.now()
	)
		throw new CommandRejected({
			message: 'This bed mesh run changed or expired. Review the current workflow.'
		});
	const force = command.type === 'meshProbeCancel' && command.force && actor.role === 'owner';
	if (actor.id !== session.ownerId && !force)
		throw new CommandRejected({
			message: `This workflow belongs to ${session.ownerName}. An account owner can cancel an abandoned run.`
		});
	if (command.type === 'meshProbeCancel') {
		if (!command.confirmed)
			throw new CommandRejected({
				message: 'Confirm cancellation and discard of the unsaved result.'
			});
		next.meshProbe.session = {
			...session,
			stage: 'cancelled',
			result: null,
			message: 'Cancelled. The previous active mesh and saved profiles were retained.'
		};
	} else {
		if (session.stage !== 'review' || !session.result)
			throw new CommandRejected({ message: 'Wait for all samples before reviewing the result.' });
		const readiness = meshProbeReason(
			{ ...state, meshProbe: emptyMeshProbe(), motion: { ...state.motion, calibration: false } },
			false
		);
		if (readiness) throw new CommandRejected({ message: readiness });
		if (command.outcome === 'save') {
			const replacement = session.usual && !session.newProfile;
			const target = replacement ? (session.target ?? 'default') : (command.name?.trim() ?? '');
			if (
				replacement &&
				session.previousTarget !== undefined &&
				JSON.stringify(state.bedMesh.profiles.find((p) => p.name === target) ?? null) !==
					JSON.stringify(session.previousTarget)
			)
				throw new CommandRejected({
					message: 'The replacement target changed during calibration.'
				});
			if (replacement && command.name !== undefined)
				throw new CommandRejected({ message: 'Replacement keeps its existing name.' });
			if (
				!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,39}$/.test(target) ||
				(!replacement &&
					(target.toLowerCase() === 'default' || target.toLowerCase().startsWith('perilune_')))
			)
				throw new CommandRejected({
					message: 'Use a profile name of 1–40 letters, numbers, spaces, underscores or hyphens.'
				});
			if (
				!replacement &&
				state.bedMesh.profiles.some((p) => p.name.toLowerCase() === target.toLowerCase())
			)
				throw new CommandRejected({
					message:
						'That profile name already exists. Choose a new name; existing profiles are never overwritten.'
				});
			const additions = [{ ...session.result, name: target }];
			const replaced = new Set(additions.map((p) => p.name));
			const profiles = [
				...next.bedMesh.profiles.filter((p) => !replaced.has(p.name)),
				...additions
			];
			if (profiles.length > 32)
				throw new CommandRejected({ message: 'The simulator profile limit has been reached.' });
			next.meshProbe.savedProfiles = [
				...next.meshProbe.savedProfiles.filter((p) => !replaced.has(p.name)),
				...additions
			];
			next.bedMesh.profiles = profiles;
			if (session.usual) {
				next.bedMesh.active = additions[0];
				next.bedMesh.status = 'ready';
			}
			const name = target;

			next.meshProbe.session = {
				...session,
				stage: 'saved',
				message: session.usual
					? session.newProfile
						? `Saved ${name}. Existing saved meshes are unchanged.`
						: 'Replacement saved and activated in the simulator.'
					: `Saved ${name}. The active mesh was not changed.`
			};
		} else {
			next.bedMesh.active = session.result;
			next.bedMesh.status = 'ready';
			next.meshProbe.session = {
				...session,
				stage: 'applied',
				message:
					'Applied for this simulator process. Restarting restores the previous default mesh.'
			};
		}
	}
	next.motion.calibration = false;
	return next;
}

/** Target names must also be saveable after the calibration has completed. */
export const meshCalibrationTargetSupported = (name: string, simulator: boolean) =>
	simulator
		? /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,39}$/.test(name)
		: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(name);
