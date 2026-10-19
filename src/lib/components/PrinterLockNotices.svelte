<script lang="ts">
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { printerLockNotices, canReviewPrinterLock } from '#lib/domain/printer-locks.js';
	let { snapshot, role }: { snapshot?: PrinterSnapshot; role?: string } = $props();
	const notices = $derived(
		snapshot && !snapshot.safety?.halted && !snapshot.liveRecovery
			? printerLockNotices(snapshot).filter(
					(notice) => notice.id !== 'configuration' || role !== 'owner'
				)
			: []
	);
</script>

{#if notices.length}<section class="lock-notices" aria-label="Printer workflow status">
		{#each notices as notice (notice.id)}<div
				class="lock-notice"
				class:attention={notice.kind === 'attention'}
				role={notice.kind === 'attention' ? 'alert' : 'status'}
			>
				<strong>{notice.title}</strong>
				<p>{notice.message}</p>
				{#if canReviewPrinterLock(notice, role)}<a href={notice.href}>{notice.label} →</a
					>{:else if notice.operatorRequired}<p>
						Ask an operator or owner to review this issue.
					</p>{/if}
			</div>{/each}
	</section>{/if}

<style>
	.lock-notices {
		padding: 1rem clamp(1rem, 3vw, 2.5rem);
		display: grid;
		gap: 0.75rem;
	}
	.lock-notice {
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: 0.65rem;
		padding: 1rem;
		overflow-wrap: anywhere;
	}
	.attention {
		border-left-color: var(--danger, #bf4343);
	}
	p {
		margin: 0.4rem 0;
	}
	a {
		color: var(--accent);
	}
</style>
