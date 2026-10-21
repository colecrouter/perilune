/** Wait for private preference writes while preserving the link's chosen navigation mode. */
export async function followPreferenceLink(
	event: MouseEvent,
	preferences: { readonly unsaved: boolean; settle(): Promise<boolean> },
	navigate: { document: (url: string) => void; client: (url: string) => Promise<unknown> }
) {
	if (
		!preferences.unsaved ||
		event.defaultPrevented ||
		event.button !== 0 ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.altKey
	)
		return;
	const anchor = event.target instanceof Element ? event.target.closest('a') : null;
	if (
		!anchor?.href ||
		anchor.hasAttribute('download') ||
		(anchor.target && anchor.target !== '_self')
	)
		return;
	event.preventDefault();
	if (!(await preferences.settle())) return;
	if (anchor.closest('[data-sveltekit-reload]')?.getAttribute('data-sveltekit-reload') === 'false')
		await navigate.client(anchor.href);
	else navigate.document(anchor.href);
}
