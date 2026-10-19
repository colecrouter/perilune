<script lang="ts">
	import type { ActionRecord } from '#lib/domain/printer.js';
	import { actionStatusLabel } from '#lib/client/action-label.js';
	let {
		receipt,
		receiptBase = '/actions',
		showCompleted = false
	}: { receipt: ActionRecord; receiptBase?: string; showCompleted?: boolean } = $props();
	const attention = $derived(receipt.status === 'unknown' || receipt.status === 'failed');
	const statusLabel = $derived(actionStatusLabel[receipt.status]);
</script>

{#if receipt.status !== 'completed' || showCompleted}
	<div class="action-feedback" class:attention role={attention ? 'alert' : 'status'}>
		<strong>{receipt.label}: {statusLabel}</strong>
		{#if attention}
			{#if receipt.message}<span>{receipt.message}</span
				>{:else if receipt.status === 'unknown'}<span
					>Check the printer and review this action before trying again. It will not be replayed
					automatically.</span
				>{/if}
			<a href={`${receiptBase}/${receipt.id}`}>Review action</a>
		{/if}
	</div>
{/if}

<style>
	.action-feedback {
		font-size: 0.8rem;
		line-height: 1.5;
		margin: 0.65rem 0;
		max-width: 40rem;
	}
	strong,
	span {
		display: block;
	}
	strong {
		font-weight: 550;
	}
	a {
		color: var(--accent);
	}
	.attention {
		border-left: 3px solid var(--danger, #bf4343);
		padding-left: 0.75rem;
	}
</style>
