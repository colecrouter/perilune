import { expect, it } from 'vite-plus/test';
import { receivesNotice } from './notice-audience.js';
const personal = { allPrints: false, sharedErrors: false };
it('keeps known print events private to the initiating account by default', () => {
	for (const kind of ['complete', 'failed', 'printerError'] as const) {
		expect(receivesNotice('starter', kind, { type: 'job', owner: 'starter' }, personal)).toBe(true);
		expect(receivesNotice('other', kind, { type: 'job', owner: 'starter' }, personal)).toBe(false);
	}
});
it('requires explicit shared choices for unknown jobs and printer-wide errors', () => {
	expect(receivesNotice('other', 'complete', { type: 'job', owner: null }, personal)).toBe(false);
	expect(
		receivesNotice(
			'other',
			'complete',
			{ type: 'job', owner: null },
			{ ...personal, allPrints: true }
		)
	).toBe(true);
	expect(receivesNotice('other', 'printerError', { type: 'printer' }, personal)).toBe(false);
	expect(
		receivesNotice(
			'other',
			'printerError',
			{ type: 'printer' },
			{ ...personal, sharedErrors: true }
		)
	).toBe(true);
	expect(
		receivesNotice('other', 'printerError', { type: 'printer' }, { ...personal, allPrints: true })
	).toBe(false);
});
