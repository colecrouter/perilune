<script lang="ts">
	import { Dialog } from 'bits-ui';
	let {
		open = $bindable(false),
		bedTarget,
		nozzleTarget,
		onConfirm
	}: {
		open?: boolean;
		bedTarget: number;
		nozzleTarget: number;
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
			failure = cause instanceof Error ? cause.message : 'Could not stop the print';
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
						disabled={submitting}
					/><span>Cool down nozzle<small>Current target: {nozzleTarget}°C</small></span></label
				>
				<label
					><input
						type="checkbox"
						aria-label="Cool down bed"
						bind:checked={coolBed}
						disabled={submitting}
					/><span>Cool down bed<small>Current target: {bedTarget}°C</small></span></label
				>
			</div>
			{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep printing</Dialog.Close
				><button class="button danger" disabled={submitting} onclick={confirm}
					>{submitting ? 'Submitting…' : 'Stop print'}</button
				>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
