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
test('held saves delay document links and preserve configuration client navigation', async () => {
	for (const client of [false, true]) {
		const anchor = document.createElement('a');
		anchor.href = '/configuration?file=macros.cfg';
		if (client) anchor.dataset.sveltekitReload = 'false';
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
