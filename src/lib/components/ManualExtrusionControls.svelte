<script lang="ts">
	let {
		disabled = false,
		onMove
	}: { disabled?: boolean; onMove: (distance: -25 | -10 | -5 | 5 | 10 | 25) => void } = $props();
</script>

<div class="manual-extrusion">
	<p>Feed or retract · 1 mm/s</p>
	<div class="button-row">
		{#each [-25, -10, -5, 5, 10, 25] as const as distance}<button
				class="button secondary"
				{disabled}
				onclick={() => onMove(distance)}
				>{distance < 0 ? 'Retract' : 'Feed'} {Math.abs(distance)} mm</button
			>{/each}
	</div>
</div>

<style>
	.manual-extrusion p {
		margin-block: 0.75rem;
		color: var(--muted);
	}
	.button-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
