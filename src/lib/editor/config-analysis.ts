import { parser } from './jinja/language.js';
import { configParts, validConfigPath } from '#lib/domain/configuration.js';
export interface Location {
	path: string;
	from: number;
	to: number;
	line: number;
}
export interface Problem extends Location {
	severity: 'error' | 'warning' | 'info';
	message: string;
}
export interface Section extends Location {
	name: string;
}
export interface Option extends Location {
	key: string;
	section: string;
	valueFrom: number;
	end: number;
}
export interface SourceAnalysis {
	path: string;
	text: string;
	sections: Section[];
	options: Option[];
	templates: { from: number; to: number; text: string }[];
	problems: Problem[];
}
export interface WorkspaceDocument {
	path: string;
	text: string;
}
export interface Definition extends Location {
	name: string;
	kind: 'macro' | 'include';
}
export const MAX_PROBLEMS = 50;
/** Match Klipper's # stripping, then ConfigParser's whitespace-delimited semicolon comments.
 * Mask instead of deleting so every range still addresses the original UTF-16 source. */
function maskComments(text: string) {
	return text.replace(/[^\r\n]+/g, (line) => {
		const hash = line.indexOf('#'),
			semi = /(^|\s);/.exec(line);
		const at = Math.min(
			hash < 0 ? line.length : hash,
			semi ? semi.index + semi[1]!.length : line.length
		);
		return line.slice(0, at) + ' '.repeat(line.length - at);
	});
}
const templateOption = (section: string, key: string) =>
	key === 'gcode' ||
	key.endsWith('_gcode') ||
	(section.startsWith('menu ') && ['name', 'enable'].includes(key)) ||
	(section.startsWith('display_template ') && key === 'text');
