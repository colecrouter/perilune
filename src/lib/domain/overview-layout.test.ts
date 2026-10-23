import { expect, it } from 'vite-plus/test';
import { checkedOverviewLayout, overviewLayout, overviewPreset } from './overview-layout.js';
import { preferencePatch } from './preferences.js';
it('defaults old or invalid layouts and refuses duplicate, missing or unknown panels', () => {
	for (const value of [
		undefined,
		null,
		{},
		{ ...overviewPreset('balanced'), order: ['camera', 'camera', 'history', 'connection'] },
		{ ...overviewPreset('balanced'), hidden: ['camera', 'camera'] },
		{ ...overviewPreset('balanced'), order: ['camera'] },
		{ ...overviewPreset('balanced'), hidden: ['job'] }
	]) {
		expect(overviewLayout(value)).toEqual(overviewPreset('balanced'));
		if (value !== undefined) expect(() => preferencePatch({ overviewLayout: value })).toThrow();
	}
});
it('accepts all panels hidden while mandatory state remains outside layout preferences', () => {
	const value = {
		...overviewPreset('camera'),
		order: ['connection', 'history', 'temperature', 'camera'],
		hidden: ['connection', 'history', 'temperature', 'camera']
	};
	expect(checkedOverviewLayout(value)).toEqual(value);
	expect(() => preferencePatch({ overviewLayout: { ...value, safety: false } })).toThrow();
});
