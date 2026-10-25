<script lang="ts">
	import { liveQuery } from '#lib/client/live-query.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import MotionControls from '#lib/components/MotionControls.svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import { onMount } from 'svelte';
	import { getPrinter, submitAction } from '../printer.remote.js';
	let { data } = $props();
	const printer = liveQuery(getPrinter);
	const initial = $derived(data.initial!.printer);
	const updates = liveConnection(() => printer.connected);
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
	});
	const snapshot = $derived(printer.current ?? initial);
</script>

<svelte:head><title>Printer controls · Perilune</title></svelte:head>
<AppShell {snapshot} active="Controls"
	><div class="controls-page page-frame serif">
		<header>
			<h1>Printer controls</h1>
			{#if data.user?.role !== 'viewer'}<a href="/filament">Filament-change setup →</a>{/if}
		</header>
		<MotionControls
			progressive
			{snapshot}
			transportConnected={updates.available}
			canOperate={data.user?.role !== 'viewer'}
			onSubmit={(command) => submitAction({ id: crypto.randomUUID(), command })}
		/>
	</div></AppShell
>

<style>
	.controls-page {
		--page-content-max: 75rem;
	}
	header {
		margin-bottom: 1.5rem;
	}
</style>
