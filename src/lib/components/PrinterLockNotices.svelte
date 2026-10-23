<script lang="ts">
	import WorkflowNotice from './WorkflowNotice.svelte';
	import WorkflowProgress from './WorkflowProgress.svelte';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { printerLockNotices, canReviewPrinterLock } from '#lib/domain/printer-locks.js';
	let {
		snapshot,
		role,
		suppressFilamentChange = false
	}: { snapshot?: PrinterSnapshot; role?: string; suppressFilamentChange?: boolean } = $props();
	const notices = $derived(
		snapshot && !snapshot.safety?.halted && !snapshot.liveRecovery
			? printerLockNotices(snapshot).filter(
					(notice) =>
						(notice.id !== 'configuration' || role !== 'owner') &&
						!(suppressFilamentChange && notice.id === 'filamentChange')
				)
			: []
	);
</script>

{#if notices.length}<section class="lock-notices" aria-label="Printer workflow status">
		{#each notices as notice (notice.id)}
			<WorkflowNotice kind={notice.kind}>
				{#snippet title()}{notice.title}{/snippet}
				{#snippet children()}
					{#if snapshot && notice.kind === 'progress'}<WorkflowProgress
							{snapshot}
							workflow={notice.id}
						/>{/if}
					{#if notice.kind === 'attention' || ['configuration', 'storage'].includes(notice.id)}<p>
							{notice.message}
						</p>{/if}
				{/snippet}
				{#snippet actions()}
					{#if canReviewPrinterLock(notice, role)}<a href={notice.href}>{notice.label} →</a>
					{:else if notice.operatorRequired}<p>
							Ask an operator or owner to review this issue.
						</p>{/if}
				{/snippet}
			</WorkflowNotice>
		{/each}
	</section>{/if}

<style>
	.lock-notices {
		padding: 1rem clamp(1rem, 3vw, 2.5rem);
		display: grid;
		gap: 0.75rem;
	}
	p {
		margin: 0.4rem 0;
	}
	a {
		color: var(--accent);
	}
</style>
