import {
	filamentSetupReason,
	filamentChangeActive,
	type FilamentChangeCommand,
	type FilamentChangeSession,
	type FilamentChangeSettings
} from '#lib/domain/filament-change.js';
import type { CalibrationActor } from '#lib/domain/calibration.js';
import type { MoonrakerSnapshot, ControlOperation } from './moonraker.js';

export function filamentChangePlan(
	command: FilamentChangeCommand,
	actionId: string,
	session: FilamentChangeSession | null | undefined,
	settings: FilamentChangeSettings,
	fresh: MoonrakerSnapshot,
	actor: CalibrationActor
): { session: FilamentChangeSession; operations: ControlOperation[] } {
	if (!command.confirmed) throw Error('Attend the printer and confirm this step first.');
	if (
		(command.type !== 'filamentChangeEnd' && !fresh.job.runId) ||
		command.expectedJob.runId !== (fresh.job.runId ?? '') ||
		command.expectedJob.filename !== fresh.job.filename
	)
		throw Error('The print identity changed. Review the current print before continuing.');
	if (fresh.connection !== 'connected' || fresh.klippy !== 'ready' || !fresh.telemetryReady)
		throw Error('Wait for fresh ready printer telemetry.');
	if (fresh.motion.calibration) throw Error('Finish the active printer helper first.');
	if (
		command.type !== 'filamentChangeEnd' &&
		(!fresh.availableObjects.includes('virtual_sdcard') ||
			!fresh.availableObjects.includes('pause_resume'))
	)
		throw Error('This workflow requires virtual_sdcard and pause_resume status.');
	const samePausedJob =
		fresh.job.state === 'paused' && fresh.paused === true && fresh.motion.busy === false;
	const macro = (name: string): ControlOperation[] => {
		if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) throw Error('Invalid configured macro name.');
		return [{ type: 'controlScript', script: `${name}\nM400` }];
	};
	if (command.type === 'filamentChangeBegin') {
		if (filamentChangeActive(session))
			throw Error('A filament-change session already owns this printer.');
		const reason = filamentSetupReason(settings, fresh.filamentChange ?? null);
		if (reason) throw Error(reason);
		if (settings.revision !== command.settingsRevision)
			throw Error('Filament setup changed. Review the new setup.');
		if (
			command.adoptPaused
				? !samePausedJob
				: fresh.job.state !== 'printing' || fresh.paused !== false
		)
			throw Error('The print pause state changed. Review it before starting.');
		const now = Date.now();
		return {
			session: {
				id: actionId,
				ownerId: actor.id,
				filename: fresh.job.filename,
				runId: fresh.job.runId ?? '',
				generation: fresh.generation,
				settingsRevision: settings.revision,
				fingerprint: settings.fingerprint,
				step: 1,
				stage: 'waiting',
				startedAt: now,
				expiresAt: now + 30 * 60_000,
				message: command.adoptPaused
					? 'Reviewing this existing pause; no change macro was sent.'
					: 'Waiting for the change macro and a verified pause.'
			},
			operations: command.adoptPaused ? [] : macro(settings.changeMacro)
		};
	}
	if (
		!session ||
		!filamentChangeActive(session) ||
		session.id !== command.sessionId ||
		session.step !== command.expectedStep
	)
		throw Error('This filament step is stale. Review the shared session.');
	if (
		actor.id !== session.ownerId &&
		!(
			actor.role === 'owner' &&
			['filamentChangeRecover', 'filamentChangeEnd'].includes(command.type)
		)
	)
		throw Error(
			'Another operator owns this change. An owner can explicitly take over or end guidance.'
		);
	if (command.type === 'filamentChangeEnd') {
		if (
			fresh.motion.busy !== false ||
			fresh.job.state === 'printing' ||
			(fresh.paused !== true && fresh.job.state === 'paused')
		)
			throw Error('Wait for a stationary paused or stopped printer before leaving guidance.');
		if (session.stage === 'review' && actor.role !== 'owner')
			throw Error('An owner must review interrupted guidance.');
		return {
			session: {
				...session,
				step: session.step + 1,
				stage: 'finished',
				message:
					'Guidance ended. No resume, return move or extrusion was sent. A paused print remains paused.'
			},
			operations: []
		};
	}
	const reason = filamentSetupReason(settings, fresh.filamentChange ?? null);
	if (reason) throw Error(reason);
	if (
		session.settingsRevision !== settings.revision ||
		session.fingerprint !== settings.fingerprint
	)
		throw Error('Setup changed during this session. End guidance and review setup again.');
	if (!samePausedJob || session.filename !== fresh.job.filename)
		throw Error('A stationary pause on this print must be verified first.');
	if (command.type === 'filamentChangeRecover') {
		if (actor.role !== 'owner')
			throw Error('An owner must inspect the printer before taking over.');
		return {
			session: {
				...session,
				ownerId: actor.id,
				runId: fresh.job.runId ?? '',
				generation: fresh.generation,
				step: session.step + 1,
				stage: 'paused',
				expiresAt: Date.now() + 30 * 60_000,
				message:
					'Owner reviewed the current paused print and took over guidance. No command was replayed.'
			},
			operations: []
		};
	}
	if (
		session.stage !== 'paused' ||
		session.generation !== fresh.generation ||
		session.runId !== fresh.job.runId ||
		Date.now() >= session.expiresAt
	)
		throw Error('Continuity was lost or this session expired. An owner must review the printer.');
	if (!['x', 'y', 'z'].every((axis) => fresh.motion.homed.includes(axis as 'x' | 'y' | 'z')))
		throw Error(
			'Position is no longer trusted. Do not home into a paused print; inspect and recover it manually.'
		);
	if (!fresh.filament?.canExtrude || !fresh.heaters.nozzle.target)
		throw Error(
			'The nozzle is cold or its target is off. Set an appropriate target explicitly and wait before resuming.'
		);
	return {
		session: {
			...session,
			step: session.step + 1,
			stage: 'waiting',
			message: 'Waiting for the resume macro; it will only be sent once.'
		},
		operations: macro(settings.resumeMacro)
	};
}
