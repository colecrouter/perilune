<script lang="ts">
	import { resolve } from '$app/paths';
	import AppShell from '#lib/components/AppShell.svelte';
	import BedMeshInspector from '#lib/components/BedMeshInspector.svelte';
	import { getDashboard } from '../../printer.remote.js';
	const dashboard = getDashboard();
	const initial = await dashboard;
	const snapshot = $derived(dashboard.current?.printer ?? initial.printer);
	const fresh = $derived(
		dashboard.connected &&
			snapshot.connection === 'connected' &&
			snapshot.klippy === 'ready' &&
			snapshot.telemetryReady
	);
</script>

<svelte:head><title>Bed mesh · Perilune</title></svelte:head>
<AppShell active="Calibration"
	><div class="mesh-page serif">
		<header>
			<div>
				<p class="eyebrow">Read the shape of your bed</p>
				<h1>Bed mesh</h1>
				<p class="muted">
					Explore the reported height grid, inspect profiles, and understand the variation.
				</p>
			</div>
			<span class="mode-badge"
				>{snapshot.mode === 'simulator' ? 'Simulator examples' : 'Read-only inspection'}</span
			>
		</header>
		<BedMeshInspector
			meshState={snapshot.bedMesh}
			{fresh}
			simulator={snapshot.mode === 'simulator'}
		/>
		<section class="mesh-guide">
			<h2>What does this tell me?</h2>
			<div class="guide-columns">
				<div>
					<h3>Shape, not a verdict</h3>
					<p>
						The range is highest minus lowest reported value. It describes variation across this
						grid; it does not by itself diagnose leveling, probe accuracy, or print quality.
					</p>
				</div>
				<div>
					<h3>Samples and compensation</h3>
					<p>
						This view uses Klipper’s reported probed matrix, not its denser interpolated
						compensation grid. Round beds and faulty regions may include extrapolated or substituted
						values.
					</p>
				</div>
				<div>
					<h3>Compare like with like</h3>
					<p>
						Profile differences require matching grid coordinates. Temperature, probing conditions,
						and reference changes can affect comparisons; their measurement time and temperature are
						not supplied here.
					</p>
				</div>
			</div>
			<p>
				Inspecting a profile does not activate it. Probing, loading profiles, and saving changes
				will come with guided workflows after printer testing.
			</p>
			<a href="https://www.klipper3d.org/Bed_Mesh.html" target="_blank" rel="noreferrer"
				>Understanding bed mesh in Klipper ↗</a
			>
		</section>
	</div></AppShell
>

<style>
	.mesh-page {
		max-width: 1200px;
		margin: auto;
		padding: 2rem;
		display: grid;
		gap: 1.6rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}
	h1 {
		font-size: 2.7rem;
		margin: 0.3rem 0;
	}
	.mesh-guide {
		padding: 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 1rem;
	}
	.mesh-guide h2 {
		margin-top: 0;
	}
	.guide-columns {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
	}
	h3 {
		font-size: 1rem;
	}
	p {
		line-height: 1.6;
	}
	.mesh-guide p {
		color: var(--muted);
		font-size: 0.9rem;
	}
	@media (max-width: 750px) {
		.mesh-page {
			padding: 1rem;
		}
		header {
			flex-direction: column;
		}
		h1 {
			font-size: 2rem;
		}
		.guide-columns {
			grid-template-columns: 1fr;
			gap: 0.5rem;
		}
	}
</style>
