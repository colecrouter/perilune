import { expect, test } from 'vite-plus/test';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { klipper } from './klipper-language.js';
test('Klipper sections, options, G-code, comments and template expressions receive distinct syntax tokens', () => {
	const text =
		'[gcode_macro EXAMPLE]\ngcode:\n    {% if printer.toolhead.homed_axes %}\n    G1 X{params.X|float} Y10 ; movement\n    {% endif %}\n# keep comment\n';
	const state = EditorState.create({ doc: text, extensions: [klipper] });
	const tree = ensureSyntaxTree(state, text.length, 100)!;
	const tokens: { type: string; text: string }[] = [];
	tree.iterate({
		enter(node) {
			if (!node.node.firstChild)
				tokens.push({ type: node.name, text: text.slice(node.from, node.to) });
		}
	});
	expect(tokens).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: 'heading', text: '[gcode_macro EXAMPLE]' }),
			expect.objectContaining({ type: 'propertyName', text: 'gcode:' }),
			expect.objectContaining({ type: 'keyword', text: 'if' }),
			expect.objectContaining({ type: 'keyword', text: 'G1' }),
			expect.objectContaining({ type: 'comment', text: '; movement' }),
			expect.objectContaining({ type: 'comment', text: '# keep comment' })
		])
	);
});
