<script lang="ts">
	import '#lib/styles.css';
	import PrintFavicon from '#lib/components/PrintFavicon.svelte';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
</script>

<svelte:head
	>{#if !data.user}<link rel="icon" href={favicon} />{/if}</svelte:head
>
{#if data.user}<PrintFavicon />{/if}
{@render children()}
