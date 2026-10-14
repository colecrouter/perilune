<script lang="ts">
	import { untrack } from 'svelte';
	import { heaterState } from '#lib/domain/temperature.js';
	import Icon from './Icon.svelte';
	let {
		heater,
		current,
		target,
		pending,
		readOnly = false,
		available = true,
		onSet
	}: {
		heater: 'nozzle' | 'bed';
		current: number | null;
		target: number | null;
		pending: boolean;
		readOnly?: boolean;
		available?: boolean;
		onSet: (target: number) => Promise<void>;
	} = $props();
	// A draft belongs to this input, not to the incoming printer snapshot.
	let draft = $state(untrack(() => target));
	let error = $state('');
	let dirty = $state(false);
	let submitting = $state(false);
	let submittedTarget = $state<number | null>(null);
	$effect(() => {
		if (
			submittedTarget !== null &&
			target === submittedTarget &&
			draft === submittedTarget &&
			!pending
		) {
			dirty = false;
			submittedTarget = null;
		}
		if (!dirty) draft = target;
	});
	const unchanged = $derived(available && target !== null && draft === target);
	const alreadyOff = $derived(available && target === 0);
	const thermalState = $derived(heaterState(current, target, available));
	const title = $derived(heater === 'bed' ? 'Bed' : 'Nozzle');
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		submitting = true;
		try {
			const value = draft ?? 0;
			await onSet(value);
			submittedTarget = value;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not set temperature';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="heater">
	<div class="heater-reading">
		<Icon name={heater} size={28} />
		<div>
			<span class="muted">{title}</span><strong
				>{current?.toFixed(0) ?? '—'}<span class="unit"> °C</span></strong
			><small class="thermal-state">{thermalState}</small><small
				>Target {target === null ? '—' : `${target}°C`}</small
			>
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
				oninput={() => (dirty = true)}
			/><button
				class="button primary"
				disabled={pending || readOnly || !available || submitting || unchanged}
				title={unchanged ? `Target already set to ${target}°C.` : undefined}
				type="submit">{readOnly ? 'Read-only' : pending ? 'Pending…' : 'Set'}</button
			>
		</div>
		<button
			class="button secondary"
			type="button"
			disabled={pending || readOnly || !available || submitting || alreadyOff}
			title={alreadyOff ? 'Heater target is already off; it may still be cooling.' : undefined}
			onclick={async () => {
				error = '';
				submitting = true;
				try {
					await onSet(0);
					draft = 0;
					dirty = true;
					submittedTarget = 0;
				} catch (cause) {
					error = cause instanceof Error ? cause.message : 'Could not cool down';
				} finally {
					submitting = false;
				}
			}}>Cool down {title.toLowerCase()}</button
		>
		{#if unchanged && !alreadyOff}<small class="target-hint"
				>Target already set to {target}°C.</small
			>{/if}
		{#if alreadyOff}<small class="target-hint"
				>Target is already off; the {title.toLowerCase()} may still be cooling.</small
			>{/if}
	</form>
</div>
{#if error}<p class="error-text" role="alert">{error}</p>{/if}

<style>
	.target-hint {
		display: block;
		color: var(--muted);
		font-size: 0.75rem;
		margin-top: 0.5rem;
	}
	.thermal-state {
		display: block;
		color: var(--accent);
		font-weight: 600;
	}
	form > .secondary {
		margin-top: 0.5rem;
		padding: 0.35rem 0.6rem;
		font-size: 0.75rem;
		min-height: 44px;
		width: 100%;
	}
</style>
