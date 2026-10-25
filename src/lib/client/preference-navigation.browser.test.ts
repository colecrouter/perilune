import { expect, test, vi } from 'vite-plus/test';
import { followPreferenceLink } from './preference-navigation.js';
function click(anchor: HTMLAnchorElement, handled = false) {
	const event = new MouseEvent('click', { bubbles: true, cancelable: true });
	anchor.addEventListener(
		'click',
		(e) => {
			if (handled) e.preventDefault();
		},
		{ once: true }
	);
	anchor.dispatchEvent(event);
	return event;
}
test('held saves preserve default client navigation and explicit reload overrides', async () => {
	for (const reload of [undefined, '', 'true', 'false']) {
		const client = reload === undefined || reload === 'false';
		const anchor = document.createElement('a');
		anchor.href = '/configuration?file=macros.cfg';
		if (reload !== undefined) anchor.dataset.sveltekitReload = reload;
		let release!: () => void;
		const preferences = {
			unsaved: true,
			settle: () =>
				new Promise<boolean>((resolve) => {
					release = () => resolve(true);
				})
		};
		const navigate = { document: vi.fn(), client: vi.fn(async () => {}) };
		const event = click(anchor);
		const pending = followPreferenceLink(event, preferences, navigate);
		expect(event.defaultPrevented).toBe(true);
		expect(navigate.document).not.toHaveBeenCalled();
		expect(navigate.client).not.toHaveBeenCalled();
		release();
		await pending;
		expect(client ? navigate.client : navigate.document).toHaveBeenCalledWith(anchor.href);
		expect(client ? navigate.document : navigate.client).not.toHaveBeenCalled();
	}
});
test('custom confirmation handlers and failed saves never trigger document navigation', async () => {
	const anchor = document.createElement('a');
	anchor.href = '/actions';
	const preferences = { unsaved: true, settle: vi.fn(async () => false) };
	const navigate = { document: vi.fn(), client: vi.fn(async () => {}) };
	await followPreferenceLink(click(anchor, true), preferences, navigate);
	expect(preferences.settle).not.toHaveBeenCalled();
	await followPreferenceLink(click(anchor), preferences, navigate);
	expect(preferences.settle).toHaveBeenCalledOnce();
	expect(navigate.document).not.toHaveBeenCalled();
	expect(navigate.client).not.toHaveBeenCalled();
});

test('pending writes preserve external document links and ignore clean or modified clicks', async () => {
	const preferences = { unsaved: true, settle: vi.fn(async () => true) };
	const navigate = { document: vi.fn(), client: vi.fn(async () => {}) };
	const anchor = document.createElement('a');
	anchor.href = 'https://example.test/guide';
	await followPreferenceLink(click(anchor), preferences, navigate);
	expect(navigate.document).toHaveBeenCalledWith(anchor.href);
	expect(navigate.client).not.toHaveBeenCalled();
	preferences.settle.mockClear();
	navigate.document.mockClear();
	const event = new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true });
	anchor.dispatchEvent(event);
	await followPreferenceLink(event, preferences, navigate);
	await followPreferenceLink(click(anchor), { ...preferences, unsaved: false }, navigate);
	expect(preferences.settle).not.toHaveBeenCalled();
	expect(navigate.document).not.toHaveBeenCalled();
});

test('pending saves retain inherited scroll/focus and history options plus the original destination', async () => {
	const parent = document.createElement('div');
	parent.dataset.sveltekitReset = 'false';
	parent.dataset.sveltekitReplacestate = '';
	const anchor = document.createElement('a');
	anchor.href = '/jobs?sort=name';
	parent.append(anchor);
	let release!: () => void;
	const preferences = {
		unsaved: true,
		settle: () =>
			new Promise<boolean>((resolve) => {
				release = () => resolve(true);
			})
	};
	const navigate = { document: vi.fn(), client: vi.fn(async () => {}) };
	const original = anchor.href;
	const pending = followPreferenceLink(click(anchor), preferences, navigate);
	anchor.href = '/different';
	release();
	await pending;
	expect(navigate.client).toHaveBeenCalledWith(original, { reset: false, replace: true });
});
