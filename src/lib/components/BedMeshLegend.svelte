<script lang="ts">
	import { meshHeightColor } from '#lib/domain/mesh-visualization.js';
	let {
		scale,
		selected,
		difference = false
	}: { scale: number; selected: number; difference?: boolean } = $props();
	const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(3)}`;
	const position = $derived(50 + Math.max(-1, Math.min(1, selected / scale)) * 50);
</script>

<div class="mesh-legend" aria-label={difference ? 'Mesh difference legend' : 'Mesh height legend'}>
	<div class="legend-heading">
		<span>{difference ? 'Difference (mm)' : 'Height (mm)'}</span><span
			>Selected <strong>{signed(selected)}</strong></span
		>
	</div>
	<div
		class="legend-track"
		style:background={`linear-gradient(90deg, ${meshHeightColor(-scale, scale)}, ${meshHeightColor(0, scale)}, ${meshHeightColor(scale, scale)})`}
	>
		<span class="zero-marker" aria-hidden="true"></span><span
			class="selected-marker"
			style:left={`${position}%`}
			aria-hidden="true"
		></span>
	</div>
	<div class="legend-labels">
		<span>{signed(-scale)}</span><strong>{difference ? '0 · no change' : '0 · reference'}</strong
		><span>{signed(scale)}</span>
	</div>
</div>

<style>
	.mesh-legend {
		margin-top: 1rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.legend-heading {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		margin-bottom: 0.6rem;
		color: var(--muted);
	}
	.legend-heading strong {
		color: var(--text);
	}
	.legend-track {
		position: relative;
		height: 0.8rem;
		border: 1px solid var(--border-strong);
		border-radius: 3px;
		margin-inline: 4px;
	}
	.zero-marker {
		position: absolute;
		left: 50%;
		top: -4px;
		bottom: -4px;
		border-left: 2px solid var(--text);
		transform: translateX(-1px);
	}
	.selected-marker {
		position: absolute;
		top: -6px;
		width: 8px;
		height: 8px;
		background: var(--surface);
		border: 2px solid var(--text);
		border-radius: 50%;
		transform: translateX(-50%);
	}
	.legend-labels {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 0.35rem;
		margin-top: 0.5rem;
		color: var(--muted);
	}
	.legend-labels strong {
		color: var(--text);
		font-weight: 550;
	}
	.legend-labels span:last-child {
		text-align: right;
	}
</style>
