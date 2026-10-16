<script lang="ts">
	import { effectiveSetting, type ConfigSources } from '#lib/domain/config-sources.js';
	import {
		calibrationDraftChange,
		checkCalibrationProposal,
		type CalibrationDraftProposal
	} from '#lib/domain/calibration-draft.js';
	import { referenceInventory } from '#lib/domain/reference-configuration.js';
	import { configFields, type ConfigDocument } from '#lib/domain/configuration.js';
	let {
		proposal,
		text,
		path,
		source,
		includesPresent = false,
		disabled = false,
		onAdd,
		onResolveSources,
		onDismiss
	}: {
		proposal: CalibrationDraftProposal;
		text: string;
		path: string;
		source: ConfigDocument['source'];
		includesPresent?: boolean;
		disabled?: boolean;
		onResolveSources?: () => Promise<ConfigSources>;
		onAdd: (change: {
			path: string;
			expectedText: string;
			text: string;
			sources?: { root: string; fingerprint: string };
		}) => void;
		onDismiss: () => void;
	} = $props();
	let sources = $state<ConfigSources | null>(null);
	let resolving = $state(false);
	const origin = $derived(
		sources ? effectiveSetting(sources, 'extruder', 'rotation_distance') : null
	);
	async function resolve() {
		if (!onResolveSources) return;
		resolving = true;
		failure = '';
		sources = null;
		try {
			sources = await onResolveSources();
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not review source files.';
		} finally {
			resolving = false;
		}
	}
	let repeated = $state(false),
		includesReviewed = $state(false),
		failure = $state('');
	let added = $state<{ id: string; path: string } | null>(null);
	$effect(() => {
		void path;
		includesReviewed = false;
		failure = '';
	});
	const includes = $derived(includesPresent || referenceInventory(text).hasIncludes);
	const measurement = $derived.by(() => {
		try {
			return checkCalibrationProposal(proposal, source);
		} catch {
			return null;
		}
	});
	const sourceReady = $derived(
		!onResolveSources ||
			Boolean(
				origin &&
				origin.path === path &&
				!origin.generated &&
				!origin.multiline &&
				Number(origin.value) === measurement?.rotationDistance
			)
	);
	const plan = $derived.by(() => {
		try {
			return { change: calibrationDraftChange(text, proposal, source, true), issue: '' };
		} catch (cause) {
			return {
				change: null,
				issue: cause instanceof Error ? cause.message : 'Check this setting.'
			};
		}
	});
	const alreadyAdded = $derived(
		added?.id === proposal.id &&
			added.path === path &&
			configFields(text).some(
				(field) =>
					field.id === 'extruder.rotation_distance' &&
					field.editable &&
					Number(field.value) === measurement?.proposed
			)
	);
	function add() {
		failure = '';
		try {
			if (
				disabled ||
				!repeated ||
				!sourceReady ||
				(includes && !includesReviewed && !onResolveSources)
			)
				return;
			const next = calibrationDraftChange(
				text,
				proposal,
				source,
				Boolean(onResolveSources) || !includes || includesReviewed
			);
			onAdd({
				path,
				expectedText: text,
				text: next.text,
				sources: sources ? { root: sources.root, fingerprint: sources.fingerprint } : undefined
			});
			added = { id: proposal.id, path };
		} catch (cause) {
			failure =
				cause instanceof Error
					? cause.message
					: 'Could not add the proposal. Your draft is unchanged.';
		}
	}
</script>

<section class="calibration-proposal" aria-label="Calibration proposal">
	<p class="eyebrow">Calibration → configuration</p>
	<h3>Review extrusion distance</h3>
	<p>
		{proposal.source === 'simulator' ? 'Simulator example' : 'Manual printer measurement'} · [extruder]
		<code>rotation_distance</code>
	</p>
	{#if measurement}<p class="values">
			<span>{measurement.rotationDistance} mm</span><span aria-hidden="true">→</span><strong
				>{measurement.proposed.toFixed(3)} mm</strong
			>
		</p>
		<p class="muted">
			{measurement.before} − {measurement.after} = {measurement.actual.toFixed(2)} mm measured for a requested
			50 mm. Existing <code>gear_ratio</code>, comments and other edits stay in place.
		</p>{/if}
	{#if alreadyAdded}<p role="status">
			Proposal added to {path}. Review all source changes before saving. Adding a proposal does not
			save or apply it.
		</p>
	{:else}
		<p>
			Choose the file containing this setting from Configuration files. The draft must still use the
			rotation distance from the measurement.
		</p>
		{#if onResolveSources}
			<button type="button" onclick={resolve} disabled={disabled || resolving}
				>{resolving ? 'Reviewing sources…' : 'Find effective setting'}</button
			>
			{#if origin}<p>
					Effective setting: <a
						href={`?file=${encodeURIComponent(origin.path)}`}
						data-sveltekit-reset="false">{origin.path}:{origin.line}</a
					>
					· {origin.value}{origin.generated ? ' · protected generated setting' : ''}
				</p>
				{#if !sourceReady}<p class="issue">
						Open the effective source file. Protected, multiline or changed values require manual
						review.
					</p>{/if}
			{:else if sources}<p class="issue">
					No effective rotation distance was found in the main configuration.
				</p>{/if}
		{/if}
		{#if plan.issue}<p class="issue" role="status">{plan.issue}</p>{/if}
		<label
			><input type="checkbox" bind:checked={repeated} {disabled} />I repeated the measurement and
			confirmed this result.</label
		>
		{#if includes && !onResolveSources}<label
				><input type="checkbox" bind:checked={includesReviewed} {disabled} />I reviewed included
				files and runtime overrides; this is the setting to change.</label
			>{/if}
		<button
			class="button primary"
			onclick={add}
			disabled={disabled ||
				!plan.change ||
				!repeated ||
				(includes && !includesReviewed && !onResolveSources)}>Add to this draft</button
		>
	{/if}
	<button onclick={onDismiss} {disabled}>Dismiss proposal</button>
	{#if failure}<p role="alert" class="issue">{failure}</p>{/if}
	<p class="muted small">
		This handoff stays in this tab for 30 minutes. Refreshing clears it. Saving or applying still
		requires a separate source review.
	</p>
	<a
		href="https://www.klipper3d.org/Rotation_Distance.html#calibrating-rotation_distance-on-extruders"
		target="_blank"
		rel="noreferrer">Extruder rotation-distance guide ↗</a
	>
</section>

<style>
	.calibration-proposal {
		padding: 1.25rem;
		border: 1px solid var(--border-strong);
		border-radius: 12px;
		background: var(--surface);
		margin-bottom: 1rem;
	}
	h3 {
		font-size: 1.5rem;
		margin: 0.4rem 0;
	}
	p {
		line-height: 1.6;
	}
	.values {
		display: flex;
		gap: 0.7rem;
		align-items: baseline;
		flex-wrap: wrap;
		font-size: 1.25rem;
	}
	.values strong {
		color: var(--accent);
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 44px;
		margin: 0.5rem 0;
	}
	input {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		accent-color: var(--accent);
	}
	button {
		min-height: 44px;
		padding: 0.6rem 0.85rem;
		margin: 0.5rem 0.5rem 0.5rem 0;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		font: inherit;
		background: var(--surface);
		color: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: 0.82rem;
	}
	.issue {
		border-left: 3px solid var(--border-strong);
		padding-left: 0.8rem;
	}
	a {
		color: var(--accent);
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
