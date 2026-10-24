<script lang="ts">
	import { Dialog } from 'bits-ui';
	import PendingConfiguration from './PendingConfiguration.svelte';
	import ConfigurationRecovery from './ConfigurationRecovery.svelte';
	import type { ConfigRecovery } from '#lib/domain/config-application.js';
	let {
		open = $bindable(false),
		mode = 'save',
		onComplete
	}: { open?: boolean; mode?: 'save' | 'discard'; onComplete?: () => void } = $props();
	let canSave = $state(false),
		canDiscard = $state(false);
	let submittedId = $state<string | null>(null);
	let recovery = $state<ConfigRecovery | null>(null);
	$effect(() => {
		if (!open) {
			canSave = false;
			canDiscard = false;
			submittedId = null;
			recovery = null;
		}
	});
	$effect(() => {
		const application = recovery?.application;
		if (
			open &&
			submittedId &&
			application?.id === submittedId &&
			application.phase === 'ready' &&
			(mode === 'discard'
				? application.mode === 'discard'
				: application.mode === 'calibration' && application.writeVerified)
		) {
			submittedId = null;
			open = false;
			onComplete?.();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content pending-dialog">
			<Dialog.Title class="dialog-title"
				>{mode === 'discard' ? 'Discard pending settings?' : 'Save pending settings?'}</Dialog.Title
			>
			<Dialog.Description class="muted">
				{mode === 'discard'
					? 'This discards every pending change, including other calibrations, and restarts Klipper. Your saved settings stay unchanged. Motors may release.'
					: 'Review every pending change, including other calibrations. Saving keeps a recovery copy and restarts Klipper.'}
			</Dialog.Description>
			<div class="pending-dialog-body">
				{#if open}{#key mode}<svelte:boundary>
							<PendingConfiguration
								autoInspect
								compact
								{mode}
								saveEnabled={mode === 'discard' ? canDiscard : canSave}
								onSubmitted={(id) => (submittedId = id)}
							/>
							<ConfigurationRecovery
								applicationId={submittedId}
								onRecovery={(value) => (recovery = value)}
								onEnabled={(value) => (canSave = value)}
								onDiscardEnabled={(value) => (canDiscard = value)}
							/>
							{#snippet pending()}
								<div
									class="settings-skeleton"
									role="status"
									aria-label="Loading pending settings"
									aria-busy="true"
								>
									<div class="skeleton-button"></div>
									<div class="skeleton-line"></div>
									<div class="skeleton-row"></div>
									<div class="skeleton-row"></div>
									<div class="skeleton-line"></div>
									<div class="skeleton-button"></div>
								</div>
							{/snippet}
						</svelte:boundary>{/key}{/if}
			</div>
			<div class="dialog-actions">
				<Dialog.Close class="button secondary">Close</Dialog.Close>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.pending-dialog) {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: calc(100dvh - 2rem);
	}
	.pending-dialog-body {
		block-size: clamp(14rem, 45dvh, 30rem);
		min-block-size: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}
	.settings-skeleton {
		display: grid;
		gap: 1rem;
		padding-block: 0.5rem;
	}
	.settings-skeleton > div {
		background: var(--border);
		border-radius: 0.35rem;
	}
	.skeleton-button {
		height: 2.75rem;
		width: min(100%, 15rem);
	}
	.skeleton-line {
		height: 1.25rem;
		width: 85%;
	}
	.skeleton-row {
		height: 2.5rem;
	}
	.dialog-actions {
		flex-shrink: 0;
	}
</style>
