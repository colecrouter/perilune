<script lang="ts">
	import type { ManualInterventions } from '#lib/domain/jobs.js';
	let { inspection }: { inspection?: ManualInterventions | null } = $props();
</script>

<div class="interventions" aria-label="Planned manual interventions">
	<h3>Manual changes & pauses</h3>
	{#if inspection}
		{#if inspection.filamentChanges || inspection.pauses}
			<p class="summary">
				{inspection.filamentChanges} manual filament {inspection.filamentChanges === 1
					? 'change'
					: 'changes'} and {inspection.pauses} other {inspection.pauses === 1 ? 'pause' : 'pauses'} requested
				by this file.
			</p>
			<details>
				<summary>Show command locations</summary>
				<ul>
					{#each inspection.locations as location}<li>
							Line {location.line}: <code>{location.command}</code>
						</li>{/each}
				</ul>
				{#if inspection.filamentChanges + inspection.pauses > inspection.locations.length}<p>
						Showing the first {inspection.locations.length} locations.
					</p>{/if}
			</details>
		{:else}<p>No recognizable manual-change or pause commands found.</p>{/if}
	{:else}<p>
			Not inspected. File contents may be unavailable, older, or larger than the 20 MiB inspection
			limit.
		</p>{/if}
	<p class="hint">
		Printer macros determine what happens and can introduce other pauses. This inspection does not
		check whether a file is safe to print. <a href="/help#printing"
			>About manual changes and resuming</a
		>
	</p>
</div>

<style>
	.interventions {
		margin: 1rem 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--canvas);
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	p {
		line-height: 1.55;
		margin: 0.6rem 0;
	}
	.summary {
		font-weight: 600;
	}
	.hint,
	li {
		color: var(--muted);
		font-size: 0.8rem;
	}
	summary {
		cursor: pointer;
		color: var(--accent);
	}
	ul {
		padding-left: 1.25rem;
	}
	li {
		margin: 0.3rem 0;
	}
</style>
