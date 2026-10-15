/** Raw source remains canonical. This is an editor aid, not a Klipper parser. */
export const MAX_CONFIG_BYTES = 256 * 1024;
export interface ConfigFile {
	path: string;
	version: string;
	updatedAt: number;
}
export interface ConfigBackup {
	id: string;
	createdAt: number;
	actor: string;
}
export interface ConfigDocument extends ConfigFile {
	text: string;
	source: 'simulator' | 'moonraker';
	backups: ConfigBackup[];
}
export interface ConfigSave {
	id: string;
	path: string;
	expectedVersion: string;
	text: string;
}
export interface ConfigSaved {
	path: string;
	version: string;
	updatedAt: number;
}
export const validConfigPath = (path: string) =>
	path.length <= 240 &&
	/^[a-zA-Z0-9][a-zA-Z0-9 _./-]*\.(cfg|conf|ini|yaml|yml|json)$/i.test(path) &&
	path.split('/').every((p) => p !== '.' && p !== '..' && !p.startsWith('.') && p.length > 0);
export function checkConfigText(text: string) {
	if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES)
		throw new Error('Configuration files are limited to 256 KiB.');
	if (
		text.includes('\0') ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(text)) !== text
	)
		throw new Error('Use a UTF-8 text file without NUL characters.');
}
export function configParts(text: string) {
	const match = /^#\*#.*SAVE_CONFIG.*$/m.exec(text);
	if (!match)
		return {
			editable: text,
			generated: '',
			warning: text.includes('#*#')
				? 'Generated-looking lines have no recognized SAVE_CONFIG header. Inspect the raw source before using Klipper SAVE_CONFIG.'
				: null
		};
	let index = match.index;
	if (index > 0 && text[index - 1] === '\n') {
		index--;
		if (index > 0 && text[index - 1] === '\r') index--;
	}
	const generated = text.slice(index);
	const lines = generated.replace(/\r\n/g, '\n').trim().split('\n');
	const valid =
		lines[0] === '#*# <---------------------- SAVE_CONFIG ---------------------->' &&
		lines[1] === '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.' &&
		lines[2] === '#*#' &&
		lines.slice(3).every((line) => line === '#*#' || line.startsWith('#*# '));
	return {
		editable: text.slice(0, index),
		generated,
		warning: valid
			? null
			: 'The generated-settings block has an unexpected header or ordinary text below it. Klipper may ignore these saved values. Perilune preserves the block rather than silently repairing it.'
	};
}
export function checkConfigChange(before: string, after: string) {
	checkConfigText(after);
	if (configParts(before).generated !== configParts(after).generated)
		throw new Error(
			'Calibration-generated settings must remain unchanged. Edit above the protected block.'
		);
}
/** Apply the smallest textarea edit, preserving untouched source and CRLF endings. */
export function rawConfigEdit(previous: string, input: string): string {
	const normalized = previous.replace(/\r\n/g, '\n');
	if (normalized === input) return previous;
	let start = 0,
		end = 0;
	while (start < Math.min(normalized.length, input.length) && normalized[start] === input[start])
		start++;
	while (
		end < normalized.length - start &&
		end < input.length - start &&
		normalized[normalized.length - 1 - end] === input[input.length - 1 - end]
	)
		end++;
	const originalOffset = (offset: number) => {
		let result = 0;
		for (let i = 0; i < offset; i++, result++)
			if (previous[result] === '\r' && previous[result + 1] === '\n') result++;
		return result;
	};
	const newline = previous.includes('\r\n') ? '\r\n' : '\n';
	return (
		previous.slice(0, originalOffset(start)) +
		input.slice(start, input.length - end).replace(/\n/g, newline) +
		previous.slice(originalOffset(normalized.length - end))
	);
}
interface Hint {
	title: string;
	help: string;
	min: number;
	max: number;
	section: string;
}
export const configHints: Record<string, Hint> = {
	'printer.max_velocity': {
		title: 'Maximum velocity',
		help: 'Upper speed limit in mm/s. Slicer requests are capped by firmware; this does not describe the current speed.',
		min: 1,
		max: 2000,
		section: 'printer'
	},
	'printer.max_accel': {
		title: 'Maximum acceleration',
		help: 'Configured acceleration limit in mm/s². Mechanical limits and print quality should guide changes.',
		min: 1,
		max: 100000,
		section: 'printer'
	},
	'printer.square_corner_velocity': {
		title: 'Corner velocity',
		help: 'Speed allowed through a 90° corner in mm/s. Higher values can increase ringing.',
		min: 0,
		max: 100,
		section: 'printer'
	},
	'extruder.rotation_distance': {
		title: 'Extruder rotation distance',
		help: 'Filament travel per configured motor/gear rotation in mm. Keep gear_ratio unchanged when using the extrusion-distance calculator.',
		min: 0.001,
		max: 1000,
		section: 'extruder'
	},
	'extruder.nozzle_diameter': {
		title: 'Nozzle diameter',
		help: 'Installed nozzle diameter in mm. Keep the slicer profile consistent with the physical nozzle.',
		min: 0.1,
		max: 5,
		section: 'extruder'
	},
	'extruder.filament_diameter': {
		title: 'Filament diameter',
		help: 'Nominal filament diameter in mm. This differs from slicer flow ratio.',
		min: 1,
		max: 4,
		section: 'extruder'
	},
	'extruder.pressure_advance': {
		title: 'Pressure advance',
		help: 'Compensation for changing nozzle pressure. Tune with a dedicated test for the filament and toolhead.',
		min: 0,
		max: 2,
		section: 'extruder'
	},
	'extruder.min_extrude_temp': {
		title: 'Minimum extrusion temperature',
		help: 'Firmware safeguard against cold extrusion. Lowering this can damage the filament path; it is not a preheat target.',
		min: 0,
		max: 350,
		section: 'extruder'
	},
	'heater_bed.max_temp': {
		title: 'Bed temperature limit',
		help: 'Firmware upper limit, not a requested temperature. Check heater, surface, sensor, and wiring ratings.',
		min: 0,
		max: 200,
		section: 'heater_bed'
	},
	'probe.z_offset': {
		title: 'Probe Z offset',
		help: 'Distance from probe trigger to nozzle contact. This is a probe calibration value, not an incremental live Z adjustment.',
		min: -20,
		max: 50,
		section: 'probe'
	},
	'bltouch.z_offset': {
		title: 'BLTouch Z offset',
		help: 'Probe trigger-to-nozzle distance. Use a probe-reference calibration procedure before changing it.',
		min: -20,
		max: 50,
		section: 'bltouch'
	}
};
export interface ConfigField {
	id: string;
	section: string;
	key: string;
	value: string;
	start: number;
	end: number;
	line: number;
	hint: Hint;
	editable: boolean;
}
export function configFields(text: string): ConfigField[] {
	const editable = configParts(text).editable;
	const lines = editable.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const nextSubstantive: string[] = new Array(lines.length);
	let following = '';
	for (let i = lines.length - 1; i >= 0; i--) {
		nextSubstantive[i] = following;
		if (lines[i]!.trim() && !/^[ \t]*[#;]/.test(lines[i]!)) following = lines[i]!;
	}
	const sections = new Map<string, number>();
	let section = '',
		offset = 0;
	const result: ConfigField[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const heading = /^\[([^\]\r\n]+)\][ \t]*(?:[#;].*)?\r?\n?$/.exec(line.replace(/^\uFEFF/, ''));
		if (heading) {
			section = heading[1]!;
			sections.set(section, (sections.get(section) ?? 0) + 1);
		}
		const option = /^([a-zA-Z_][a-zA-Z0-9_]*)([ \t]*[:=][ \t]*)([^\r\n]*)(?:\r?\n)?$/.exec(line);
		if (option) {
			const key = option[1]!.toLowerCase();
			const hint = configHints[`${section}.${key}`];
			if (hint) {
				const raw = option[3]!;
				const value = raw.split(/[;#]/, 1)[0]!.trimEnd();
				result.push({
					id: `${section}.${key}`,
					section,
					key,
					value,
					start: offset + option[1]!.length + option[2]!.length,
					end: offset + option[1]!.length + option[2]!.length + value.length,
					line: i + 1,
					hint,
					editable:
						/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) &&
						!/^[ \t]+[^#;\s]/.test(nextSubstantive[i] ?? '')
				});
			}
		}
		offset += line.length;
	}
	const counts = new Map<string, number>();
	for (const field of result) counts.set(field.id, (counts.get(field.id) ?? 0) + 1);
	return result.map((field) => ({
		...field,
		editable: field.editable && sections.get(field.section) === 1 && counts.get(field.id) === 1
	}));
}
export function updateConfigField(text: string, id: string, value: string): string {
	const fields = configFields(text).filter((f) => f.id === id);
	const field = fields[0];
	if (fields.length !== 1 || !field?.editable)
		throw new Error('This setting is ambiguous or multiline. Use the raw source editor.');
	const numeric = Number(value);
	if (
		!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ||
		!Number.isFinite(numeric) ||
		numeric < field.hint.min ||
		numeric > field.hint.max
	)
		throw new Error(`Use a number between ${field.hint.min} and ${field.hint.max}.`);
	return text.slice(0, field.start) + value + text.slice(field.end);
}
export function configDiff(before: string, after: string) {
	const old = before.split('\n'),
		next = after.split('\n');
	let prefix = 0,
		suffix = 0;
	while (prefix < Math.min(old.length, next.length) && old[prefix] === next[prefix]) prefix++;
	while (
		suffix < old.length - prefix &&
		suffix < next.length - prefix &&
		old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
	)
		suffix++;
	const removed = old.slice(prefix, old.length - suffix),
		added = next.slice(prefix, next.length - suffix);
	return {
		line: prefix + 1,
		removed: removed.slice(0, 200),
		added: added.slice(0, 200),
		truncated: removed.length > 200 || added.length > 200,
		changed: before !== after
	};
}
