import { Compartment, EditorState, Transaction } from '@codemirror/state';
import {
	EditorView,
	keymap,
	lineNumbers,
	highlightActiveLine,
	highlightActiveLineGutter,
	drawSelection
} from '@codemirror/view';
import { history, historyField, isolateHistory } from '@codemirror/commands';
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
import { closeCompletion, startCompletion } from '@codemirror/autocomplete';
import { propertyHelp } from './property-help.js';
import type { ReferenceCatalogue } from '#lib/domain/klipper-reference.js';
import { klipper } from './klipper-language.js';
import { assistance, navigateToDefinition, type AssistanceContext } from './assistance.js';
import type { EditorSessions } from './sessions.js';
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
	'&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
	'.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
	'.cm-textfield, .cm-button': {
		background: 'var(--canvas)',
		color: 'var(--text)',
		border: '1px solid var(--border)',
		borderRadius: '4px'
	},
	'.cm-property-hover': {
		backgroundColor: 'var(--code-selection)',
		textDecoration: 'underline',
		textDecorationColor: 'var(--accent)',
		textUnderlineOffset: '3px'
	},
	'.cm-tooltip': {
		backgroundColor: 'var(--surface)',
		color: 'var(--text)',
		border: '1px solid var(--border-strong)',
		borderRadius: '8px',
		boxShadow: '0 8px 28px #0003'
	},
	'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
		backgroundColor: 'var(--highlight)',
		color: 'var(--highlight-text)'
	},
	'.cm-property-help': {
		padding: '1rem',
		maxWidth: 'min(440px, calc(100vw - 32px))',
		maxHeight: 'min(360px, 50vh)',
		overflowY: 'auto',
		fontFamily: 'var(--font-sans, sans-serif)',
		fontSize: '0.8rem',
		lineHeight: '1.6',
		whiteSpace: 'normal',
		overflowWrap: 'anywhere'
	},
	'.cm-property-help strong': { display: 'block', fontFamily: 'ui-monospace, monospace' },
	'.cm-property-help p': { margin: '0.65rem 0', whiteSpace: 'pre-wrap' },
	'.cm-property-help a': { color: 'var(--accent)' },
	'.cm-property-help small': { display: 'block', color: 'var(--muted)', marginTop: '0.65rem' },
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
	onChange: (value: string) => void,
	reference: ReferenceCatalogue | null = null,
	context?: AssistanceContext,
	sessions?: EditorSessions,
	onHistoryLimit?: () => void
) {
	const access = new Compartment();
	const help = new Compartment();
	const tools = new Compartment();
	let assistanceContext = context;
	let sessionVersion = sessions?.version(path) ?? 0;
	let catalogue = reference;
	const helpExtension = () =>
		/\.(cfg|conf|ini)$/i.test(path) && catalogue ? propertyHelp(catalogue) : [];
	const editable = (locked: boolean) => [
		EditorState.readOnly.of(locked),
		EditorView.editable.of(!locked)
	];
	const language = /\.ya?ml$/i.test(path) ? yaml() : /\.json$/i.test(path) ? json() : klipper;
	let locked = disabled;
	const extensions = () => [
		lineNumbers(),
		highlightActiveLine(),
		highlightActiveLineGutter(),
		drawSelection(),
		history({ minDepth: 30 }),
		bracketMatching(),
		search({ top: true }),
		highlightSelectionMatches(),
		help.of(helpExtension()),
		tools.of(
			/\.(cfg|conf|ini)$/i.test(path) && assistanceContext
				? assistance(path, () => assistanceContext!, highlight)
				: []
		),
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
	];
	const makeState = (doc: string) => EditorState.create({ doc, extensions: extensions() });
	let state: EditorState;
	try {
		const saved = sessions?.get(path);
		state = saved
			? EditorState.fromJSON(saved, { extensions: extensions() }, { history: historyField })
			: makeState(value.replace(/\r\n/g, '\n'));
	} catch {
		state = makeState(value.replace(/\r\n/g, '\n'));
	}
	const view = new EditorView({ parent, state });
	const replace = (next: string, reset = false) => {
		const normalized = next.replace(/\r\n/g, '\n');
		if (reset) view.setState(makeState(normalized));
		else if (normalized !== view.state.doc.toString()) {
			if (sessions)
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: normalized },
					annotations: [Transaction.addToHistory.of(true), isolateHistory.of('full')]
				});
			else view.setState(makeState(normalized));
		}
	};
	replace(value);
	return {
		view,
		complete: () => {
			if (!locked) {
				view.focus();
				startCompletion(view);
			}
		},
		findDefinition: () => assistanceContext && navigateToDefinition(view, path, assistanceContext),
		setDisabled: (next: boolean) => {
			locked = next;
			if (next) closeCompletion(view);
			view.dispatch({ effects: access.reconfigure(editable(locked)) });
		},
		setValue: (next: string, reset = false) => {
			if (reset) sessionVersion = sessions?.version(path) ?? 0;
			replace(next, reset);
		},
		setContext: (next: AssistanceContext) => {
			const previous = assistanceContext;
			if (
				previous &&
				(previous.reference !== next.reference ||
					previous.paths.join('\n') !== next.paths.join('\n') ||
					previous.documents
						.filter((doc) => doc.path !== path)
						.some(
							(doc) => next.documents.find((other) => other.path === doc.path)?.text !== doc.text
						) ||
					previous.documents.length !== next.documents.length)
			)
				closeCompletion(view);
			assistanceContext = next;
		},
		setReference: (next: ReferenceCatalogue | null) => {
			if (catalogue === next) return;
			catalogue = next;
			view.dispatch({ effects: help.reconfigure(helpExtension()) });
		},
		destroy: () => {
			if (
				sessions &&
				!sessions.put(path, sessionVersion, view.state.toJSON({ history: historyField }))
			)
				onHistoryLimit?.();
			view.destroy();
		}
	};
}
