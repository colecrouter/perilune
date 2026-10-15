<script lang="ts">
	import { goto } from '$app/navigation';
	import { calibrationHandoff } from '#lib/client/calibration-draft.svelte.js';
	import { calculateExtrusion, type ExtrusionProposal } from '#lib/domain/extrusion.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import ExtrusionWorkshop from '#lib/components/ExtrusionWorkshop.svelte';
	import type { PrinterCommand } from '#lib/domain/printer.js';
	import { getDashboard, submitAction } from '../../printer.remote.js';
	let { data } = $props();
	const dashboard = getDashboard();
	const initial = await dashboard;
	const snapshot = $derived(dashboard.current?.printer ?? initial.printer);
	function reviewProposal(measurement: ExtrusionProposal) {
		if (data.user?.role !== 'owner') return;
		calibrationHandoff.proposal = {
			id: crypto.randomUUID(),
			ownerId: data.user.id,
			createdAt: Date.now(),
			source: snapshot.mode === 'simulator' ? 'simulator' : 'moonraker',
			measurement: calculateExtrusion(
				measurement.rotationDistance,
				measurement.before,
				measurement.after
			)
		};
		void goto('/configuration');
	}
	async function submit(command: PrinterCommand) {
		return (
			await submitAction({
				id:
					command.type === 'extrusionBegin' || command.type === 'extrusionFeed'
						? command.runId
						: crypto.randomUUID(),
				command
			})
		).id;
	}
</script>

<svelte:head><title>Filament & extrusion · Perilune</title></svelte:head>
<AppShell active="Calibration"
	><div class="page serif">
		<header>
			<p class="eyebrow">Calibration workshop</p>
			<h1>Filament & extrusion</h1>
			<p class="muted">Check the distance. Understand the adjustment.</p>
		</header>
		<ExtrusionWorkshop
			{snapshot}
			connected={dashboard.connected}
			userId={data.user?.id ?? ''}
			role={data.user?.role ?? 'viewer'}
			onSubmit={submit}
			onReviewProposal={reviewProposal}
		/>
	</div></AppShell
>

<style>
	.page {
		padding: clamp(1.2rem, 4vw, 3rem);
	}
	header {
		margin-bottom: 2rem;
	}
	h1 {
		font-size: clamp(2rem, 5vw, 3rem);
		margin: 0.4rem 0;
	}
	.muted {
		color: var(--muted);
	}
</style>
