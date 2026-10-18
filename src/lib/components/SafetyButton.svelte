<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import ActionForm from './ActionForm.svelte';
	import SafetyConfirmation from './SafetyConfirmation.svelte';
	let {
		snapshot,
		intent = 'emergency',
		label = 'Emergency stop',
		disabled = false
	}: { snapshot: PrinterSnapshot; intent?: string; label?: string; disabled?: boolean } = $props();
	let trigger = $state<HTMLAnchorElement>();
	let back = $state<HTMLButtonElement | null>(null);
	let open = $state(false),
		captured = $state<PrinterSnapshot>();
</script>

{#if intent === 'emergency'}
	<ActionForm
		action="/safety"
		receiptBase="/safety"
		fields={{ intent: 'emergency', confirmed: 'true' }}
		receipts={snapshot.safety?.actions}
	>
		{#snippet children({ pending, uncertain })}<button
				class="button danger"
				disabled={disabled || pending || uncertain}
				title="Immediately stop movement and heating. Motors may release; support the gantry if needed."
				>{pending ? 'Stopping…' : label}</button
			>{/snippet}
	</ActionForm>
{:else}
	<Dialog.Root bind:open>
		<a
			bind:this={trigger}
			class="button secondary"
			href={disabled ? undefined : `/safety?intent=${intent}`}
			aria-disabled={disabled}
			title={disabled ? 'There is no running or paused job to stop.' : undefined}
			onclick={(event) => {
				event.preventDefault();
				if (disabled) return;
				captured = structuredClone($state.snapshot(snapshot));
				open = true;
			}}>{label}</a
		>
		<Dialog.Portal
			><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
				class="dialog-content safety-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					back?.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					trigger?.focus();
				}}
			>
				<Dialog.Title class="sr-only">{label}</Dialog.Title><Dialog.Description class="sr-only"
					>Review and explicitly confirm this printer safety action.</Dialog.Description
				>
				{#if captured}<SafetyConfirmation
						{intent}
						snapshot={captured}
						receipts={snapshot.safety?.actions}
						onAccepted={() => {
							open = false;
						}}
						>{#snippet dismiss()}<Dialog.Close bind:ref={back} class="button secondary"
								>Back</Dialog.Close
							>{/snippet}</SafetyConfirmation
					>{/if}
			</Dialog.Content></Dialog.Portal
		>
	</Dialog.Root>
{/if}

<style>
	a[aria-disabled='true'] {
		opacity: 0.55;
		cursor: default;
	}
	:global(.safety-dialog .sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