/** Conservative delimiters/block checks independent of the broader Jinja grammar. */
function templateProblems(body: string) {
	const errors: { from: number; to: number; message: string }[] = [];
	const blocks: { name: string; from: number }[] = [];
	for (let cursor = 0; cursor < body.length;) {
		const start = body.indexOf('{', cursor);
		if (start < 0) break;
		const tag = body[start + 1] === '%';
		let quote = '',
			escaped = false,
			end = -1;
		const brackets: string[] = tag ? [] : ['}'];
		for (let i = start + (tag ? 2 : 1); i < body.length; i++) {
			const ch = body[i]!;
			if (quote) {
				if (escaped) escaped = false;
				else if (ch === '\\') escaped = true;
				else if (ch === quote) quote = '';
				continue;
			}
			if (ch === '"' || ch === "'") {
				quote = ch;
				continue;
			}
			if (tag && ch === '%' && body[i + 1] === '}') {
				end = i + 2;
				break;
			}
			if (!tag) {
				if ('([{'.includes(ch)) brackets.push(ch === '(' ? ')' : ch === '[' ? ']' : '}');
				else if (ch === brackets.at(-1)) {
					brackets.pop();
					if (!brackets.length) {
						end = i + 1;
						break;
					}
				}
			}
		}
		if (end < 0) {
			errors.push({
				from: start,
				to: start + (tag ? 2 : 1),
				message: tag ? 'Close this template tag with %}.' : 'Close this template expression with }.'
			});
			break;
		}
		if (tag) {
			const content = body
				.slice(start + 2, end - 2)
				.replace(/^[+-]|[+-]$|^\s+|\s+$/g, '')
				.trim();
			const name = /^\w+/.exec(content)?.[0] ?? '';
			if (name === 'raw') {
				const rest = body.slice(end),
					closing = /{%-?\s*endraw\s*-?%}/.exec(rest);
				if (!closing) {
					errors.push({
						from: start,
						to: start + 2,
						message: 'Close this raw block with {% endraw %}.'
					});
					break;
				}
				cursor = end + closing.index + closing[0].length;
				continue;
			}
			if (
				['if', 'for', 'macro', 'block', 'filter', 'call', 'with', 'autoescape'].includes(name) ||
				(name === 'set' && /^set\s+[A-Za-z_]\w*\s*(?:\||$)/.test(content))
			)
				blocks.push({ name, from: start });
			else if (
				name.startsWith('end') &&
				['if', 'for', 'macro', 'block', 'filter', 'call', 'with', 'autoescape', 'set'].includes(
					name.slice(3)
				)
			) {
				const open = blocks.pop();
				if (!open || name !== 'end' + open.name)
					errors.push({
						from: start,
						to: end,
						message: open
							? `Expected {% end${open.name} %} before this closing tag.`
							: 'This closing tag has no matching opening block.'
					});
			} else if (
				(name === 'elif' && blocks.at(-1)?.name !== 'if') ||
				(name === 'else' && !['if', 'for'].includes(blocks.at(-1)?.name ?? ''))
			)
				errors.push({
					from: start,
					to: end,
					message: 'This branch has no matching if or for block.'
				});
		}
		cursor = end;
	}
	for (const block of blocks.slice(-3))
		errors.push({
			from: block.from,
			to: block.from + 2,
			message: `Close this ${block.name} block with {% end${block.name} %}.`
		});
	return errors.slice(0, 5);
}
export function analyseSource(path: string, text: string, withTemplates = true): SourceAnalysis {
	const result: SourceAnalysis = {
		path,
		text,
		sections: [],
		options: [],
		templates: [],
		problems: []
	};
	if (!/\.(cfg|conf|ini)$/i.test(path)) return result;
	if (text.length > 262144) {
		result.problems.push({
			path,
			from: 0,
			to: 0,
			line: 1,
			severity: 'info',
			message: 'Language assistance is limited to files up to 256 KiB.'
		});
		return result;
	}
	const editable = configParts(text).editable,
		masked = maskComments(editable);
	let offset = 0,
		lineNumber = 0,
		section: Section | undefined,
		option: Option | undefined,
		optionIndent = 0;
	const report = (
		from: number,
		to: number,
		line: number,
		message: string,
		severity: Problem['severity'] = 'error'
	) => {
		if (result.problems.length < MAX_PROBLEMS)
			result.problems.push({ path, from, to, line, message, severity });
	};
	for (const raw of masked.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
		lineNumber++;
		const line = raw.replace(/\r?\n$/, '').replace(/^\uFEFF/, ' '),
			content = line.trim();
		const indent = /^(\s*)/.exec(line)![1]!.length;
		if (content) {
			if (option && indent > optionIndent) {
				option.end = offset + line.length;
			} else if (content.startsWith('[')) {
				option = undefined;
				const header = /^\[([^\]]+)\]/.exec(content);
				if (header) {
					section = {
						path,
						name: header[1]!.trim(),
						from: offset + line.indexOf('['),
						to: offset + line.indexOf(']') + 1,
						line: lineNumber
					};
					result.sections.push(section);
				} else {
					report(offset, offset + line.length, lineNumber, 'Close the section header with ].');
					section = undefined;
				}
			} else {
				const field = /^\s*([^:=\s][^:=]*?)\s*[:=]/.exec(line);
				if (!section)
					report(
						offset,
						offset + line.length,
						lineNumber,
						'Place this setting inside a [section].'
					);
				else if (!field)
					report(
						offset,
						offset + line.length,
						lineNumber,
						'Use name: value, or indent this line as part of the preceding value.'
					);
				if (section && field) {
					const key = field[1]!.trim().toLowerCase();
					option = {
						path,
						key,
						section: section.name,
						from: offset + line.indexOf(field[1]!),
						to: offset + line.indexOf(field[1]!) + key.length,
						line: lineNumber,
						valueFrom: offset + field[0].length,
						end: offset + line.length
					};
					optionIndent = indent;
					result.options.push(option);
				} else option = undefined;
			}
		}
		offset += raw.length;
	}
	for (const item of result.options) {
		if (!templateOption(item.section, item.key)) continue;
		const body = masked.slice(item.valueFrom, item.end);
		result.templates.push({ from: item.valueFrom, to: item.end, text: body });
		if (!withTemplates) continue;
		const structural = templateProblems(body);
		for (const issue of structural) {
			const from = item.valueFrom + issue.from;
			report(
				from,
				item.valueFrom + issue.to,
				text.slice(0, from).split('\n').length,
				issue.message
			);
		}
		if (structural.length) continue;
		const tree = parser.parse(body);
		let count = 0;
		tree.iterate({
			enter(node) {
				if (!node.type.isError || count++ >= 1) return;
				const from = item.valueFrom + node.from,
					to = Math.min(item.end, Math.max(from + 1, item.valueFrom + node.to));
				report(
					from,
					to,
					1 + text.slice(0, from).split('\n').length - 1,
					'Template syntax needs attention here. The editor supports a subset of Jinja; Klipper remains authoritative.',
					'warning'
				);
			}
		});
	}
	return result;
}
/** Resolve a source include relative to its file, without escaping the configuration root. */
export function includePath(from: string, spec: string) {
	if (spec.startsWith('/') || spec.includes('\\')) return null;
	const parts = from.split('/').slice(0, -1);
	for (const part of spec.split('/')) {
		if (part === '..') {
			if (!parts.length) return null;
			parts.pop();
		} else if (part && part !== '.') parts.push(part);
	}
	const path = parts.join('/');
	return validConfigPath(path) ? path : null;
}
export function workspaceDefinitions(documents: readonly WorkspaceDocument[]): Definition[] {
	const definitions: Definition[] = [];
	for (const document of documents.slice(0, 32)) {
		for (const section of analyseSource(document.path, document.text, false).sections) {
			const macro = /^gcode_macro\s+(\S+)$/i.exec(section.name);
			if (macro) definitions.push({ ...section, name: macro[1]!, kind: 'macro' });
		}
	}
	return definitions.slice(0, 2000);
}
export function definitionAt(
	analysis: SourceAnalysis,
	pos: number,
	documents: readonly WorkspaceDocument[],
	knownPaths: readonly string[]
) {
	const lineFrom = analysis.text.lastIndexOf('\n', pos - 1) + 1;
	const lineTo = analysis.text.indexOf('\n', pos);
	const line = analysis.text.slice(lineFrom, lineTo < 0 ? undefined : lineTo);
	const include = /^\s*\[include\s+([^\]]+)\]/i.exec(line);
	if (include) {
		const path = includePath(analysis.path, include[1]!.trim());
		return {
			targets:
				path && knownPaths.includes(path)
					? [{ path, from: 0, to: 0, line: 1, name: path, kind: 'include' as const }]
					: [],
			message: /[*?\[]/.test(include[1]!)
				? 'Wildcard includes can match multiple files; use the file browser to inspect matches.'
				: 'This include is outside the known file list or cannot be resolved safely.'
		};
	}
	// Only the command at the beginning of a literal G-code line is a static macro reference.
	if (!analysis.templates.some((region) => pos >= region.from && pos <= region.to))
		return {
			targets: [],
			message: 'Select a macro command or an include to navigate to its definition.'
		};
	const command = /^\s*([A-Za-z_][\w]*)\b/.exec(line);
	const commandFrom = command ? lineFrom + line.indexOf(command[1]!) : -1;
	if (!command || pos < commandFrom || pos > commandFrom + command[1]!.length)
		return {
			targets: [],
			message: 'Select a literal macro command to navigate to its definition.'
		};
	return {
		targets: workspaceDefinitions(documents).filter(
			(definition) => definition.name.toUpperCase() === command[1]!.toUpperCase()
		),
		message:
			'No unambiguous definition is available in the loaded drafts. Open the defining file to include it in assistance.'
	};
}
