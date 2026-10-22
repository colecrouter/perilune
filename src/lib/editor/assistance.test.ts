import { expect, it } from 'vite-plus/test';
import { completions } from './assistance.js';
import { EditorSessions } from './sessions.js';
import { helpFixture as catalogue } from './property-help.fixture.js';
const context = {
	documents: [{ path: 'macros.cfg', text: '[gcode_macro CUSTOM]\ngcode:\n  G28\n' }],
	paths: ['printer.cfg', 'macros.cfg'],
	reference: catalogue
};
it('offers settings, includes, loaded macros and template parameters in their contexts', () => {
	const settings = '[printer]\nmax_';
	expect(
		completions('printer.cfg', settings, settings.length, context)?.options.some(
			(o) => o.label === 'max_velocity'
		)
	).toBe(true);
	const include = '[include mac';
	expect(
		completions('printer.cfg', include, include.length, context)?.options.some(
			(o) => o.label === 'macros.cfg'
		)
	).toBe(true);
	const macro = '[gcode_macro RUN]\ngcode:\n  CUS';
	expect(completions('printer.cfg', macro, macro.length, context)?.options[0]?.label).toBe(
		'CUSTOM'
	);
	const param = '[gcode_macro RUN]\ngcode:\n  G1 X{params.X}\n  G1 Y{params.';
	expect(
		completions('printer.cfg', param, param.length, context)?.options.some((o) => o.label === 'X')
	).toBe(true);
	expect(completions('printer.cfg', '[printer]\n# max_', 17, context)).toBeNull();
});
it('limits retained undo state and rejects saves from an invalidated generation', () => {
	const sessions = new EditorSessions(128, 1);
	expect(sessions.put('a.cfg', 0, { doc: 'small' })).toBe(true);
	expect(sessions.put('b.cfg', 0, { doc: 'small' })).toBe(false);
	expect(sessions.get('a.cfg')).toEqual({ doc: 'small' });
	sessions.clear('a.cfg');
	expect(sessions.put('a.cfg', 0, { doc: 'stale' })).toBe(true);
	expect(sessions.get('a.cfg')).toBeNull();
	expect(sessions.put('a.cfg', 1, { doc: 'x'.repeat(1000) })).toBe(false);
	expect(sessions.get('a.cfg')).toBeNull();
});
