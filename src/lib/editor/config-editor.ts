import { Compartment, EditorState } from '@codemirror/state';
import {
	EditorView,
	keymap,
	lineNumbers,
	highlightActiveLine,
	highlightActiveLineGutter,
	drawSelection
} from '@codemirror/view';
import { history } from '@codemirror/commands';
import {
	indentUnit,
	syntaxHighlighting,
	HighlightStyle,
	bracketMatching
} from '@codemirror/language';
import { search, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { vscodeKeymap } from '@replit/codemirror-vscode-keymap';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { klipper } from './klipper-language.js';
const highlight = HighlightStyle.define([
	{ tag: tags.heading, color: 'var(--code-heading)', fontWeight: '600' },
	{ tag: tags.propertyName, color: 'var(--code-property)' },
	{ tag: [tags.keyword, tags.meta], color: 'var(--code-keyword)' },
	{ tag: tags.number, color: 'var(--code-number)' },
	{ tag: tags.string, color: 'var(--code-string)' },
	{ tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' }
]);
const theme = EditorView.theme({
	'&': { backgroundColor: 'var(--canvas)', color: 'var(--text)', fontSize: '0.85rem' },
	'.cm-scroller': {
		fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
		minHeight: '420px',
		maxHeight: '65vh',
		overflow: 'auto',
		lineHeight: '1.7'
	},
	'.cm-content': { padding: '1rem 0', caretColor: 'var(--accent)' },
	'.cm-line': { padding: '0 1rem' },
	'.cm-gutters': {
		backgroundColor: 'var(--surface)',
		color: 'var(--muted)',
		borderRight: '1px solid var(--border)'
	},
	'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--code-active)' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
		backgroundColor: 'var(--code-selection) !important'
	},
	'.cm-cursor': { borderLeftColor: 'var(--accent)' },
	'&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
	'.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
	'.cm-textfield, .cm-button': {
		background: 'var(--canvas)',
		color: 'var(--text)',
		border: '1px solid var(--border)',
		borderRadius: '4px'
	},
	'.cm-searchMatch': {
		backgroundColor: 'var(--code-selection)',
		outline: '1px solid var(--accent)'
	}
});
export function createConfigEditor(
	parent: HTMLElement,
	value: string,
	path: string,
	disabled: boolean,
	onChange: (value: string) => void
) {
	const access = new Compartment();
	const editable = (locked: boolean) => [
		EditorState.readOnly.of(locked),
		EditorView.editable.of(!locked)
	];
	const language = /\.ya?ml$/i.test(path) ? yaml() : /\.json$/i.test(path) ? json() : klipper;
	let locked = disabled;
	const makeState = (doc: string) =>
		EditorState.create({
			doc,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				drawSelection(),
				history(),
				bracketMatching(),
				search({ top: true }),
				highlightSelectionMatches(),
				keymap.of(vscodeKeymap),
				indentUnit.of('    '),
				EditorState.tabSize.of(4),
				language,
				theme,
				syntaxHighlighting(highlight),
				access.of(editable(locked)),
				EditorView.contentAttributes.of({
					'aria-label': 'Editable configuration source',
					'aria-multiline': 'true',
					spellcheck: 'false',
					'aria-describedby': 'config-editor-help'
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) onChange(update.state.doc.toString());
				})
			]
		});
	const view = new EditorView({ parent, state: makeState(value.replace(/\r\n/g, '\n')) });
	return {
		view,
		setDisabled: (next: boolean) => {
			locked = next;
			view.dispatch({ effects: access.reconfigure(editable(locked)) });
		},
		setValue: (next: string) => {
			const normalized = next.replace(/\r\n/g, '\n');
			// Reactive echoes preserve selection/history. Explicit replacement starts a new history.
			if (normalized !== view.state.doc.toString()) view.setState(makeState(normalized));
		},
		destroy: () => view.destroy()
	};
}
