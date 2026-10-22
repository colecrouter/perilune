import { createAnalysisClient, INLINE_ANALYSIS_LIMIT } from './analysis-client.js';
import {
	autocompletion,
	completionKeymap,
	type CompletionContext,
	type Completion
} from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorView, Decoration, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { highlightTree, type Highlighter } from '@lezer/highlight';
import { parser } from './jinja/language.js';
import {
	analyseSource,
	definitionAt,
	workspaceDefinitions,
	type WorkspaceDocument,
	type Location,
	type Problem
} from './config-analysis.js';
import { referenceMatches, type ReferenceCatalogue } from '#lib/domain/klipper-reference.js';
export interface AssistanceContext {
	documents: readonly WorkspaceDocument[];
	paths: readonly string[];
	reference: ReferenceCatalogue | null;
	onProblems?: (text: string, problems: Problem[]) => void;
	onNavigate?: (target: Location) => void;
	onMessage?: (message: string) => void;
}
export function completions(
	path: string,
	text: string,
	pos: number,
	context: AssistanceContext
): { from: number; options: Completion[] } | null {
	const lineFrom = text.lastIndexOf('\n', pos - 1) + 1,
		before = text.slice(lineFrom, pos);
	const word = /[\w./-]*$/.exec(before)![0];
	let from = pos - word.length;
	const analysis = analyseSource(path, text, false);
	const options: Completion[] = [];
	if (/^\s*\[include\s+/.test(before)) {
		from = lineFrom + /^\s*\[include\s+/.exec(before)![0].length;
		const base = path.split('/').slice(0, -1).join('/');
		for (const candidate of context.paths)
			if (candidate !== path) {
				const relative =
					base && candidate.startsWith(base + '/')
						? candidate.slice(base.length + 1)
						: !base
							? candidate
							: null;
				if (relative)
					options.push({ label: relative, type: 'file', detail: 'Known configuration file' });
			}
	} else if (/^\s*\[[^\]]*$/.test(before)) {
		for (const section of new Set(context.reference?.options.map((o) => o.section) ?? []))
			options.push({ label: section, type: 'class', detail: 'Klipper reference section' });
		return { from: lineFrom + before.indexOf('[') + 1, options: options.slice(0, 200) };
	} else {
		const region = analysis.templates.find((region) => pos >= region.from && pos <= region.to);
		if (region) {
			const token = before.match(/(?:params\.)[A-Za-z_]*$/);
			if (token) {
				const body = region.text;
				for (const match of body.matchAll(/\bparams\.([A-Z][A-Z0-9_]*)/g))
					options.push({
						label: match[1]!,
						type: 'property',
						detail: 'Parameter referenced in this template'
					});
			} else if (/\{|{%|\b(?:set|for)\s/.test(before)) {
				for (const label of [
					'printer',
					'params',
					'rawparams',
					'loop',
					'range',
					'dict',
					'True',
					'False',
					'None',
					'action_respond_info',
					'action_raise_error'
				])
					options.push({ label, type: 'variable', detail: 'Template name' });
				const localPos = pos - region.from;
				if (region.text.length <= INLINE_ANALYSIS_LIMIT)
					parser.parse(region.text).iterate({
						enter(node) {
							if (node.name !== 'Definition' || node.to > localPos) return;
							let scope = node.node.parent;
							while (
								scope &&
								![
									'ForStatement',
									'MacroStatement',
									'CallStatement',
									'WithStatement',
									'BlockStatement'
								].includes(scope.name)
							)
								scope = scope.parent;
							if (scope && (localPos < scope.from || localPos > scope.to)) return;
							options.push({
								label: region.text.slice(node.from, node.to),
								type: 'variable',
								detail: 'Earlier binding in this template scope'
							});
						}
					});
			} else if (/^\s*[A-Za-z_]*$/.test(before)) {
				const names = new Set<string>();
				for (const definition of workspaceDefinitions(context.documents))
					if (!names.has(definition.name.toUpperCase())) {
						names.add(definition.name.toUpperCase());
						options.push({
							label: definition.name,
							type: 'function',
							detail: 'Macro in loaded drafts; availability depends on includes'
						});
					}
			}
		} else {
			const section = [...analysis.sections].reverse().find((s) => s.from <= pos)?.name;
			if (section && /^\s*[a-z_]*$/i.test(before))
				for (const option of context.reference?.options ?? [])
					if (referenceMatches(option, section, null))
						options.push({
							label: option.key,
							type: 'property',
							detail: option.heading,
							info: option.description
						});
		}
	}
	return options.length
		? { from, options: [...new Map(options.map((o) => [o.label, o])).values()].slice(0, 200) }
		: null;
}
export function assistance(
	path: string,
	getContext: () => AssistanceContext,
	highlighter: Highlighter
) {
	const analysisClient = createAnalysisClient();
	let disposed = false;
	const source = (input: CompletionContext) => {
		if (
			input.state.readOnly ||
			(!input.explicit &&
				!/[A-Za-z_./-]$/.test(input.state.sliceDoc(Math.max(0, input.pos - 1), input.pos)))
		)
			return null;
		return completions(path, input.state.doc.toString(), input.pos, getContext());
	};
	const overlays = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}
			destroy() {
				disposed = true;
				analysisClient.destroy();
			}
			update(update: import('@codemirror/view').ViewUpdate) {
				if (update.docChanged) this.decorations = this.build(update.view);
			}
			build(view: EditorView) {
				const marks: ReturnType<ReturnType<typeof Decoration.mark>['range']>[] = [];
				let budget = 64 * 1024;
				for (const region of analyseSource(path, view.state.doc.toString(), false).templates) {
					if (region.text.length > INLINE_ANALYSIS_LIMIT || region.text.length > budget) continue;
					budget -= region.text.length;
					highlightTree(parser.parse(region.text), highlighter, (from, to, classes) => {
						if (to > from)
							marks.push(
								Decoration.mark({ class: classes }).range(region.from + from, region.from + to)
							);
					});
				}
				return Decoration.set(marks, true);
			}
		},
		{ decorations: (value) => value.decorations }
	);
	const go = (view: EditorView) => navigateToDefinition(view, path, getContext());
	return [
		overlays,
		linter(
			async (view) => {
				const document = view.state.doc,
					text = document.toString();
				const problems = await analysisClient.analyse(path, text);
				if (disposed || view.state.doc !== document) return [];
				getContext().onProblems?.(text, problems);
				return problems.map(
					(problem) =>
						({
							from: problem.from,
							to: problem.to,
							severity: problem.severity,
							message: problem.message,
							source: 'Klipper editor'
						}) satisfies Diagnostic
				);
			},
			{ delay: 300 }
		),
		lintGutter(),
		autocompletion({ override: [source], activateOnTyping: true, maxRenderedOptions: 12 }),
		keymap.of([...completionKeymap, { key: 'F12', run: go }]),
		EditorView.domEventHandlers({
			keydown(event, view) {
				if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
					event.preventDefault();
					return go(view);
				}
				return false;
			}
		})
	];
}

export function navigateToDefinition(view: EditorView, path: string, context: AssistanceContext) {
	const analyse = (text: string) => analyseSource(path, text, false);
	const text = view.state.doc.toString(),
		result = definitionAt(
			analyse(text),
			view.state.selection.main.head,
			context.documents,
			context.paths
		);
	if (result.targets.length === 1) context.onNavigate?.(result.targets[0]!);
	else
		context.onMessage?.(
			result.targets.length > 1
				? 'Several loaded files define this macro. Open the intended definition in the file browser.'
				: result.message
		);
	return true;
}
