import {
	Decoration,
	EditorView,
	activateHover,
	closeHoverTooltips,
	hasHoverTooltips,
	hoverTooltip,
	keymap
} from '@codemirror/view';
import { referenceInventory } from '#lib/domain/reference-configuration.js';
import {
	referenceMatches,
	referenceUrl,
	type ReferenceCatalogue
} from '#lib/domain/klipper-reference.js';

/** Match only top-level option keys, never values, comments, or indented macro bodies. */
export function propertyAt(text: string, pos: number, catalogue: ReferenceCatalogue) {
	const start = text.lastIndexOf('\n', pos - 1) + 1;
	const end = text.indexOf('\n', start);
	const line = text.slice(start, end < 0 ? text.length : end);
	const key = /^(\uFEFF?)([a-z_][a-z0-9_]*)[ \t]*[:=]/i.exec(line);
	if (!key) return null;
	const from = start + key[1]!.length,
		to = from + key[2]!.length;
	if (pos < from || pos > to) return null;
	const inventory = referenceInventory(text);
	const section = inventory.sections.find((s) => s.start <= start && start < s.end);
	if (!section?.safe || inventory.sections.filter((s) => s.name === section.name).length !== 1)
		return null;
	const options = catalogue.options.filter(
		(o) =>
			o.key === key[2]!.toLowerCase() &&
			referenceMatches(o, section.name, inventory.kinematics) &&
			o.description
	);
	const option = options.find((o) => o.context === inventory.kinematics) ?? options[0];
	return option ? { from, to, section: section.name, option } : null;
}
let helpId = 0;
export function propertyHelp(catalogue: ReferenceCatalogue) {
	let keyboardOpening = false;
	const hover = hoverTooltip(
		(view, pos, side) => {
			const match = propertyAt(view.state.doc.toString(), pos, catalogue);
			if (!match || (pos === match.from && side < 0) || (pos === match.to && side > 0)) return null;
			const keyboard = keyboardOpening;
			keyboardOpening = false;
			return {
				pos: match.from,
				end: match.to,
				above: true,
				create() {
					const dom = document.createElement('div');
					dom.className = 'cm-property-help';
					dom.setAttribute('role', keyboard ? 'dialog' : 'tooltip');
					dom.setAttribute('aria-label', `${match.option.key} documentation`);
					if (keyboard) dom.tabIndex = -1;
					const title = dom.appendChild(document.createElement('strong'));
					title.textContent = `[${match.section}] ${match.option.key}`;
					const description = dom.appendChild(document.createElement('p'));
					description.textContent = match.option.description;
					description.id = `config-property-help-${++helpId}`;
					dom.setAttribute('aria-describedby', description.id);
					const link = dom.appendChild(document.createElement('a'));
					link.textContent = 'Klipper documentation ↗';
					link.href = referenceUrl(match.option);
					link.target = '_blank';
					link.rel = 'noreferrer';
					const source = dom.appendChild(document.createElement('small'));
					source.textContent = `Reference ${catalogue.source.revision.slice(0, 12)} · installed firmware may differ`;
					dom.addEventListener('keydown', (event) => {
						if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							view.dispatch({ effects: closeHoverTooltips });
							view.focus();
						}
					});
					return {
						dom,
						mount() {
							if (keyboard) dom.focus({ preventScroll: true });
						}
					};
				}
			};
		},
		{ hoverTime: 350, hideOnChange: true }
	);
	return [
		hover,
		EditorView.decorations.compute([hover.active], (state) =>
			Decoration.set(
				state
					.field(hover.active)
					.filter((t) => t.end !== undefined)
					.map((t) => Decoration.mark({ class: 'cm-property-hover' }).range(t.pos, t.end!))
			)
		),
		keymap.of([
			{
				key: 'Mod-Shift-Space',
				run(view) {
					const pos = view.state.selection.main.head;
					if (!propertyAt(view.state.doc.toString(), pos, catalogue)) return false;
					keyboardOpening = true;
					activateHover(
						view,
						pos,
						propertyAt(view.state.doc.toString(), pos, catalogue)?.to === pos ? -1 : 1,
						{
							tooltip: hover,
							until: (tr) => tr.docChanged || Boolean(tr.selection)
						}
					);
					return true;
				}
			},
			{
				key: 'Escape',
				run(view) {
					if (!hasHoverTooltips(view.state)) return false;
					view.dispatch({ effects: closeHoverTooltips });
					return true;
				}
			}
		])
	];
}
