<script lang="ts">
	import { page } from '$app/state';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import SafetyButton from './SafetyButton.svelte';
	let { snapshot }: { snapshot?: PrinterSnapshot } = $props();
	const owner = $derived(page.data.user?.role === 'owner');
	const operator = $derived(owner || page.data.user?.role === 'operator');
	const safety = $derived(snapshot?.safety);
</script>

{#if snapshot && safety?.enabled && operator}
	<aside aria-label="Printer safety" class:locked={safety.halted}>
		<div class="buttons">
			<SafetyButton {snapshot} />
			{#if owner && snapshot.liveRecovery && !safety.halted}
				<SafetyButton
					{snapshot}
					intent="stop"
					label="Stop current job"
					disabled={!['printing', 'paused'].includes(snapshot.job.state)}
				/>
				<SafetyButton {snapshot} intent="cooldown" label="Turn off heaters" />
			{/if}
			{#if owner && (safety.halted || safety.actions.some((a) => a.status === 'unknown' && !a.reviewedAt))}<SafetyButton
					{snapshot}
					intent="review"
					label="Review safety"
				/>{/if}
		</div>
		{#if safety.halted}<p role="alert">
				Emergency interlock active. Resolve the hazard, restart Klipper, then review safety.
				Ordinary controls remain locked.
			</p>{/if}
		{#each safety.actions.slice(0, 3) as action (action.id)}<p role="status">
				<a href={`/safety/${action.id}`}>{action.label}: {action.status}</a>{action.acknowledged &&
				!action.observed
					? ' · acknowledged; result not yet verified'
					: ''}{action.reviewedAt ? ' · reviewed' : ''}
			</p>{/each}
	</aside>
{/if}

<style>
	aside {
		margin: 1rem;
		padding: 0.8rem 1rem;
		border: 1px solid var(--border);
		border-radius: 0.8rem;
	}
	.buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	p {
		font-size: 0.85rem;
		margin: 0.5rem 0;
		line-height: 1.5;
	}
	.locked {
		border-color: var(--danger, #bf4343);
	}
	a {
		color: inherit;
	}
</style>
