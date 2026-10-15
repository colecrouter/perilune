<script lang="ts">
	import '#lib/styles.css';
	import AppUpdate from '#lib/components/AppUpdate.svelte';
	import PrintFavicon from '#lib/components/PrintFavicon.svelte';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
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
{#if data.user}<PrintFavicon />{/if}
{@render children()}

<AppUpdate />
