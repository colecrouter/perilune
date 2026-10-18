import { expect, it } from 'vite-plus/test';
import { initialSnapshot } from './printer.js';
import {
	noticeTransition,
	quietNow,
	defaultNoticePreferences,
	checkNoticePreferences
} from './notifications.js';
it('announces observed completion once without announcing historical jobs on startup', () => {
	const printing = initialSnapshot();
	const complete = { ...printing, job: { ...printing.job, state: 'complete' as const } };
	expect(noticeTransition(undefined, complete)).toBeUndefined();
	expect(noticeTransition(printing, complete)?.kind).toBe('complete');
	expect(noticeTransition(complete, complete)).toBeUndefined();
	expect(
		noticeTransition(printing, { ...complete, job: { ...complete.job, runId: 'different' } })
	).toBeUndefined();
	expect(noticeTransition(printing, { ...complete, telemetryReady: false })).toBeUndefined();
	expect(noticeTransition(printing, { ...complete, connection: 'reconnecting' })).toBeUndefined();
	expect(
		noticeTransition(printing, { ...complete, job: { ...complete.job, state: 'cancelled' } })
	).toBeUndefined();
});
it('distinguishes errors from reconnects', () => {
	const ready = initialSnapshot();
	expect(noticeTransition(ready, { ...ready, klippy: 'error' })?.kind).toBe('printerError');
	expect(
		noticeTransition(ready, { ...ready, klippy: 'disconnected', connection: 'reconnecting' })
	).toBeUndefined();
	expect(
		noticeTransition({ ...ready, klippy: 'error' }, { ...ready, klippy: 'error' })
	).toBeUndefined();
});
it('handles overnight quiet hours in the device timezone and equal boundaries', () => {
	const preferences = { ...defaultNoticePreferences, quiet: true, timezone: 'America/Regina' };
	expect(quietNow(preferences, new Date('2026-10-14T05:00:00Z'))).toBe(true);
	expect(quietNow(preferences, new Date('2026-10-14T16:00:00Z'))).toBe(false);
	expect(quietNow({ ...preferences, quietStart: '08:00', quietEnd: '08:00' })).toBe(true);
	expect(() => checkNoticePreferences({ ...preferences, timezone: 'invalid-zone' })).toThrow();
	expect(() => checkNoticePreferences({ ...preferences, quietStart: '25:00' })).toThrow();
});

it('migrates old device preferences to account-only notices and rejects malformed opt-ins', () => {
	const { allPrints: _all, sharedErrors: _shared, ...old } = defaultNoticePreferences;
	expect(checkNoticePreferences(old)).toMatchObject({ allPrints: false, sharedErrors: false });
	expect(() => checkNoticePreferences({ ...old, allPrints: 'true' })).toThrow();
	expect(() => checkNoticePreferences({ ...old, sharedErrors: null })).toThrow();
});
