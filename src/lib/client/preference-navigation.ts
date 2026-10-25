/** Wait for private preference writes while preserving the link's chosen navigation mode. */
export async function followPreferenceLink(
	event: MouseEvent,
	preferences: { readonly unsaved: boolean; settle(): Promise<boolean> },
	navigate: {
		document: (url: string) => void;
		client: (url: string, options?: { reset?: boolean; replace?: boolean }) => Promise<unknown>;
	}
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
	const option = (name: string) =>
		anchor.closest(`[data-sveltekit-${name}]`)?.getAttribute(`data-sveltekit-${name}`);
	const reload = option('reload');
	const reset = option('reset');
	const replace = option('replacestate');
	const options: { reset?: boolean; replace?: boolean } = {};
	if (reset !== undefined) options.reset = reset !== 'false';
	if (replace !== undefined) options.replace = replace !== 'false';
	const href = anchor.href;
	const documentLink =
		(reload !== undefined && reload !== 'false') ||
		anchor.origin !== location.origin ||
		anchor.relList.contains('external');
	event.preventDefault();
	if (!(await preferences.settle())) return;
	if (documentLink) navigate.document(href);
	else if (Object.keys(options).length) await navigate.client(href, options);
	else await navigate.client(href);
}
