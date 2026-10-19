<script lang="ts">
	import { actionStatusLabel } from '#lib/client/action-label.js';
	import { onMount } from 'svelte';
	import { Tabs } from 'bits-ui';
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
	let filter = $state('all');
	const attentionActions = $derived(
		snapshot.actions.filter((action) => action.status !== 'completed')
	);
	const attentionCount = $derived(
		snapshot.actions.filter((action) => action.status !== 'completed').length
	);
</script>

<svelte:head><title>Printer activity · Perilune</title></svelte:head>
<AppShell {snapshot} active="Activity"
	><div class="safety-history page-frame serif">
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
		<section class="panel" aria-labelledby="printer-actions-heading">
			<h2 id="printer-actions-heading">Printer actions</h2>
			<Tabs.Root bind:value={filter} activationMode="automatic" loop>
				<Tabs.List class="activity-tabs" aria-label="Filter printer actions">
					<Tabs.Trigger class="activity-tab" value="all">All actions</Tabs.Trigger>
					<Tabs.Trigger class="activity-tab" value="attention"
						>Needs attention ({attentionCount})</Tabs.Trigger
					>
				</Tabs.List>
				<Tabs.Content value="all"
					>{@render actionList(snapshot.actions, 'No recent printer actions.')}</Tabs.Content
				>
				<Tabs.Content value="attention"
					>{@render actionList(
						attentionActions,
						'No printer actions need attention.'
					)}</Tabs.Content
				>
			</Tabs.Root>
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

{#snippet actionList(items: typeof snapshot.actions, emptyMessage: string)}
	{#each items as action (action.id)}<article>
			<div>
				<a href={`/actions/${action.id}`}>{action.label}</a><small
					>{new Date(action.createdAt).toLocaleString()}</small
				>{#if action.message}<p>{action.message}</p>{/if}
			</div>
			<span class="action-status" data-status={action.status}
				>{actionStatusLabel[action.status]}</span
			>
		</article>{:else}<p class="empty-actions">{emptyMessage}</p>{/each}
{/snippet}

<style>
	:global(.activity-tabs) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		border-bottom: 1px solid var(--border-strong);
		margin-top: 1rem;
	}
	:global(.activity-tab) {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		min-width: 0;
		min-height: 48px;
		padding: 0.65rem 0.6rem;
		border: 0;
		border-bottom: 3px solid transparent;
		border-radius: 6px 6px 0 0;
		background: transparent;
		color: var(--muted);
		font-size: 0.875rem;
	}
	:global(.activity-tab:hover) {
		background: var(--surface);
		color: var(--text);
	}
	:global(.activity-tab[data-state='active']) {
		background: var(--highlight);
		color: var(--highlight-text);
		border-bottom-color: var(--accent);
		font-weight: 600;
	}
	.empty-actions {
		padding: 1rem 0;
		color: var(--muted);
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
		--page-content-max: 65rem;
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
