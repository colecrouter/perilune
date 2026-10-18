<script lang="ts">
	import { page } from '$app/state';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import SafetyButton from './SafetyButton.svelte';
	let { snapshot }: { snapshot?: PrinterSnapshot } = $props();
	const owner = $derived(page.data.user?.role === 'owner');
	const operator = $derived(owner || page.data.user?.role === 'operator');
	const safety = $derived(snapshot?.safety);
	const active = $derived(
		safety?.actions.filter(
			(action) =>
				['queued', 'sending'].includes(action.status) ||
				(action.status === 'unknown' && !action.reviewedAt)
		) ?? []
	);
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
				{#if snapshot.zProbe?.active}<SafetyButton
						{snapshot}
						intent="abortProbe"
						label="Abort manual probe"
					/>{/if}
				<SafetyButton {snapshot} intent="cooldown" label="Turn off heaters" />
			{/if}
			{#if owner && !safety.halted && safety.actions.some((a) => a.status === 'unknown' && !a.reviewedAt)}<SafetyButton
					{snapshot}
					intent="review"
					label="Review safety"
				/>{/if}
		</div>
		{#if safety.halted}<p role="alert">
				Emergency interlock active. Ordinary controls remain locked.
				<a href="/activity#emergency">Review hazard and recover →</a>
			</p>{:else if snapshot.liveRecovery}<p role="status">
				Controls locked after an uncertain action.
				<a href="/activity#recovery">Check the printer and review recovery →</a>
			</p>{:else if active.some((a) => a.status === 'unknown')}<p role="status">
				A safety outcome needs review. <a href="/activity#safety">Review safety outcome →</a>
			</p>{:else if active.length}<p role="status">
				Safety action in progress. <a href="/activity#safety">View progress →</a>
			</p>{/if}
	</aside>
{/if}

<style>
	aside {
		padding: 0.6rem clamp(1rem, 3vw, 2.5rem);
		border-bottom: 1px solid var(--border);
	}
	.buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
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
