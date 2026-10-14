<script lang="ts">
	import BedMeshSurface from './BedMeshSurface.svelte';
	import { meshStats, meshPoint, meshDifference, type BedMeshState } from '#lib/domain/bed-mesh.js';
	let {
		meshState,
		fresh = true,
		simulator = false
	}: { meshState: BedMeshState; fresh?: boolean; simulator?: boolean } = $props();
	let selected = $state('active');
	let view = $state<'top' | 'surface'>('top');
	let comparison = $state('none');
	let row = $state(0);
	let column = $state(0);
	const options = $derived([
		...(meshState.active
			? [
					{
						id: 'active',
						label: `Active · ${meshState.active.name || 'unnamed'}`,
						mesh: meshState.active
					}
				]
			: []),
		...meshState.profiles.map((profile) => ({
			id: `profile:${profile.name}`,
			label: profile.name,
			mesh: profile
		}))
	]);
	const choice = $derived(options.find((option) => option.id === selected) ?? options[0]);
	const reference = $derived(options.find((option) => option.id === comparison));
	const difference = $derived(
		choice && reference ? meshDifference(choice.mesh, reference.mesh) : null
	);
	const displayed = $derived(difference ?? choice?.mesh);
	const stats = $derived(displayed ? meshStats(displayed) : null);
	const selectedMissing = $derived(
		selected !== 'active' && !options.some((option) => option.id === selected)
	);
	const selectedRow = $derived(displayed ? Math.min(row, displayed.points.length - 1) : 0);
	const selectedColumn = $derived(displayed ? Math.min(column, displayed.points[0].length - 1) : 0);
	const point = $derived(displayed ? meshPoint(displayed, selectedRow, selectedColumn) : null);
	const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(3)}`;
	const scale = $derived(
		stats ? Math.max(Math.abs(stats.minimum), Math.abs(stats.maximum), 0.001) : 1
	);
	const color = (value: number) => {
		const weight = Math.min(1, Math.abs(value) / scale) * 0.7;
		const accent = value < 0 ? [52, 114, 121] : [137, 117, 172];
		return `rgb(${accent.map((v, i) => Math.round([239, 235, 225][i] * (1 - weight) + v * weight)).join(',')})`;
	};
	function navigate(event: KeyboardEvent) {
		if (!displayed) return;
		const changes: Record<string, [number, number]> = {
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
			ArrowUp: [1, 0],
			ArrowDown: [-1, 0]
		};
		const change = changes[event.key];
		if (!change) return;
		event.preventDefault();
		row = Math.max(0, Math.min(displayed.points.length - 1, selectedRow + change[0]));
		column = Math.max(0, Math.min(displayed.points[0].length - 1, selectedColumn + change[1]));
		const map = (event.currentTarget as HTMLElement).closest('.height-map')!;
		const index = (displayed.points.length - 1 - row) * displayed.points[0].length + column;
		(map.querySelectorAll('button')[index] as HTMLButtonElement)?.focus();
	}
</script>

<section class="mesh-inspector" aria-label="Bed mesh inspection">
	{#if !fresh}<p class="notice" role="status">
			Waiting for current printer telemetry. Retained mesh data is stale; your view is preserved.
		</p>{/if}
	{#if simulator}<p class="fixture-note">
			Illustrative simulator meshes · not measurements from your printer
		</p>{/if}
	{#if selectedMissing}<p class="notice">
			The selected profile is no longer available. Showing {choice?.label ?? 'no mesh'} until you choose
			another profile.
		</p>{/if}
	<div class="view-controls">
		<label
			>Inspect mesh<select bind:value={selected} disabled={!options.length}
				>{#if !options.some((option) => option.id === selected)}<option value={selected}
						>Unavailable selection</option
					>{/if}{#each options as option}<option value={option.id}>{option.label}</option
					>{/each}</select
			></label
		>
		<label
			>Compare with<select bind:value={comparison} disabled={!options.length}
				><option value="none">No comparison</option>{#each options as option}<option
						value={option.id}>{option.label}</option
					>{/each}</select
			></label
		>
	</div>
	{#if meshState.omittedProfiles}<p class="notice">
			{meshState.omittedProfiles} profile(s) could not be displayed because their data is invalid or exceeds
			inspection limits.
		</p>{/if}
	{#if comparison !== 'none' && !reference}<p class="notice">
			The comparison profile is no longer available. Showing the selected mesh.
		</p>{:else if choice && reference && !difference}<p class="notice">
			These grids have different coordinates or sample counts. Showing the selected mesh;
			point-by-point comparison would be misleading.
		</p>{/if}
	{#if displayed && stats && point}
		{#if meshState.status === 'invalid'}<p class="notice">
				The active mesh data is incomplete or unsupported. Valid saved profiles are still available
				for inspection.
			</p>{/if}
		{#if !meshState.active}<p class="notice">
				No active mesh is reported. Inspecting a saved profile does not load it into the printer.
			</p>{/if}
		<div class="mesh-summary">
			<div>
				<span>{difference ? 'Difference range' : 'Height range'}</span><strong
					>{stats.range.toFixed(3)} <small>mm</small></strong
				>
			</div>
			<div>
				<span>Lowest {difference ? 'difference' : 'value'}</span><strong
					>{signed(stats.minimum)} <small>mm</small></strong
				>
			</div>
			<div>
				<span>Highest {difference ? 'difference' : 'value'}</span><strong
					>{signed(stats.maximum)} <small>mm</small></strong
				>
			</div>
			<div>
				<span>Reported grid</span><strong
					>{displayed.points[0].length} × {displayed.points.length}</strong
				>
			</div>
		</div>
		<div class="view-switch" role="group" aria-label="Mesh visualization">
			<button class="button secondary" aria-pressed={view === 'top'} onclick={() => (view = 'top')}
				>Top-down</button
			><button
				class="button secondary"
				aria-pressed={view === 'surface'}
				onclick={() => (view = 'surface')}>Isometric</button
			>
		</div>
		<div class="mesh-layout">
			<div class="map-area">
				{#if view === 'surface'}<BedMeshSurface mesh={displayed} {scale} {color} />{:else}
					<div class="axis-caption">Y {displayed.max[1]} mm · maximum</div>
					<div
						class="height-map"
						role="group"
						aria-label="Height map; arrow keys select adjacent samples"
						style={`--columns:${displayed.points[0].length}; aspect-ratio:${(displayed.max[0] - displayed.min[0]) / (displayed.max[1] - displayed.min[1])}; width:min(100%, ${((displayed.max[0] - displayed.min[0]) / (displayed.max[1] - displayed.min[1])) * 600}px)`}
					>
						{#each [...displayed.points].reverse() as values, reversedRow}
							{@const y = displayed.points.length - 1 - reversedRow}
							{#each values as value, x}
								{@const coordinate = meshPoint(displayed, y, x)}
								<button
									tabindex={y === selectedRow && x === selectedColumn ? 0 : -1}
									onkeydown={navigate}
									class:selected={y === selectedRow && x === selectedColumn}
									style={`background:${color(value)}`}
									aria-label={`X ${coordinate.x.toFixed(1)}, Y ${coordinate.y.toFixed(1)}: ${signed(value)} mm`}
									onclick={() => {
										row = y;
										column = x;
									}}
									title={`${signed(value)} mm`}
									><span
										>{displayed.points[0].length <= 7 && displayed.points.length <= 7
											? signed(value)
											: ''}</span
									></button
								>
							{/each}
						{/each}
					</div>
					<div class="axis-caption">Y {displayed.min[1]} mm · minimum</div>
					<div class="x-axis">
						<span>X {displayed.min[0]} mm</span><span>X {displayed.max[0]} mm →</span>
					</div>
				{/if}
				<div class="scale">
					<span>{signed(-scale)} mm</span>
					<div aria-hidden="true"></div>
					<span>{signed(scale)} mm</span>
				</div>
				<p class="fine-hint">
					Teal: below reference · neutral: zero · lavender: above reference. Scale is symmetric
					about zero.
				</p>
			</div>
			<aside class="sample-detail">
				<p class="eyebrow">Selected sample</p>
				<h2>{signed(point.z)} <small>mm</small></h2>
				<p>X {point.x.toFixed(1)} · Y {point.y.toFixed(1)} mm</p>
				<div class="sample-fields">
					<label
						>Row (Y)<input
							type="number"
							min="1"
							max={displayed.points.length}
							value={selectedRow + 1}
							oninput={(event) => {
								const v = event.currentTarget.valueAsNumber;
								if (Number.isInteger(v))
									row = Math.max(0, Math.min(displayed.points.length - 1, v - 1));
							}}
						/></label
					><label
						>Column (X)<input
							type="number"
							min="1"
							max={displayed.points[0].length}
							value={selectedColumn + 1}
							oninput={(event) => {
								const v = event.currentTarget.valueAsNumber;
								if (Number.isInteger(v))
									column = Math.max(0, Math.min(displayed.points[0].length - 1, v - 1));
							}}
						/></label
					>
				</div>
				<p class="muted">
					Tap a cell, use the map’s arrow keys, or select a row and column. Row 1 starts at minimum
					Y; column 1 starts at minimum X.
				</p>
				{#if difference && reference && choice}<p class="comparison-note">
						Difference = {choice.label} − {reference.label}. A positive value means the selected
						mesh is higher at this coordinate.
					</p>{:else}<p class="muted">
						Values are relative to the mesh’s reference. Zero is not necessarily the bed’s lowest
						point.
					</p>{/if}
			</aside>
		</div>
		<details class="values-table">
			<summary>All sample values</summary>
			<div class="table-scroll">
				<table>
					<caption
						>{difference ? 'Mesh differences' : 'Reported mesh samples'} in millimetres · rows shown from
						maximum Y</caption
					><thead
						><tr
							><th scope="col">Y / X</th>{#each displayed.points[0] as _, x}<th scope="col"
									>{meshPoint(displayed, 0, x).x.toFixed(1)}</th
								>{/each}</tr
						></thead
					><tbody
						>{#each [...displayed.points].reverse() as values, r}<tr
								><th scope="row"
									>{meshPoint(displayed, displayed.points.length - 1 - r, 0).y.toFixed(1)}</th
								>{#each values as value}<td>{signed(value)}</td>{/each}</tr
							>{/each}</tbody
					>
				</table>
			</div>
		</details>
	{:else}
		<div class="empty-mesh">
			<h2>
				{meshState.status === 'unavailable'
					? 'Bed mesh is not available'
					: meshState.status === 'invalid'
						? 'Mesh data could not be read'
						: 'No active mesh'}
			</h2>
			<p class="muted">
				{meshState.status === 'unavailable'
					? 'Waiting for telemetry, or this printer does not expose a bed_mesh object.'
					: meshState.status === 'invalid'
						? 'The reported grid or coordinates are incomplete, invalid, or exceed supported limits.'
						: 'The printer reports no loaded mesh and no inspectable saved profiles.'}
			</p>
			<p>When a mesh is available, its shape and sample values will appear here.</p>
		</div>
	{/if}
</section>

<style>
	.view-switch {
		display: flex;
		gap: 0.5rem;
	}
	.view-switch button[aria-pressed='true'] {
		background: var(--highlight);
		color: var(--highlight-text);
		border-color: var(--highlight);
	}
	.mesh-inspector {
		display: grid;
		gap: 1.25rem;
	}
	.view-controls {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	label {
		display: grid;
		gap: 0.45rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
	select,
	input {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		padding: 0.65rem;
		min-width: 0;
		max-width: 100%;
	}
	.view-controls label {
		flex: 1;
		min-width: 180px;
	}
	.mesh-summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		padding: 1.2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 1rem;
	}
	.mesh-summary span {
		display: block;
		font-size: 0.8rem;
		color: var(--muted);
		margin-bottom: 0.4rem;
	}
	strong {
		font-size: 1.4rem;
	}
	small {
		font-size: 0.8rem;
		font-weight: 400;
	}
	.mesh-layout {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(240px, 1fr);
		gap: 2rem;
		align-items: start;
	}
	.map-area {
		min-width: 0;
	}
	.height-map {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
		gap: 2px;
		border: 1px solid var(--border);
		padding: 4px;
		background: var(--surface);
		border-radius: 0.6rem;
		max-height: 600px;
	}
	.height-map:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 3px;
	}
	.height-map button {
		border: 0;
		padding: 0;
		min-width: 0;
		position: relative;
		cursor: pointer;
		color: #20262b;
		font-variant-numeric: tabular-nums;
		font-size: clamp(0.55rem, 1.2vw, 0.85rem);
	}
	.height-map button.selected {
		outline: 3px solid #20262b;
		outline-offset: -3px;
		z-index: 1;
	}
	.axis-caption {
		text-align: center;
		color: var(--muted);
		font-size: 0.75rem;
		padding: 0.4rem;
	}
	.x-axis,
	.scale {
		display: flex;
		justify-content: space-between;
		gap: 0.65rem;
		font-size: 0.75rem;
		align-items: center;
	}
	.scale {
		margin-top: 1rem;
	}
	.scale div {
		flex: 1;
		height: 0.7rem;
		border-radius: 1rem;
		background: linear-gradient(90deg, #6c9695, #efebe1, #ad99bc);
	}
	.sample-detail {
		padding: 1.3rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
	}
	.sample-detail h2 {
		font-size: 2rem;
		margin: 0.4rem 0;
	}
	.sample-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
		margin: 1rem 0;
	}
	.sample-detail p {
		font-size: 0.85rem;
		line-height: 1.6;
	}
	.fixture-note,
	.comparison-note {
		color: var(--accent);
	}
	.fixture-note {
		margin: 0;
		font-size: 0.85rem;
	}
	.empty-mesh {
		padding: 2rem;
		border: 1px dashed var(--border);
		border-radius: 1rem;
	}
	.values-table summary {
		cursor: pointer;
		padding: 0.75rem 0;
		font-weight: 600;
	}
	.table-scroll {
		overflow: auto;
		max-height: 400px;
	}
	table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	th,
	td {
		padding: 0.55rem;
		border-bottom: 1px solid var(--border);
		text-align: right;
		white-space: nowrap;
	}
	caption {
		text-align: left;
		padding: 0.6rem;
		color: var(--muted);
	}
	@media (max-width: 750px) {
		.mesh-layout {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
		.mesh-summary {
			grid-template-columns: 1fr 1fr;
		}
		.height-map button {
			font-size: 0.65rem;
		}
		.view-controls label {
			min-width: 0;
			width: 100%;
			flex-basis: 100%;
		}
	}
</style>
