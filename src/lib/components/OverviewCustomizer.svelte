<script lang="ts">
	import { Dialog } from 'bits-ui';
	import {
		overviewPreset,
		panelNames,
		type OverviewLayout,
		type OverviewPanel
	} from '#lib/domain/overview-layout.js';
	let {
		value,
		onSave
	}: { value: OverviewLayout; onSave: (layout: OverviewLayout) => Promise<void> } = $props();
	let open = $state(false),
		saving = $state(false),
		failure = $state('');
	let draft = $state<OverviewLayout>(overviewPreset('balanced'));
	function begin() {
		draft = { ...value, order: [...value.order], hidden: [...value.hidden] };
		failure = '';
		open = true;
	}
	function move(panel: OverviewPanel, direction: number) {
		const order = [...draft.order],
			index = order.indexOf(panel),
			next = index + direction;
		if (next < 0 || next >= order.length) return;
		[order[index], order[next]] = [order[next]!, order[index]!];
		draft = { ...draft, order };
	}
	async function save() {
		saving = true;
		failure = '';
		try {
			await onSave(draft);
			open = false;
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not save layout.';
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class="button secondary" onclick={begin}>Customize</Dialog.Trigger>
	<Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content overview-customizer"
			onEscapeKeydown={(event) => {
				if (saving) event.preventDefault();
			}}
			onInteractOutside={(event) => {
				if (saving) event.preventDefault();
			}}
		>
			<Dialog.Title class="dialog-title">Customize Overview</Dialog.Title>
			<Dialog.Description class="muted"
				>Choose panels and their order. Saved to your account across devices. Job status, warnings
				and heater readings always stay visible.</Dialog.Description
			>
			<fieldset disabled={saving}>
				<legend>Starting layout</legend>
				<div class="presets">
					{#each [['balanced', 'Balanced'], ['camera', 'Camera focus'], ['compact', 'Compact']] as [preset, label]}<button
							type="button"
							class="button secondary"
							aria-pressed={draft.preset === preset}
							onclick={() => (draft = overviewPreset(preset as OverviewLayout['preset']))}
							>{label}</button
						>{/each}
				</div>
				<p class="muted small">
					Use the arrows to move panels. Phones use the same order in one column.
				</p>
				<div class="panel-options">
					{#each draft.order as panel, i (panel)}<div class="panel-option">
							<label
								><input
									type="checkbox"
									checked={!draft.hidden.includes(panel)}
									onchange={(event) => {
										draft = {
											...draft,
											hidden: event.currentTarget.checked
												? draft.hidden.filter((id) => id !== panel)
												: [...draft.hidden, panel]
										};
									}}
								/>{panelNames[panel]}</label
							>
							<div class="moves">
								<button
									type="button"
									class="button secondary"
									aria-label={`Move ${panelNames[panel]} up`}
									disabled={i === 0}
									onclick={() => move(panel, -1)}>↑</button
								><button
									type="button"
									class="button secondary"
									aria-label={`Move ${panelNames[panel]} down`}
									disabled={i === draft.order.length - 1}
									onclick={() => move(panel, 1)}>↓</button
								>
							</div>
						</div>{/each}
				</div>
				{#if failure}<p role="alert" class="error-text">
						{failure} Your choices are kept; try saving again.
					</p>{/if}
				<div class="dialog-actions">
					<button class="button primary" onclick={save}>{saving ? 'Saving…' : 'Save layout'}</button
					><button class="button secondary" onclick={() => (open = false)}>Cancel</button><button
						class="button subtle"
						onclick={() => (draft = overviewPreset('balanced'))}>Reset to default</button
					>
				</div>
			</fieldset>
		</Dialog.Content></Dialog.Portal
	>
</Dialog.Root>

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 1.25rem 0 0;
		min-width: 0;
	}
	legend {
		font-weight: 600;
		margin-bottom: 0.65rem;
	}
	.presets,
	.moves {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.presets {
		margin-bottom: 1rem;
	}
	button[aria-pressed='true'] {
		background: var(--highlight);
		color: var(--highlight-text);
		border-color: var(--highlight-text);
	}
	.panel-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border);
	}
	.panel-option label {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		font-size: 0.9rem;
	}
	.panel-option input {
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
		accent-color: var(--accent);
	}
	.moves {
		flex-wrap: nowrap;
	}
	.moves button {
		min-width: 2.75rem;
		padding: 0.45rem;
	}
	.dialog-actions {
		flex-wrap: wrap;
		position: sticky;
		bottom: -20px;
		padding-block: 0.75rem;
		background: var(--surface);
		z-index: 1;
	}
	@media (max-width: 480px) {
		.dialog-actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.5rem;
		}
		.dialog-actions .button:last-child {
			grid-column: 1 / -1;
		}
	}
</style>
