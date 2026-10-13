<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from './Icon.svelte';
	let {
		heater,
		current,
		target,
		pending,
		readOnly = false,
		onSet
	}: {
		heater: 'nozzle' | 'bed';
		current: number | null;
		target: number | null;
		pending: boolean;
		readOnly?: boolean;
		onSet: (target: number) => Promise<void>;
	} = $props();
	// A draft belongs to this input, not to the incoming printer snapshot.
	let draft = $state(untrack(() => target));
	let error = $state('');
	const title = $derived(heater === 'bed' ? 'Bed' : 'Nozzle');
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			await onSet(draft ?? 0);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not set temperature';
		}
	}
</script>

<div class="heater">
	<div class="heater-reading">
		<Icon name={heater} size={28} />
		<div>
			<span class="muted">{title}</span><strong
				>{current?.toFixed(0) ?? '—'}<span class="unit"> °C</span></strong
			><small>Target {target === null ? '—' : `${target}°C`}</small>
		</div>
	</div>
	<form onsubmit={submit}>
		<label for={`${heater}-target`}>Target (°C)</label>
		<div class="heater-input">
			<input
				id={`${heater}-target`}
				aria-label={`${title} target`}
				type="number"
				min="0"
				max={heater === 'bed' ? 120 : 300}
				step="1"
				required
				bind:value={draft}
			/><button class="button primary" disabled={pending || readOnly} type="submit"
				>{readOnly ? 'Read-only' : pending ? 'Pending…' : 'Set'}</button
			>
		</div>
	</form>
</div>
{#if error}<p class="error-text" role="alert">{error}</p>{/if}
