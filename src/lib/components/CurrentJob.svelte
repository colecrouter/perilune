<script lang="ts">
	import PrintJobActions from './PrintJobActions.svelte';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { jobDescriptions } from '#lib/domain/current-job.js';
	import Icon from './Icon.svelte';
	let {
		snapshot,
		available = true,
		operator = true,
		compact = false,
		controls = true,
		onStop
	}: {
		snapshot: PrinterSnapshot;
		available?: boolean;
		operator?: boolean;
		onStop?: () => void;
		controls?: boolean;
		compact?: boolean;
	} = $props();
	const job = $derived(snapshot.job);
	const active = $derived(job.state === 'printing' || job.state === 'paused');
	const finished = $derived(['complete', 'cancelled', 'error'].includes(job.state));
	const copy = $derived(jobDescriptions[job.state]);
</script>

<section class="panel job-panel" class:compact data-job-state={job.state} aria-label="Current job">
	<div class="section-header">
		<h2>{active ? 'Current job' : finished ? 'Last job' : 'Printer'}</h2>
		<a href="/jobs">Job library →</a>
	</div>
	<div class="job-heading">
		<Icon name={job.state === 'paused' ? 'pause' : 'jobs'} size={28} />
		<div>
			<h3>{copy.title}</h3>
			{#if job.filename && job.state !== 'standby' && job.state !== 'unknown'}<p class="filename">
					{job.filename}
				</p>{/if}
		</div>
	</div>
	<p class="job-description">{copy.description}</p>
	{#if active}<div class="progress-row">
			<progress max="100" value={job.progress ?? undefined} aria-label="Print progress"
			></progress><strong>{job.progress === null ? '—' : `${Math.round(job.progress)}%`}</strong>
		</div>
		<div class="job-metrics">
			<div>
				<span>Remaining (estimate)</span><strong
					>{job.remainingMinutes === null ? '—' : `${job.remainingMinutes} min`}</strong
				>
			</div>
			<div><span>Layer</span><strong>{job.layer ?? '—'} / {job.totalLayers ?? '—'}</strong></div>
		</div>
		{#if controls}<PrintJobActions {snapshot} {available} {operator} {onStop} />{/if}
	{:else}<div class="job-actions">
			{#if finished && job.filename}<a
					class="button primary"
					href={`/jobs?q=${encodeURIComponent(job.filename)}`}>Review &amp; print again</a
				>{:else}<a class="button primary" href="/jobs">Choose a file</a
				>{/if}{#if job.state === 'error'}<a class="button secondary" href="/console"
					>Printer messages</a
				>{/if}
		</div>{/if}
</section>

<style>
	.job-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.job-panel .section-header {
		padding-bottom: 0.85rem;
		margin-bottom: 0;
	}
	.job-heading :global(svg) {
		flex-shrink: 0;
	}
	.job-heading h3 {
		overflow-wrap: anywhere;
	}

	.compact {
		margin-bottom: 1.2rem;
	}
	@media (min-width: 1000px) {
		.compact {
			display: grid;
			grid-template-columns: minmax(0, 1.5fr) minmax(200px, 1fr);
			gap: 0.5rem 2rem;
		}
		.compact .section-header {
			grid-column: 1 / -1;
		}
		.compact .job-description {
			grid-column: 1;
			margin: 0;
		}
		.compact .progress-row {
			grid-column: 2;
			grid-row: 2;
		}
		.compact .job-metrics {
			grid-column: 2;
			grid-row: 3;
			margin: 0;
		}
		.compact .job-actions {
			grid-column: 1 / -1;
		}
	}
	.job-panel {
		padding: 1.3rem;
	}
	.section-header a {
		color: var(--accent);
		font-size: 0.8rem;
	}
	.job-heading {
		display: flex;
		gap: 0.8rem;
		align-items: center;
	}
	.job-heading > div {
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: 1.25rem;
	}
	.filename {
		overflow-wrap: anywhere;
		font-size: 0.85rem;
		margin: 0.4rem 0 0;
	}
	.job-description {
		font-size: 0.85rem;
		line-height: 1.6;
		color: var(--muted);
	}
	.job-actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
</style>
