<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { onMount, type Snippet } from 'svelte';
	import type { ActionRecord } from '#lib/domain/printer.js';
	let {
		fields,
		action = '/actions',
		receiptBase = '/actions',
		children,
		onAccepted = () => {}
	}: {
		fields: Record<string, string>;
		action?: string;
		receiptBase?: string;
		children: Snippet<[{ pending: boolean; uncertain: boolean }]>;
		onAccepted?: (receipt: ActionRecord, submitted: FormData) => void;
	} = $props();
	let enhanced = $state(false);
	onMount(() => {
		enhanced = true;
	});
	let id = $state(crypto.randomUUID()),
		pending = $state(false),
		uncertain = $state(false),
		message = $state(''),
		receipt = $state<ActionRecord | null>(null),
		submittedId = $state('');
</script>

<form
	data-enhanced={enhanced}
	method="POST"
	{action}
	use:enhance={({ formData, cancel }) => {
		if (pending || uncertain) {
			cancel();
			return;
		}
		pending = true;
		message = '';
		receipt = null;
		submittedId = String(formData.get('id'));
		return async ({ result }) => {
			pending = false;
			if (result.type === 'success' && result.data?.receipt) {
				receipt = result.data.receipt as ActionRecord;
				message = `${receipt.label}: ${receipt.status}.`;
				id = crypto.randomUUID();
				onAccepted(receipt, formData);
			} else if (result.type === 'redirect') {
				await applyAction(result);
			} else if (result.type === 'failure') {
				message =
					typeof result.data?.message === 'string'
						? result.data.message
						: 'Action rejected. Your input is kept.';
			} else {
				uncertain = true;
				message =
					'Submission could not be confirmed. Check its receipt before trying again. Nothing will be resent automatically.';
			}
		};
	}}
>
	<input type="hidden" name="id" value={id} />
	{#each Object.entries(fields) as [name, value]}<input type="hidden" {name} {value} />{/each}
	{@render children({ pending, uncertain })}
	{#if message}<p role="status" class="action-message">
			{message}
			{#if receipt || uncertain}<a href={`${receiptBase}/${receipt?.id ?? submittedId}`}
					>Check receipt</a
				>{/if}
		</p>{/if}
</form>

<style>
	.action-message {
		font-size: 0.8rem;
		line-height: 1.5;
		margin: 0.5rem 0;
		max-width: 40rem;
	}
	.action-message a {
		color: var(--accent);
	}
	form {
		min-width: 0;
	}
</style>
