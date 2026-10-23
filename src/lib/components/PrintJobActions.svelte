<script lang="ts">
	import { filamentChangeActive } from '#lib/domain/filament-change.js';
	import { jobControlReason } from '#lib/domain/current-job.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import ActionForm from './ActionForm.svelte';
	import Icon from './Icon.svelte';
	let {
		snapshot,
		available = true,
		operator = true,
		onStop,
		userId
	}: {
		snapshot: PrinterSnapshot;
		available?: boolean;
		operator?: boolean;
		onStop?: () => void;
		userId?: string;
	} = $props();
	const job = $derived(snapshot.job);
	const reason = $derived(jobControlReason(snapshot, available, operator));
	const identity = $derived({ filename: job.filename, runId: job.runId ?? '' });
</script>

<div class="job-actions">
	{#if filamentChangeActive(snapshot.filamentChange)}<a class="button primary" href="/filament"
			>Continue filament change</a
		>{:else}{#key job.runId}<ActionForm
				receipts={snapshot.actions}
				printAccount={userId}
				fields={{ intent: job.state === 'paused' ? 'resume' : 'pause', ...identity }}
				>{#snippet children({ pending, uncertain, executing, outcome })}<button
						class="button primary"
						disabled={!!reason || pending || uncertain}
						><Icon name={job.state === 'paused' ? 'play' : 'pause'} size={18} />{pending
							? executing
								? 'Waiting for printer…'
								: 'Submitting…'
							: job.state === 'paused'
								? 'Resume print'
								: 'Pause print'}</button
					>{#if job.state === 'paused' && outcome?.status === 'completed' && outcome.label === 'Resume print' && outcome.message}<p
							role="status"
						>
							{outcome.message}
						</p>{/if}{/snippet}</ActionForm
			>{/key}{/if}
	{#if !filamentChangeActive(snapshot.filamentChange) && operator && snapshot.mode === 'moonraker'}<a
			class="button secondary"
			href="/filament">Change filament…</a
		>{/if}
	<a
		role="button"
		class="button danger-outline"
		href={`/actions?intent=cancel&filename=${encodeURIComponent(identity.filename)}&runId=${encodeURIComponent(identity.runId)}`}
		aria-disabled={!!reason}
		onclick={(event) => {
			if (reason || onStop) event.preventDefault();
			if (!reason) onStop?.();
		}}><Icon name="stop" size={16} />Stop print</a
	>
	{#if job.state === 'paused'}<a class="button secondary" href="/console">Printer messages</a>{/if}
</div>

<style>
	.job-actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.job-actions :global(.button) {
		min-height: 2.75rem;
	}
	@media (max-width: 600px) {
		.job-actions {
			align-items: stretch;
		}
		.job-actions :global(form),
		.job-actions > a {
			flex: 1 1 auto;
		}
		.job-actions :global(form .button) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
