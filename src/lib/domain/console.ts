import { printerLockNotices, type PrinterLockNotice } from './printer-locks.js';
import type { PrinterSnapshot } from './printer.js';
import { calibrationActive } from './calibration.js';
import { meshProbeActive } from './mesh-probe.js';
import { extrusionActive } from './extrusion.js';
export interface PrinterMacro {
	name: string;
	description: string;
}
export interface ConsoleLine {
	id: string;
	at: number;
	kind: 'response' | 'error';
	text: string;
}
export interface ConsoleReceipt {
	id: string;
	script: string;
	status: 'queued' | 'sending' | 'completed' | 'failed' | 'unknown';
	createdAt: number;
	message: string | null;
	output: string[];
}
export interface ConsoleSnapshot {
	revision: number;
	executionEnabled?: boolean;
	mode: 'simulator' | 'moonraker';
	connection: PrinterSnapshot['connection'];
	reason: string | null;
	guidance?: PrinterLockNotice;
	macros: PrinterMacro[];
	responses: ConsoleLine[];
	receipts: ConsoleReceipt[];
}
export const simulatorMacros: PrinterMacro[] = [
	{
		name: 'PERILUNE_STATUS',
		description: 'Report simulated printer readiness. Does not move or heat the printer.'
	},
	{
		name: 'CHECK_FILAMENT',
		description: 'Show an example filament check response. Does not read a physical sensor.'
	},
	{
		name: 'SIMULATE_FAILURE',
		description: 'Produce a deliberate simulator error to inspect failure handling.'
	}
];
export function cleanConsoleText(text: string, max = 2048) {
	return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, max);
}
export function discoverMacros(objects: string[], help: unknown): PrinterMacro[] {
	const descriptions =
		help && typeof help === 'object' && !Array.isArray(help)
			? (help as Record<string, unknown>)
			: {};
	return [
		...new Set(
			objects
				.filter((name) => name.startsWith('gcode_macro '))
				.map((name) => name.slice(12).toUpperCase())
				.filter((name) => /^[A-Z_][A-Z0-9_]{0,63}$/.test(name))
		)
	]
		.slice(0, 200)
		.sort()
		.map((name) => ({
			name,
			description:
				typeof descriptions[name] === 'string'
					? cleanConsoleText(descriptions[name] as string, 500)
					: 'No description provided by this printer. Review the macro configuration before using it.'
		}));
}
// Match Klipper's command-token splitting, including compact/malformed N prefixes.
// https://github.com/Klipper3d/klipper/blob/master/klippy/gcode.py
function commandName(line: string): string {
	const parts = line
		.trim()
		.split(';', 1)[0]!
		.toUpperCase()
		.split(/([A-Z_]+|[A-Z*])/);
	return parts
		.slice(parts.slice(0, 2).join('') === 'N' ? 3 : 0, parts.slice(0, 2).join('') === 'N' ? 5 : 3)
		.join('')
		.trim();
}
export function consoleScript(input: string): string {
	const text = input.replace(/\r\n/g, '\n').trim();
	if (
		!text ||
		text.length > 2048 ||
		text.split('\n').length > 8 ||
		/[\x00-\x08\x0b-\x1f\x7f]/.test(text)
	)
		throw new Error(
			'Enter up to eight command lines (2,048 characters), without control characters.'
		);
	if (text.split('\n').some((line) => commandName(line) === 'M112'))
		throw new Error(
			'Emergency stop requires a dedicated immediate operation; it cannot be queued in the console.'
		);
	return text;
}
export function consoleReason(state: PrinterSnapshot): string | null {
	if (state.mode !== 'simulator' && !state.liveConsole)
		return 'Live console execution is disabled on this server. Macro discovery and responses remain available.';
	if (state.connection !== 'connected' || state.klippy !== 'ready' || !state.telemetryReady)
		return 'Wait for a ready printer connection.';
	if (
		state.mode === 'moonraker' &&
		(state.liveRecovery ||
			state.safety?.halted ||
			state.job.state === 'printing' ||
			state.job.state === 'paused' ||
			state.motion.busy !== false ||
			state.motion.calibration)
	)
		return (
			(!state.liveRecovery && !state.safety?.halted
				? printerLockNotices(state)[0]?.message
				: undefined) ??
			'Finish or recover the current printer operation before running a console command.'
		);
	if (state.storage !== 'healthy') return 'Action storage is unavailable.';
	if (
		state.configurationBusy ||
		calibrationActive(state.calibration) ||
		meshProbeActive(state.meshProbe) ||
		extrusionActive(state.extrusion)
	)
		return (
			printerLockNotices(state)[0]?.message ??
			'A calibration or configuration workflow owns the printer.'
		);
	if (state.actions.some((action) => ['queued', 'sending'].includes(action.status)))
		return 'Another printer action is pending.';
	return null;
}
/** Simulator commands are explicit diagnostic examples; arbitrary G-code is never treated as executed. */
export function simulateConsole(script: string, state: PrinterSnapshot): string[] {
	const reason = consoleReason(state);
	if (reason) throw new Error(reason);
	return consoleScript(script)
		.split('\n')
		.filter((line) => line.trim() && !line.trim().startsWith(';'))
		.map((line) => {
			const command = line.split(';')[0]!.trim().toUpperCase();
			switch (command) {
				case 'M105':
					return `Simulator · nozzle ${state.heaters.nozzle.current ?? '?'} / ${state.heaters.nozzle.target ?? '?'}°C · bed ${state.heaters.bed.current ?? '?'} / ${state.heaters.bed.target ?? '?'}°C`;
				case 'M114':
					return `Simulator · X ${state.motion.position.x ?? '?'} Y ${state.motion.position.y ?? '?'} Z ${state.motion.position.z ?? '?'}`;
				case 'HELP':
					return 'Simulator commands: M105, M114, HELP, PERILUNE_STATUS, CHECK_FILAMENT, SIMULATE_FAILURE. Movement/heating commands are not simulated here.';
				case 'PERILUNE_STATUS':
					return 'Simulator ready. No physical command was sent.';
				case 'CHECK_FILAMENT':
					return 'Simulator example: filament present. This is not a physical sensor reading.';
				case 'SIMULATE_FAILURE':
					throw new Error('Deliberate simulator failure. No physical command was sent.');
				default:
					throw new Error(
						'This command is not supported by the console simulator. Use HELP for diagnostic examples. No movement or heating was attempted.'
					);
			}
		});
}

/** Lifecycle operations have dedicated recovery paths and cannot be mixed into a console batch. */
export function liveConsoleScript(input: string): string {
	const script = consoleScript(input);
	const forbidden = new Set([
		'RESTART',
		'FIRMWARE_RESTART',
		'SAVE_CONFIG',
		'PID_CALIBRATE',
		'PROBE_CALIBRATE',
		'Z_ENDSTOP_CALIBRATE',
		'MANUAL_PROBE',
		'TESTZ',
		'ACCEPT',
		'ABORT',
		'BED_MESH_CALIBRATE',
		'SDCARD_PRINT_FILE',
		'M24',
		'M25',
		'M26',
		'M112',
		'PAUSE',
		'RESUME',
		'CANCEL_PRINT'
	]);
	if (script.split('\n').some((line) => forbidden.has(commandName(line))))
		throw new Error(
			'Use the dedicated job, calibration, configuration or emergency controls for this operation.'
		);
	return script;
}

/** Only attach a destination when it explains the actual admission reason. */
export function consoleGuidance(state: PrinterSnapshot): PrinterLockNotice | undefined {
	const notice = printerLockNotices(state)[0];
	return notice && consoleReason(state) === notice.message ? notice : undefined;
}
