<script lang="ts">
	import { actionStatusLabel } from '#lib/client/action-label.js';
	import { onMount } from 'svelte';
	import EmergencyRecovery from '#lib/components/EmergencyRecovery.svelte';
	import LiveActionRecovery from '#lib/components/LiveActionRecovery.svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import { getPrinter } from '../printer.remote.js';
	let { data } = $props();
	const printer = getPrinter();
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
	});
	const snapshot = $derived(printer.current ?? data.snapshot);
	let filter = $state<'all' | 'attention'>('all');
	const actions = $derived(
		snapshot.actions.filter((action) => filter === 'all' || action.status !== 'completed')
	);
	const attentionCount = $derived(
		snapshot.actions.filter((action) => action.status !== 'completed').length
	);
</script>

<svelte:head><title>Printer activity · Perilune</title></svelte:head>
<AppShell {snapshot} active="Activity"
	><div class="safety-history serif">
		<h1>Printer activity</h1>
		<p class="muted">Review recent commands and anything that needs attention.</p>
		{#if snapshot.safety?.halted}<section id="emergency" class="panel">
				<h2>Emergency recovery</h2>
				<p>
					Inspect and resolve the hazard before restarting firmware. Controls remain locked until
					readiness is verified.
				</p>
				{#if data.user?.role === 'owner'}<EmergencyRecovery {snapshot} />{:else}<p>
						An owner must review the hazard and recover the printer.
					</p>{/if}
			</section>{/if}
		{#if snapshot.liveRecovery}<section id="recovery">
				<LiveActionRecovery {snapshot} />
			</section>{/if}
		<section class="panel">
			<div class="activity-heading">
				<h2>Printer actions</h2>
				<div class="activity-filters" aria-label="Filter printer actions">
					<button
						class="button secondary"
						aria-pressed={filter === 'all'}
						onclick={() => (filter = 'all')}>All actions</button
					>
					<button
						class="button secondary"
						aria-pressed={filter === 'attention'}
						onclick={() => (filter = 'attention')}>Needs attention ({attentionCount})</button
					>
				</div>
			</div>
			{#each actions as action (action.id)}<article>
					<div>
						<a href={`/actions/${action.id}`}>{action.label}</a><small
							>{new Date(action.createdAt).toLocaleString()}</small
						>
						{#if action.message}<p>{action.message}</p>{/if}
					</div>
					<span class="action-status" data-status={action.status}
						>{actionStatusLabel[action.status]}</span
					>
				</article>{:else}<p>
					{filter === 'attention'
						? 'No printer actions need attention.'
						: 'No recent printer actions.'}
				</p>{/each}
		</section>
		<section id="safety" class="panel">
			<h2>Emergency and recovery actions</h2>
			{#each snapshot.safety?.actions ?? [] as action (action.id)}<article>
					<div>
						<a href={`/safety/${action.id}`}>{action.label}</a><small
							>{new Date(action.createdAt).toLocaleString()}</small
						>{#if action.message}<p>{action.message}</p>{/if}
					</div>
					<span class="action-status" data-status={action.status}
						>{actionStatusLabel[action.status]}{action.reviewedAt ? ' · reviewed' : ''}</span
					>
				</article>{:else}<p>No recent safety actions.</p>{/each}
		</section>
		<a href="/">← Return to overview</a>
	</div></AppShell
>

<style>
	.activity-heading,
	.activity-filters {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.activity-heading {
		justify-content: space-between;
	}
	.activity-filters [aria-pressed='true'] {
		background: var(--highlight);
		color: var(--highlight-text);
		border-color: var(--highlight-text);
	}
	.action-status {
		align-self: start;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.action-status[data-status='unknown'],
	.action-status[data-status='failed'] {
		color: var(--danger);
		border-color: var(--danger-border);
	}

	.safety-history {
		max-width: 65rem;
		margin: auto;
		padding: clamp(1rem, 3vw, 2.5rem);
	}
	.panel {
		padding: 1rem;
		margin: 1.5rem 0;
	}
	article {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
	}
	article:last-child {
		border: 0;
	}
	article > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	article > span {
		font-size: 0.8rem;
		flex-shrink: 0;
	}
	small {
		display: block;
		color: var(--muted);
		margin-top: 0.4rem;
	}
	p {
		line-height: 1.6;
	}
	a {
		color: var(--accent);
	}
	@media (max-width: 600px) {
		article {
			flex-direction: column;
			gap: 0.5rem;
		}
	}
</style>
