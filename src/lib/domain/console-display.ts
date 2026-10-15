import type { ConsoleReceipt } from './console.js';
export type ConsoleDisplayLine = {
	id: string;
	at: number;
	kind: string;
	text: string;
	detail: string;
	receipt?: ConsoleReceipt;
};
const temperature = (text: string) =>
	/^(?:(?:B|T\d*):\s*-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?\s*)+$/.test(text.trim());
/** Presentation only: retain every original, never merge submissions or cross intervening activity. */
export function groupConsoleLines(lines: ConsoleDisplayLine[], compact: boolean) {
	const groups: {
		id: string;
		latest: ConsoleDisplayLine;
		lines: ConsoleDisplayLine[];
		temperature: boolean;
	}[] = [];
	for (const line of lines) {
		const previous = groups.at(-1);
		const isTemperature = line.kind === 'response' && temperature(line.text);
		if (
			compact &&
			previous &&
			!line.receipt &&
			!previous.latest.receipt &&
			line.kind === previous.latest.kind &&
			line.at - previous.latest.at <= 30_000 &&
			(line.text === previous.latest.text || (isTemperature && previous.temperature))
		) {
			previous.lines.push(line);
			previous.latest = line;
		} else groups.push({ id: line.id, latest: line, lines: [line], temperature: isTemperature });
	}
	return groups;
}
