<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import SafetyConfirmation from './SafetyConfirmation.svelte';
	let {
		snapshot,
		intent = 'emergency',
		label = 'Emergency stop',
		disabled = false
	}: { snapshot: PrinterSnapshot; intent?: string; label?: string; disabled?: boolean } = $props();
	let trigger: HTMLAnchorElement | undefined;
	let back = $state<HTMLButtonElement | null>(null);
	let open = $state(false),
		captured = $state<PrinterSnapshot>();
</script>

<Dialog.Root bind:open>
	<a
		bind:this={trigger}
		class={intent === 'emergency' ? 'button danger' : 'button secondary'}
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
		><Dialog.Overlay class="safety-overlay" /><Dialog.Content
			class="safety-dialog"
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
			<Dialog.Close bind:ref={back} class="button secondary">Back</Dialog.Close>
			{#if captured}<SafetyConfirmation
					{intent}
					snapshot={captured}
					receipts={snapshot.safety?.actions}
				/>{/if}
		</Dialog.Content></Dialog.Portal
	>
</Dialog.Root>

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
	:global(.safety-overlay) {
		position: fixed;
		inset: 0;
		background: #090d18aa;
		z-index: 100;
	}
	:global(.safety-dialog) {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(34rem, calc(100vw - 2rem));
		max-height: 85dvh;
		overflow: auto;
		padding: 1.5rem;
		border-radius: 1rem;
		background: var(--surface, #faf8f5);
		color: var(--text);
		box-shadow: 0 1rem 4rem #0005;
		z-index: 101;
	}
</style>
