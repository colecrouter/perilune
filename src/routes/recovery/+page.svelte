<script lang="ts">
	import { onMount } from 'svelte';
	import { liveQuery } from '#lib/client/live-query.js';
	import { getPrinter } from '../printer.remote.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import PrintRecovery from '#lib/components/PrintRecovery.svelte';
	let { data } = $props();
	const source = liveQuery(getPrinter);
	const snapshot = $derived(source.current ?? data.snapshot);
	onMount(() => {
		void Promise.resolve(source).catch(() => {});
	});
</script>

<svelte:head><title>Restore print controls · Perilune</title></svelte:head>
<AppShell {snapshot} active="Controls"><PrintRecovery {snapshot} /></AppShell>
