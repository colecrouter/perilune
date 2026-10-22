import { expect, it } from 'vite-plus/test';
import { analyseSource, definitionAt, includePath } from './config-analysis.js';
it('scans real source ranges, indented macro contents and protected generated suffix', () => {
	const text =
		'\uFEFF[printer]\r\nmax_velocity: 200\r\n[gcode_macro TEST]\r\ngcode:\r\n  [not a section]\r\n  RESPOND MSG="x:y=z"\r\n  # ignored {\r\n  G1 X{params.X|default(0)|float}\r\n#*# <--- SAVE_CONFIG --->\r\n#*# [printer]\r\n';
	const result = analyseSource('printer.cfg', text);
	expect(result.sections.map((s) => s.name)).toEqual(['printer', 'gcode_macro TEST']);
	expect(result.problems).toEqual([]);
	expect(text.slice(result.options[0]!.from, result.options[0]!.to)).toBe('max_velocity');
});
it.each([
	'G1 X{params.X|default(0)|float}',
	'{% if params.X %}\n G1 X{params.X}\n{% else %}\n G28\n{% endif %}',
	'{% for x in [1,2,] %}\n G1 X{x}\n{% endfor %}',
	'RESPOND MSG={ {"key": 1, "other": [1,2]} }',
	'{% set x = "a}b" %}\nRESPOND MSG={x}',
	'{% raw %}\nraw {text}\n{% endraw %}'
])('accepts representative template %s', (body) => {
	const text =
		'[gcode_macro TEST]\ngcode:\n' +
		body
			.split('\n')
			.map((l) => '  ' + l)
			.join('\n');
	expect(analyseSource('macros.cfg', text).problems).toEqual([]);
});
it('bounds incomplete-template advice and recovers at the next section', () => {
	const a = analyseSource(
		'printer.cfg',
		'[gcode_macro BAD]\ngcode:\n  G1 X{params.X\n[gcode_macro GOOD]\ngcode:\n  G28\n'
	);
	expect(a.problems.length).toBeGreaterThan(0);
	expect(a.problems.every((p) => p.severity === 'error')).toBe(true);
	expect(a.sections.map((s) => s.name)).toContain('gcode_macro GOOD');
	expect(a.problems.length).toBeLessThanOrEqual(3);
});
it('does not infer errors from unknown modules, overrides or JSON/YAML', () => {
	expect(
		analyseSource(
			'printer.cfg',
			'[custom_module foo]\ncustom_key = value\n[custom_module foo]\ncustom_key: replacement'
		).problems
	).toEqual([]);
	expect(analyseSource('settings.yaml', 'bad: {').problems).toEqual([]);
});
it('reports confident configuration structure problems', () => {
	expect(
		analyseSource('printer.cfg', 'orphan: 1\n[broken\n[printer]\nmissing separator\n').problems.map(
			(p) => p.severity
		)
	).toEqual(['error', 'error', 'error']);
});
it('resolves includes within the configuration root and keeps macro ambiguity', () => {
	expect(includePath('folder/main.cfg', '../macros.cfg')).toBe('macros.cfg');
	expect(includePath('main.cfg', '../private.cfg')).toBeNull();
	const text = '[include macros.cfg]\n[gcode_macro RUN]\ngcode:\n  TEST\n';
	const a = analyseSource('printer.cfg', text),
		docs = [{ path: 'macros.cfg', text: '[gcode_macro TEST]\ngcode:\n G28\n' }];
	expect(definitionAt(a, 5, docs, ['macros.cfg']).targets[0]?.path).toBe('macros.cfg');
	expect(definitionAt(a, text.indexOf('  TEST') + 3, docs, ['macros.cfg']).targets[0]?.line).toBe(
		1
	);
	expect(
		definitionAt(
			a,
			text.indexOf('  TEST') + 3,
			[...docs, { path: 'other.cfg', text: docs[0]!.text }],
			[]
		).targets
	).toHaveLength(2);
});
it.each([
	['G1 X{params.X', 'Close this template expression with }.'],
	['{% if params.X', 'Close this template tag with %}.'],
	['{% if params.X %}\nG28', 'Close this if block with {% endif %}.'],
	['{% endfor %}', 'This closing tag has no matching opening block.']
])('explains definite structural template error %s', (body, message) => {
	const a = analyseSource(
		'macros.cfg',
		'[gcode_macro TEST]\ngcode:\n' +
			body
				.split('\n')
				.map((l) => '  ' + l)
				.join('\n')
	);
	expect(a.problems.some((p) => p.severity === 'error' && p.message === message)).toBe(true);
});
it('masks comments like Klipper, handles tabs and caps diagnostics on a maximum-sized file', () => {
	const a = analyseSource(
		'printer.cfg',
		'[gcode_macro TEST]\ngcode:\n\tRESPOND MSG=";literal"\n\tG1 X{1} ; ignored {\n\t# ignored {\n'
	);
	expect(a.problems).toEqual([]);
	expect(analyseSource('printer.cfg', 'bad line\n'.repeat(25000)).problems).toHaveLength(50);
});
it('does not mistake equals signs inside capture filters for an assignment', () => {
	const text =
		'[gcode_macro TEST]\ngcode:\n  {% set message | replace("=", ":") %}\n  a=b\n  {% endset %}\n';
	expect(analyseSource('macros.cfg', text).problems).toEqual([]);
});

it('accepts Jinja plus whitespace control without a false unmatched closing block', () => {
	const a = analyseSource(
		'macros.cfg',
		'[gcode_macro TEST]\ngcode:\n  {%+ if params.X %}\n  G28\n  {% endif %}\n'
	);
	expect(a.problems.filter((p) => p.severity === 'error')).toEqual([]);
});
