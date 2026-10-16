<script lang="ts">
	import '#lib/styles.css';
	import { page } from '$app/state';
	import { calibrationHandoff } from '#lib/client/calibration-draft.svelte.js';
	import AppUpdate from '#lib/components/AppUpdate.svelte';
	import PrintFavicon from '#lib/components/PrintFavicon.svelte';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
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
{@render children()}

<AppUpdate />
