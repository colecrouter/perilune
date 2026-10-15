import type { PrinterSnapshot } from './printer.js';
export type NoticeKind = 'complete' | 'failed' | 'printerError';
export interface Notice {
	id: string;
	kind: NoticeKind;
	title: string;
	body: string;
}
export interface NoticePreferences {
	complete: boolean;
	failed: boolean;
	printerError: boolean;
	snapshot: boolean;
	quiet: boolean;
	quietStart: string;
	quietEnd: string;
	timezone: string;
}
export const defaultNoticePreferences: NoticePreferences = {
	complete: true,
	failed: true,
	printerError: true,
	snapshot: false,
	quiet: false,
	quietStart: '22:00',
	quietEnd: '08:00',
	timezone: 'UTC'
};
export function noticeTransition(
	previous: PrinterSnapshot | undefined,
	next: PrinterSnapshot
): Notice | undefined {
	if (!previous || next.connection !== 'connected') return;
	if (next.klippy === 'error' || next.klippy === 'shutdown') {
		if (previous.klippy === 'ready')
			return {
				id: crypto.randomUUID(),
				kind: 'printerError',
				title: 'Printer needs attention',
				body: 'Klipper reported an error. Open Perilune for details.'
			};
		return;
	}
	if (!next.telemetryReady || !previous.telemetryReady || next.klippy !== 'ready') return;
	if (
		!['printing', 'paused'].includes(previous.job.state) ||
		previous.job.filename !== next.job.filename ||
		(previous.job.runId && next.job.runId && previous.job.runId !== next.job.runId)
	)
		return;
	const kind =
		next.job.state === 'complete' ? 'complete' : next.job.state === 'error' ? 'failed' : undefined;
	if (!kind) return;
	return {
		id: `${next.job.runId ?? previous.job.runId ?? crypto.randomUUID()}:${kind}`,
		kind,
		title: kind === 'complete' ? 'Print complete' : 'Print needs attention',
		body:
			kind === 'complete'
				? 'Your print has finished. Open Perilune to check it.'
				: 'Your print stopped with an error. Open Perilune for details.'
	};
}
export function checkNoticePreferences(value: unknown): NoticePreferences {
	if (!value || typeof value !== 'object') throw new Error('Choose notification preferences.');
	const p = value as NoticePreferences;
	if (
		!['complete', 'failed', 'printerError', 'snapshot', 'quiet'].every(
			(k) => typeof p[k as keyof NoticePreferences] === 'boolean'
		) ||
		!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.quietStart) ||
		!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.quietEnd) ||
		typeof p.timezone !== 'string' ||
		p.timezone.length > 100
	)
		throw new Error('Invalid notification preferences.');
	new Intl.DateTimeFormat('en', { timeZone: p.timezone }).format();
	return {
		complete: p.complete,
		failed: p.failed,
		printerError: p.printerError,
		snapshot: p.snapshot,
		quiet: p.quiet,
		quietStart: p.quietStart,
		quietEnd: p.quietEnd,
		timezone: p.timezone
	};
}
export function quietNow(p: NoticePreferences, now = new Date()): boolean {
	if (!p.quiet) return false;
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: p.timezone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(now);
	const time = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
	return (
		p.quietStart === p.quietEnd ||
		(p.quietStart < p.quietEnd
			? time >= p.quietStart && time < p.quietEnd
			: time >= p.quietStart || time < p.quietEnd)
	);
}
