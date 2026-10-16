<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
	import MotionControls from '#lib/components/MotionControls.svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import { onMount } from 'svelte';
	import { getPrinter, submitAction } from '../printer.remote.js';
	let { data } = $props();
	const printer = getPrinter();
	const initial = $derived(data.initial!.printer);
	const updates = liveConnection(() => printer.connected);
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
	});
	const snapshot = $derived(printer.current ?? initial);
</script>

<svelte:head><title>Printer controls · Perilune</title></svelte:head>
<AppShell {snapshot} active="Controls"
	><div class="controls-page serif">
		<header>
			<p class="eyebrow">At your command</p>
			<h1>Printer controls</h1>
			<p>Review a destination, then move with clear limits and shared action state.</p>
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
		max-width: 1200px;
		margin: auto;
		padding: clamp(1rem, 4vw, 2.5rem);
	}
	header {
		margin-bottom: 1.5rem;
	}
	header > p:last-child {
		color: var(--muted);
		margin-top: 0.6rem;
	}
</style>
