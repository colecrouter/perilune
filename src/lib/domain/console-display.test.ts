import { expect, test } from 'vite-plus/test';
import { groupConsoleLines, type ConsoleDisplayLine } from './console-display.js';
const line = (
	text: string,
	at: number,
	extra: Partial<ConsoleDisplayLine> = {}
): ConsoleDisplayLine => ({
	id: String(at),
	at,
	kind: 'response',
	text,
	detail: 'Printer response',
	...extra
});
test('groups adjacent exact responses while retaining every original and boundaries', () => {
	const original = [
		line('// Already paused', 1),
		line('// Already paused', 2),
		line('other', 3),
		line('// Already paused', 4),
		line('// Already paused', 40_000)
	];
	const groups = groupConsoleLines(original, true);
	expect(groups.map((g) => g.lines.length)).toEqual([2, 1, 1, 1]);
	expect(groups.flatMap((g) => g.lines)).toEqual(original);
	expect(groupConsoleLines(original, false)).toHaveLength(5);
});
test('groups changing temperature reports but never differing probes, errors, or command receipts', () => {
	const original = [
		line('B:25.0 /0.0 T0:26.0 /0.0', 1),
		line('B:25.1 /0.0 T0:26.1 /0.0', 2),
		line('!! fault', 3, { kind: 'error' }),
		line('B:25.2 /0.0 T0:26.2 /0.0', 4),
		line('// probe: at 0,0 bed will contact at z=0.1', 5),
		line('// probe: at 1,0 bed will contact at z=0.2', 6)
	];
	expect(groupConsoleLines(original, true).map((g) => g.lines.length)).toEqual([2, 1, 1, 1, 1]);
	const receipt = {
		id: 'r',
		script: 'HELP',
		status: 'completed' as const,
		createdAt: 1,
		message: null,
		output: []
	};
	expect(
		groupConsoleLines(
			[line('HELP', 1, { receipt }), line('HELP', 2, { receipt: { ...receipt, id: 'r2' } })],
			true
		)
	).toHaveLength(2);
});
