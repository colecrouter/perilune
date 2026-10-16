<script lang="ts">
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { jobControlReason, jobDescriptions } from '#lib/domain/current-job.js';
	import ActionForm from './ActionForm.svelte';
	import Icon from './Icon.svelte';
	let {
		snapshot,
		available = true,
		operator = true,
		onStop
	}: {
		snapshot: PrinterSnapshot;
		available?: boolean;
		operator?: boolean;
		onStop: () => void;
	} = $props();
	const job = $derived(snapshot.job);
	const active = $derived(job.state === 'printing' || job.state === 'paused');
	const finished = $derived(['complete', 'cancelled', 'error'].includes(job.state));
	const reason = $derived(jobControlReason(snapshot, available, operator));
	const identity = $derived({ filename: job.filename, runId: job.runId ?? '' });
	const copy = $derived(jobDescriptions[job.state]);
</script>

<section class="panel job-panel" aria-label="Current job">
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
		{#if reason}<p class="control-reason" role="status">{reason}</p>{/if}
		<div class="job-actions">
			<ActionForm fields={{ intent: job.state === 'paused' ? 'resume' : 'pause', ...identity }}
				>{#snippet children({ pending, uncertain })}<button
						class="button primary"
						disabled={!!reason || pending || uncertain}
						><Icon name={job.state === 'paused' ? 'play' : 'pause'} size={18} />{pending
							? 'Submitting…'
							: job.state === 'paused'
								? 'Resume print'
								: 'Pause print'}</button
					>{/snippet}</ActionForm
			>
			<a
				role="button"
				class="button danger-outline"
				href={`/actions?intent=cancel&filename=${encodeURIComponent(identity.filename)}&runId=${encodeURIComponent(identity.runId)}`}
				aria-disabled={!!reason}
				onclick={(event) => {
					event.preventDefault();
					if (!reason) onStop();
				}}><Icon name="stop" size={16} />Stop print</a
			>
			{#if job.state === 'paused'}<a class="button secondary" href="/console">Printer messages</a
				>{/if}
		</div>
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
	.job-description,
	.control-reason {
		font-size: 0.85rem;
		line-height: 1.6;
		color: var(--muted);
	}
	.control-reason {
		border-left: 3px solid var(--accent);
		padding-left: 0.75rem;
	}
	.job-actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
</style>
