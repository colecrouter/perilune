<script lang="ts">
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { page } from '$app/state';
	import { Dialog } from 'bits-ui';
	import { recoverLiveAction } from '../../routes/printer.remote.js';
	let { snapshot }: { snapshot?: PrinterSnapshot } = $props();
	const recovery = $derived(snapshot?.liveRecovery);
	const ready = $derived(
		snapshot?.connection === 'connected' &&
			snapshot.klippy === 'ready' &&
			snapshot.telemetryReady &&
			snapshot.motion.busy === false &&
			!snapshot.motion.calibration &&
			['standby', 'complete', 'cancelled', 'error'].includes(snapshot.job.state)
	);
	let open = $state(false),
		busy = $state(false),
		failure = $state('');
	async function recover() {
		if (!recovery || busy) return;
		busy = true;
		failure = '';
		try {
			await recoverLiveAction({ id: recovery.id, confirmed: true });
			open = false;
		} catch (cause) {
			failure =
				cause && typeof cause === 'object' && 'body' in cause
					? String((cause.body as { message?: string }).message ?? 'Recovery failed.')
					: 'Recovery could not be verified. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

{#if recovery}
	<aside class="live-recovery" role="status">
		<div>
			<strong>Check the printer before continuing</strong>
			<p>{recovery.message}</p>
		</div>
		{#if page.data.user?.role === 'owner'}
			<Dialog.Root bind:open>
				<Dialog.Trigger class="button secondary">Review recovery</Dialog.Trigger>
				<Dialog.Portal
					><Dialog.Overlay class="recovery-overlay" /><Dialog.Content
						class="recovery-dialog"
						onEscapeKeydown={(event) => {
							if (busy) event.preventDefault();
						}}
						onInteractOutside={(event) => {
							if (busy) event.preventDefault();
						}}
					>
						<Dialog.Title>Is the printer stopped?</Dialog.Title>
						<Dialog.Description
							>Inspect the printer in person or on camera. Confirm that movement has stopped and the
							displayed heater targets are appropriate. Clearing this lock does not undo or resend
							the previous action.</Dialog.Description
						>
						{#if !ready}<p>
								Recovery needs a connected, idle printer. If a print is running or paused, stop it
								using the printer or another trusted Moonraker client, then return here. Unlocking
								does not stop a job or turn heaters off.
							</p>{/if}
						{#if failure}<p role="alert">{failure}</p>{/if}
						<div class="recovery-actions">
							<Dialog.Close class="button secondary" disabled={busy}
								>Keep controls locked</Dialog.Close
							><button class="button primary" disabled={busy || !ready} onclick={recover}
								>{busy ? 'Checking printer…' : 'Printer checked · unlock controls'}</button
							>
						</div>
					</Dialog.Content></Dialog.Portal
				>
			</Dialog.Root>
		{/if}
	</aside>
{/if}

<style>
	.live-recovery {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		margin: 1rem;
		padding: 1rem;
		border: 1px solid var(--muted);
		border-radius: 12px;
		background: var(--surface);
	}
	p {
		margin-top: 0.5rem;
	}
	:global(.recovery-overlay) {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: #080b18b3;
	}
	:global(.recovery-dialog) {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		z-index: 101;
		width: min(560px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow: auto;
		padding: 1.5rem;
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--muted);
	}
	.recovery-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	@media (max-width: 540px) {
		.live-recovery {
			align-items: stretch;
			flex-direction: column;
		}
		.recovery-actions {
			flex-direction: column;
		}
	}
</style>
