import { Schema } from 'effect';

/** Presence proves registration, never the safety or behavior of a macro. */
export interface FilamentChangeCapability {
	fingerprint: string;
	macros: string[];
	pauseResume: boolean;
	m600: boolean;
	findings: string[];
}
export const FilamentChangeSettings = Schema.Struct({
	revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	fingerprint: Schema.String.check(Schema.isMaxLength(64)),
	mode: Schema.Literals(['disabled', 'printer', 'assisted']),
	changeMacro: Schema.String.check(Schema.isMaxLength(64)),
	resumeMacro: Schema.String.check(Schema.isMaxLength(64)),
	// Explicit review is required; analysis cannot attest physical compatibility.
	reviewed: Schema.Boolean
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
	if (settings.mode === 'assisted')
		return 'Assisted movement requires a reviewed parking and extrusion setup; it is not enabled yet.';
	if (!capability.macros.includes(settings.changeMacro))
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
}
export const filamentChangeActive = (session?: FilamentChangeSession | null) =>
	!!session && session.stage !== 'finished';
export function interruptFilamentChange(
	session: FilamentChangeSession,
	message: string
): FilamentChangeSession {
	return filamentChangeActive(session) ? { ...session, stage: 'review', message } : session;
}

export const filamentChangeLockMessage =
	'Filament-change guidance owns this print. Continue or end guidance there before using other controls.';
