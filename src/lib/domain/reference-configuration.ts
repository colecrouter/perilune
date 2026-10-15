import { configParts, checkConfigChange } from './configuration.js';
import { referenceMatches, type ReferenceOption } from './klipper-reference.js';
export interface SourceSection {
	name: string;
	start: number;
	end: number;
	safe: boolean;
	keys: string[];
}
/** Conservative local-source inventory, not include resolution or Klipper validation. */
export function referenceInventory(text: string) {
	const parts = configParts(text);
	const scan = (source: string) => {
		const result: SourceSection[] = [];
		let offset = 0,
			current: SourceSection | null = null;
		for (const line of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
			const clean = line.replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
			const header = /^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:[#;].*)?$/.exec(clean);
			if (header) {
				if (current) current.end = offset;
				current = {
					name: header[1]!.trim(),
					start: offset,
					end: source.length,
					safe: !/^\s/.test(clean) && !header[1]!.startsWith('include '),
					keys: []
				};
				result.push(current);
			} else if (current) {
				const field = /^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*[:=]/.exec(clean);
				if (field) current.keys.push(field[1]!.toLowerCase());
			}
			offset += line.length;
		}
		return result;
	};
	const sections = scan(parts.editable);
	const generated = scan(
		parts.generated
			.split('\n')
			.filter((line) => line.startsWith('#*#'))
			.map((line) => line.replace(/^#\*# ?/, ''))
			.join('\n')
	);
	const hasIncludes = sections.some((s) => s.name.startsWith('include '));
	const printer = sections.filter((s) => s.name === 'printer');
	const kinematics =
		printer.length === 1
			? (/^[ \t]*kinematics[ \t]*[:=][ \t]*([a-z_]+)[ \t]*(?:[#;].*)?$/m.exec(
					parts.editable.slice(printer[0]!.start, printer[0]!.end)
				)?.[1] ?? null)
			: null;
	return { parts, sections, generated, hasIncludes, kinematics };
}
export function referencePresence(text: string, section: string, key: string) {
	return inventoryPresence(referenceInventory(text), section, key);
}
export function inventoryPresence(
	inventory: ReturnType<typeof referenceInventory>,
	section: string,
	key: string
) {
	const local = inventory.sections.filter((s) => s.name === section);
	if (local.length !== 1 || !local[0]!.safe) return 'ambiguous' as const;
	if (local[0]!.keys.includes(key)) return 'configured' as const;
	if (inventory.generated.some((s) => s.name === section && s.keys.includes(key)))
		return 'generated' as const;
	return inventory.hasIncludes ? ('check-includes' as const) : ('not-local' as const);
}
export function addReferenceOption(
	text: string,
	section: string,
	option: ReferenceOption,
	value: string,
	context: string | null,
	includesReviewed: boolean
) {
	const inventory = referenceInventory(text);
	if (
		!referenceMatches(option, section, context) ||
		(option.context && inventory.kinematics && option.context !== inventory.kinematics)
	)
		throw new Error('Choose documentation matching this section and kinematics context.');
	if (inventory.parts.warning)
		throw new Error('Inspect the generated-settings warning before adding an option.');
	const presence = referencePresence(text, section, option.key);
	if (presence === 'configured' || presence === 'generated')
		throw new Error('This option already exists in the local source or generated settings.');
	if (presence === 'ambiguous')
		throw new Error('This section is repeated or ambiguous. Edit its raw source instead.');
	if (presence === 'check-includes' && !includesReviewed)
		throw new Error('Check included files for this option before adding a local value.');
	if (!value.trim() || value.length > 240 || /[\r\n\0]/.test(value) || /^[ \t]*[#;]/.test(value))
		throw new Error('Enter an explicit single-line value. Multiline values belong in raw source.');
	if (inventory.parts.editable.replace(/\r\n/g, '').includes('\r'))
		throw new Error('Use raw source for a file with standalone carriage returns.');
	const target = inventory.sections.find((s) => s.name === section)!;
	const prefix = inventory.parts.editable.slice(0, target.end),
		suffix = inventory.parts.editable.slice(target.end);
	const newline = inventory.parts.editable.includes('\r\n') ? '\r\n' : '\n';
	const result =
		prefix +
		(prefix.endsWith('\n') ? '' : newline) +
		option.key +
		': ' +
		value +
		newline +
		suffix +
		inventory.parts.generated;
	checkConfigChange(text, result);
	return result;
}
