<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	let {
		open = $bindable(false),
		available = true,
		bedTarget,
		nozzleTarget,
		onConfirm
	}: {
		open?: boolean;
		available?: boolean;
		bedTarget: number | null;
		nozzleTarget: number | null;
		onConfirm: (coolBed: boolean, coolNozzle: boolean) => Promise<void>;
	} = $props();
	let coolBed = $state(true);
	let coolNozzle = $state(true);
	let submitting = $state(false);
	let failure = $state('');
	async function confirm() {
		submitting = true;
		failure = '';
		try {
			await onConfirm(coolBed, coolNozzle);
			open = false;
		} catch (cause) {
			failure = isHttpError(cause)
				? cause.body.message
				: cause instanceof Error
					? cause.message
					: 'Could not stop the print';
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content">
			<Dialog.Title class="dialog-title">Stop this print?</Dialog.Title>
			<Dialog.Description class="muted"
				>Choose what happens to the heaters after stopping. Keeping them heated can help while
				troubleshooting.</Dialog.Description
			>
			<div class="cooldown-options">
				<label
					><input
						type="checkbox"
						aria-label="Cool down nozzle"
						bind:checked={coolNozzle}
						disabled={submitting || !available || nozzleTarget === 0}
					/><span
						>Cool down nozzle<small
							>{!available
								? 'Waiting for current heater targets.'
								: nozzleTarget === 0
									? 'Target already off; the nozzle may still be cooling.'
									: `Current target: ${nozzleTarget ?? 'unknown'}°C`}</small
						></span
					></label
				>
				<label
					><input
						type="checkbox"
						aria-label="Cool down bed"
						bind:checked={coolBed}
						disabled={submitting || !available || bedTarget === 0}
					/><span
						>Cool down bed<small
							>{!available
								? 'Waiting for current heater targets.'
								: bedTarget === 0
									? 'Target already off; the bed may still be cooling.'
									: `Current target: ${bedTarget ?? 'unknown'}°C`}</small
						></span
					></label
				>
			</div>
			{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep printing</Dialog.Close
				><button class="button danger" disabled={submitting || !available} onclick={confirm}
					>{submitting ? 'Submitting…' : 'Stop print'}</button
				>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
