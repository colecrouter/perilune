import { Schema } from 'effect';

/** Presence proves registration, never the safety or behavior of a macro. */
export interface FilamentChangeCapability {
	fingerprint: string;
	macros: string[];
	pauseResume: boolean;
	m600: boolean;
	findings: string[];
	assisted?: {
		supported: boolean;
		reason: string | null;
		maxDistance: number | null;
		maxVelocity: number | null;
		customPause: boolean;
	};
}
const bounded = (minimum: number, maximum: number) =>
	Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum, maximum }));
export const AssistedFilamentProfile = Schema.Struct({
	parking: Schema.Literals(['printer', 'perilune']),
	parkX: bounded(-1000, 1000),
	parkY: bounded(-1000, 1000),
	zLift: bounded(1, 20),
	unload: bounded(1, 50),
	load: bounded(1, 50),
	purge: bounded(1, 50),
	speed: bounded(0.1, 5)
});
export type AssistedFilamentProfile = typeof AssistedFilamentProfile.Type;
export const defaultAssistedFilamentProfile: AssistedFilamentProfile = {
	parking: 'printer',
	parkX: 0,
	parkY: 0,
	zLift: 5,
	unload: 20,
	load: 20,
	purge: 5,
	speed: 1
};
export const FilamentChangeSettings = Schema.Struct({
	revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	fingerprint: Schema.String.check(Schema.isMaxLength(64)),
	mode: Schema.Literals(['disabled', 'printer', 'assisted']),
	changeMacro: Schema.String.check(Schema.isMaxLength(64)),
	resumeMacro: Schema.String.check(Schema.isMaxLength(64)),
	// Explicit review is required; analysis cannot attest physical compatibility.
	reviewed: Schema.Boolean,
	assisted: Schema.optional(AssistedFilamentProfile)
});
export type FilamentChangeSettings = typeof FilamentChangeSettings.Type;
export const defaultFilamentChangeSettings: FilamentChangeSettings = {
	revision: 0,
	fingerprint: '',
	mode: 'disabled',
	changeMacro: 'M600',
	resumeMacro: 'RESUME',
	reviewed: false
};
export function filamentSetupReason(
	settings: FilamentChangeSettings,
	capability: FilamentChangeCapability | null
): string | null {
	if (settings.mode === 'disabled') return 'Filament changes have not been enabled.';
	if (!capability) return 'Wait for fresh printer capability discovery.';
	if (settings.fingerprint !== capability.fingerprint)
		return 'Printer configuration changed. Review filament-change setup again.';
	if (!capability.pauseResume)
		return 'Configure Klipper pause_resume before enabling this workflow.';
	if (!settings.reviewed) return 'Review the macro behavior and attend the first test.';
	if (settings.mode === 'assisted') {
		if (!capability.assisted?.supported)
			return (
				capability.assisted?.reason ??
				'Assisted handling requires compatible single-extruder motion and fresh G-code position telemetry.'
			);
		if (!settings.assisted) return 'Choose and review assisted parking and extrusion settings.';
		if (settings.assisted.parking === 'perilune' && capability.assisted.customPause)
			return 'A custom PAUSE macro is loaded. Keep printer parking to avoid a duplicate park.';
		if (
			[settings.assisted.unload, settings.assisted.load, settings.assisted.purge].some(
				(distance) =>
					capability.assisted!.maxDistance === null || distance > capability.assisted!.maxDistance!
			)
		)
			return 'Each configured extrusion step must fit the printer single-move limit.';
		if (
			[settings.assisted.unload, settings.assisted.load, settings.assisted.purge].some(
				(distance) => distance / settings.assisted!.speed > 90
			)
		)
			return 'Each extrusion step must finish within 90 seconds.';
		if (
			capability.assisted.maxVelocity === null ||
			settings.assisted.speed > capability.assisted.maxVelocity
		)
			return 'Extrusion speed exceeds the printer limit or that limit is unavailable.';
	} else if (!capability.macros.includes(settings.changeMacro))
		return 'The selected change macro is not registered on this printer.';
	if (settings.resumeMacro !== 'RESUME' && !capability.macros.includes(settings.resumeMacro))
		return 'The selected resume macro is not registered on this printer.';
	return null;
}

const jobIdentity = Schema.Struct({
	filename: Schema.String.check(Schema.isMaxLength(512)),
	runId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
});
export const FilamentChangeCommand = Schema.Union([
	Schema.Struct({
		type: Schema.Literal('filamentChangeBegin'),
		expectedJob: jobIdentity,
		settingsRevision: Schema.Int,
		adoptPaused: Schema.Boolean,
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('filamentChangeResume'),
		sessionId: Schema.String.check(Schema.isUUID()),
		expectedStep: Schema.Int,
		expectedJob: jobIdentity,
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('filamentChangeRecover'),
		sessionId: Schema.String.check(Schema.isUUID()),
		expectedStep: Schema.Int,
		expectedJob: jobIdentity,
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('filamentChangePark'),
		sessionId: Schema.String.check(Schema.isUUID()),
		expectedStep: Schema.Int,
		expectedJob: jobIdentity,
		confirmed: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('filamentChangeFeed'),
		sessionId: Schema.String.check(Schema.isUUID()),
		expectedStep: Schema.Int,
		expectedJob: jobIdentity,
		confirmed: Schema.Boolean,
		operation: Schema.Literals(['unload', 'load', 'purge'])
	}),
	Schema.Struct({
		type: Schema.Literal('filamentChangeEnd'),
		sessionId: Schema.String.check(Schema.isUUID()),
		expectedStep: Schema.Int,
		expectedJob: Schema.Struct({
			filename: Schema.String.check(Schema.isMaxLength(512)),
			runId: Schema.String.check(Schema.isMaxLength(200))
		}),
		confirmed: Schema.Boolean
	})
]);
export type FilamentChangeCommand = typeof FilamentChangeCommand.Type;
export interface FilamentChangeSession {
	id: string;
	ownerId: string;
	filename: string;
	runId: string;
	generation: number;
	settingsRevision: number;
	fingerprint: string;
	step: number;
	stage: 'waiting' | 'paused' | 'review' | 'finished';
	startedAt: number;
	expiresAt: number;
	message: string;
	assisted?: {
		parked: boolean;
		position?: { x: number; y: number; z: number };
		physicalPosition?: { x: number; y: number; z: number };
	};
	pendingMove?:
		| {
				kind: 'park';
				position: { x: number; y: number; z: number };
				physicalPosition: { x: number; y: number; z: number };
		  }
		| { kind: 'feed'; startE: number; distance: number; operation: 'unload' | 'load' | 'purge' };
}
export const filamentChangeActive = (session?: FilamentChangeSession | null) =>
	!!session && session.stage !== 'finished';
export function interruptFilamentChange(
	session: FilamentChangeSession,
	message: string
): FilamentChangeSession {
	return filamentChangeActive(session)
		? {
				...session,
				stage: 'review',
				message,
				assisted: session.assisted ? { parked: false } : undefined
			}
		: session;
}

export const filamentChangeLockMessage =
	'Filament-change guidance owns this print. Continue or end guidance there before using other controls.';
