<script lang="ts">
	import { Dialog } from 'bits-ui';
	import PendingConfiguration from './PendingConfiguration.svelte';
	import ConfigurationRecovery from './ConfigurationRecovery.svelte';
	let { open = $bindable(false), mode = 'save' }: { open?: boolean; mode?: 'save' | 'discard' } =
		$props();
	let canSave = $state(false),
		canDiscard = $state(false);
	$effect(() => {
		if (!open) {
			canSave = false;
			canDiscard = false;
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content">
			<Dialog.Title class="dialog-title"
				>{mode === 'discard' ? 'Discard pending settings?' : 'Save pending settings?'}</Dialog.Title
			>
			<Dialog.Description class="muted">
				{mode === 'discard'
					? 'This discards every pending change, including other calibrations, and restarts Klipper. Your saved settings stay unchanged. Motors may release.'
					: 'Review every pending change, including other calibrations. Saving keeps a recovery copy and restarts Klipper.'}
			</Dialog.Description>
			<PendingConfiguration
				autoInspect
				compact
				{mode}
				saveEnabled={mode === 'discard' ? canDiscard : canSave}
			/>
			<ConfigurationRecovery
				onEnabled={(value) => (canSave = value)}
				onDiscardEnabled={(value) => (canDiscard = value)}
			/>
			<div class="dialog-actions">
				<Dialog.Close class="button secondary">Close</Dialog.Close>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
