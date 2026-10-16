import { expect, it } from 'vite-plus/test';
import { initialSnapshot, initialLiveSnapshot } from './printer.js';
import {
	consoleScript,
	liveConsoleScript,
	consoleReason,
	simulateConsole,
	discoverMacros
} from './console.js';
it('bounds scripts and refuses queued emergency stop, including line-number syntax', () => {
	for (const text of [
		'',
		'x'.repeat(2049),
		'HELP\n'.repeat(9),
		'HELP\u0000',
		'M112',
		'N10 M112*12',
		'N10M112',
		'N M112',
		'N. M112',
		'M112S0'
	])
		expect(() => consoleScript(text)).toThrow();
	expect(consoleScript(' M105\r\nM114 ')).toBe('M105\nM114');
});
it('only simulates explicit diagnostics, never pretending movement or heating ran', () => {
	const state = initialSnapshot();
	expect(simulateConsole('M105\nPERILUNE_STATUS', state)).toHaveLength(2);
	expect(() => simulateConsole('G28', state)).toThrow(/not supported/);
	expect(() => simulateConsole('SIMULATE_FAILURE', state)).toThrow(/Deliberate/);
	expect(() => simulateConsole('M105', initialLiveSnapshot())).toThrow(/Live console/);
	expect(consoleReason({ ...state, configurationBusy: true })).toContain('owns');
	expect(consoleReason({ ...state, connection: 'reconnecting' })).toContain('ready');
});
it('discovers bounded names and plain descriptions without exposing macro bodies or guessing parameters', () => {
	const macros = discoverMacros(
		[
			'gcode_macro TEST_MACRO',
			'gcode_macro TEST_MACRO',
			'gcode_macro _INTERNAL',
			'gcode_macro bad name',
			'toolhead'
		],
		{
			TEST_MACRO: '<script>not executable</script>',
			_INTERNAL: 'x'.repeat(800),
			gcode: 'secret macro body'
		}
	);
	expect(macros.map((m) => m.name)).toEqual(['TEST_MACRO', '_INTERNAL']);
	expect(macros[1]!.description).toHaveLength(500);
	expect(JSON.stringify(macros)).not.toContain('secret macro body');
});

it('keeps dedicated lifecycle operations out of real console batches', () => {
	for (const text of [
		'SAVE_CONFIG',
		'M105\nFIRMWARE_RESTART',
		'N1 M24',
		'N10M24',
		'N. M24',
		'M25P0',
		'PAUSE',
		'TESTZ Z=-1'
	])
		expect(() => liveConsoleScript(text)).toThrow('dedicated');
	expect(liveConsoleScript('M105\nM114')).toBe('M105\nM114');
});
