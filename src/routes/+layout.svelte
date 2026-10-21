<script lang="ts">
	import '#lib/styles.css';
	import { followPreferenceLink } from '#lib/client/preference-navigation.js';
	import { goto } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import { createPreferences, providePreferences } from '#lib/client/preferences.svelte.js';
	import { defaultPreferences } from '#lib/domain/preferences.js';
	import { page } from '$app/state';
	import { calibrationHandoff } from '#lib/client/calibration-draft.svelte.js';
	import AppUpdate from '#lib/components/AppUpdate.svelte';
	import PrintFavicon from '#lib/components/PrintFavicon.svelte';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
	const preferences = createPreferences(
		untrack(() => data.user?.id ?? null),
		untrack(() => data.preferences ?? defaultPreferences)
	);
	providePreferences(preferences);
	$effect(() =>
		preferences.switchAccount(data.user?.id ?? null, data.preferences ?? defaultPreferences)
	);
	onDestroy(() => preferences.destroy());
	const followLink = (event: MouseEvent) =>
		followPreferenceLink(event, preferences, {
			document: (url) => location.assign(url),
			client: (url) => goto(url)
		});

	$effect(() => {
		if (
			calibrationHandoff.proposal &&
			(data.user?.role !== 'owner' || data.user.id !== calibrationHandoff.proposal.ownerId)
		)
			calibrationHandoff.proposal = null;
	});
</script>

<svelte:head
	><link rel="manifest" href="/manifest.webmanifest" /><link
		rel="apple-touch-icon"
		href="/icons/app-180.png"
	/><meta name="theme-color" content="#15182b" /><meta
		name="apple-mobile-web-app-title"
		content="Perilune"
	/>{#if !data.user}<link rel="icon" href={favicon} />{/if}</svelte:head
>
{#if data.user}{#key page.url.pathname === '/'}<PrintFavicon
			overview={page.url.pathname === '/'}
		/>{/key}{/if}
<svelte:window
	onbeforeunload={(event) => {
		if (preferences.unsaved) event.preventDefault();
	}}
/>
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
	onclick={followLink}
	data-sveltekit-reload
	class="app-preferences"
	data-serif={preferences.values.serif}
>
	{@render children()}
	{#if data.preferencesUnavailable}<p class="preference-error" role="status">
			Saved display preferences are unavailable. Showing defaults until they can be loaded again.
		</p>{/if}
	{#if preferences.error}<div class="preference-error" role="alert">
			{preferences.error}
			<button onclick={() => preferences.retry()} disabled={preferences.saving}
				>Retry saving preferences</button
			>
		</div>{/if}
</div>

<AppUpdate />
