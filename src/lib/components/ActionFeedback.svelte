<script lang="ts">
	import type { ActionRecord } from '#lib/domain/printer.js';
	let {
		receipt,
		receiptBase = '/actions',
		successDuration = 6000
	}: {
		receipt: ActionRecord;
		receiptBase?: string;
		successDuration?: number;
	} = $props();
	let dismissed = $state(false);
	const duration = $derived(successDuration);
	const lifecycle = $derived(`${receipt.id}:${receipt.status}`);
	$effect(() => {
		const key = lifecycle;
		dismissed = false;
		if (!key.endsWith(':completed')) return;
		const timer = setTimeout(() => {
			dismissed = true;
		}, duration);
		return () => clearTimeout(timer);
	});
	const statusLabel = $derived(
		receipt.status === 'queued'
			? 'Waiting to run'
			: receipt.status === 'sending'
				? 'In progress'
				: receipt.status === 'unknown'
					? 'Outcome uncertain'
					: receipt.status === 'failed'
						? 'Failed'
						: 'Completed'
	);
</script>

{#if !dismissed}<div
		class="action-feedback"
		class:attention={receipt.status === 'unknown' || receipt.status === 'failed'}
		role={receipt.status === 'failed' || receipt.status === 'unknown' ? 'alert' : 'status'}
	>
		<strong>{receipt.label}: {statusLabel}</strong>
		{#if receipt.message}<span>{receipt.message}</span>{:else if receipt.status === 'unknown'}<span
				>Check the printer and review this action before trying again. It will not be replayed
				automatically.</span
			>{/if}
		<a href={`${receiptBase}/${receipt.id}`}>Check receipt</a>
	</div>{/if}

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
