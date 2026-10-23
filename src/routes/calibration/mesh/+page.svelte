<script lang="ts">
	import { onMount } from 'svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import SavedMeshes from '#lib/components/SavedMeshes.svelte';
	import BedMeshProbe from '#lib/components/BedMeshProbe.svelte';
	import type { PrinterCommand } from '#lib/domain/printer.js';
	import BedMeshInspector from '#lib/components/BedMeshInspector.svelte';
	import { getPrinter, submitAction } from '../../printer.remote.js';
	let { data } = $props();
	let selectedMesh = $state('active');
	let inspectingSaved = $state(false);
	let replacementTarget = $state('default');
	const dashboard = getPrinter();
	const initial = $derived(data.initial!.printer);
	const updates = liveConnection(() => dashboard.connected);
	onMount(() => {
		void Promise.resolve(dashboard).catch(() => {});
	});
	const snapshot = $derived(dashboard.current ?? initial);
	const fresh = $derived(
		updates.available &&
			snapshot.connection === 'connected' &&
			snapshot.klippy === 'ready' &&
			snapshot.telemetryReady
	);
	async function submit(command: PrinterCommand) {
		return (
			await submitAction({
				id:
					command.type === 'meshProbeBegin' || command.type === 'meshProbeProfile'
						? command.probeId
						: crypto.randomUUID(),
				command
			})
		).id;
	}
	const candidate = $derived(
		snapshot.meshProbe.session?.stage === 'review' ? snapshot.meshProbe.session.result : null
	);
</script>

<svelte:head><title>Bed mesh · Perilune</title></svelte:head>
<AppShell {snapshot} active="Calibration"
	><div class="mesh-page page-frame serif">
		<header>
			<div>
				<h1>Bed mesh</h1>
				<p class="muted">
					Explore the reported height grid, inspect profiles, and understand the variation.
				</p>
			</div>
		</header>
		<BedMeshProbe
			bind:target={replacementTarget}
			{snapshot}
			connected={updates.available}
			userId={data.user?.id ?? ''}
			role={data.user?.role ?? 'viewer'}
			onSubmit={submit}
		/>
		{#if candidate}
			{#key snapshot.meshProbe.session!.id}<section
					class="candidate-inspection"
					aria-label="Candidate mesh review"
				>
					<h2>
						{snapshot.mode === 'moonraker'
							? 'Measured result · currently active'
							: 'Candidate result · not active'}
					</h2>
					<BedMeshInspector
						activeLabel="Candidate"
						showProfiles={false}
						meshState={{ status: 'ready', active: candidate, profiles: [], omittedProfiles: 0 }}
						{fresh}
						simulator={snapshot.mode === 'simulator'}
					/>
				</section>{/key}
		{/if}
		<SavedMeshes
			onReplace={(name) => {
				replacementTarget = name;
				document
					.getElementById('mesh-calibration')
					?.scrollIntoView({ block: 'start', behavior: 'smooth' });
			}}
			{snapshot}
			connected={updates.available}
			role={data.user?.role ?? 'viewer'}
			onSubmit={submit}
			onInspect={(name) => {
				selectedMesh = `profile:${name}`;
				inspectingSaved = true;
				document
					.getElementById('saved-mesh-inspection')
					?.scrollIntoView({ block: 'start', behavior: 'smooth' });
			}}
		/>
		<div id="saved-mesh-inspection" hidden={Boolean(candidate) && !inspectingSaved}>
			<BedMeshInspector
				bind:selected={selectedMesh}
				meshState={snapshot.bedMesh}
				{fresh}
				simulator={snapshot.mode === 'simulator'}
			/>
		</div>
		<details class="mesh-guide">
			<summary>Understanding this mesh</summary>
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
				Inspecting a mesh does not activate it. Use the Saved meshes actions to change active
				compensation. The usual-mesh calibration replaces its saved result only after acceptance.
				Live save and discard restart Klipper; review any pending settings first.
			</p>
			<a href="https://www.klipper3d.org/Bed_Mesh.html" target="_blank" rel="noreferrer"
				>Understanding bed mesh in Klipper ↗</a
			>
		</details>
	</div></AppShell
>

<style>
	.mesh-guide summary {
		cursor: pointer;
		font-weight: 600;
	}
	.mesh-page {
		--page-content-max: 75rem;
		display: grid;
		gap: 1.6rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}
	.mesh-guide {
		padding: 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 1rem;
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
		.mesh-guide summary {
			cursor: pointer;
			font-weight: 600;
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
