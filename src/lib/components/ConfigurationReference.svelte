<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		isReferenceCatalogue,
		referenceMatches,
		referenceUrl,
		type ReferenceCatalogue
	} from '#lib/domain/klipper-reference.js';
	import {
		addReferenceOption,
		referenceInventory,
		inventoryPresence
	} from '#lib/domain/reference-configuration.js';
	let {
		text,
		path,
		disabled = false,
		onAdd,
		onCatalogue
	}: {
		text: string;
		path: string;
		disabled?: boolean;
		onAdd: (change: { path: string; expectedText: string; text: string }) => void;
		onCatalogue?: (catalogue: ReferenceCatalogue) => void;
	} = $props();
	let catalogue = $state<ReferenceCatalogue | null>(null),
		pending = $state(true),
		failure = $state('');
	let query = $state(''),
		section = $state(''),
		contextChoice = $state('auto'),
		selectedId = $state(''),
		value = $state(''),
		includesReviewed = $state(false);
	let controller: AbortController | undefined;
	const inventory = $derived(referenceInventory(text));
	const sectionNames = $derived([
		...new Set(inventory.sections.filter((s) => !s.name.startsWith('include ')).map((s) => s.name))
	]);
	const context = $derived(contextChoice === 'auto' ? inventory.kinematics : contextChoice || null);
	const contexts = $derived(
		[...new Set(catalogue?.options.flatMap((o) => (o.context ? [o.context] : [])) ?? [])].sort()
	);
	const matching = $derived(
		catalogue?.options.filter(
			(option) =>
				referenceMatches(option, section, context) &&
				(!query ||
					`${option.key} ${option.description} ${option.heading}`
						.toLowerCase()
						.includes(query.toLowerCase()))
		) ?? []
	);
	const selected = $derived(matching.find((o) => o.id === selectedId));
	const presence = $derived(selected ? inventoryPresence(inventory, section, selected.key) : null);
	const contextConflict = $derived(
		Boolean(selected?.context && inventory.kinematics && selected.context !== inventory.kinematics)
	);
	const canAdd = $derived(
		Boolean(
			selected &&
			['not-local', 'check-includes'].includes(presence ?? '') &&
			!inventory.parts.warning &&
			!contextConflict &&
			!disabled
		)
	);
	const labels = {
		configured: 'In this file',
		generated: 'Calibration-generated',
		ambiguous: 'Raw editing required',
		'check-includes': 'Not local · check includes',
		'not-local': 'Not in this file'
	};
	$effect(() => {
		void path;
		untrack(() => {
			section = sectionNames.includes('printer') ? 'printer' : (sectionNames[0] ?? '');
			query = '';
			selectedId = '';
			value = '';
			contextChoice = 'auto';
			includesReviewed = false;
		});
	});
	$effect(() => {
		if (!sectionNames.includes(section)) {
			section = sectionNames.includes('printer') ? 'printer' : (sectionNames[0] ?? '');
			selectedId = '';
		}
	});
	$effect(() => {
		void selectedId;
		void section;
		value = '';
		includesReviewed = false;
	});
	async function load() {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		pending = true;
		failure = '';
		try {
			const response = await fetch('/reference/klipper.json', {
				signal: request.signal,
				cache: 'no-cache'
			});
			if (!response.ok) throw new Error('Reference unavailable.');
			const result: unknown = await response.json();
			if (!isReferenceCatalogue(result)) throw new Error('Unsupported reference.');
			if (!request.signal.aborted) {
				catalogue = result;
				onCatalogue?.(result);
			}
		} catch {
			if (!request.signal.aborted)
				failure =
					'The reference could not be loaded. Your source editor and drafts are still available.';
		} finally {
			if (controller === request) pending = false;
		}
	}
	onMount(() => {
		void load();
		return () => controller?.abort();
	});
	function add() {
		if (!selected || !canAdd) return;
		failure = '';
		try {
			const next = addReferenceOption(text, section, selected, value, context, includesReviewed);
			onAdd({ path, expectedText: text, text: next });
			value = '';
			includesReviewed = false;
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not add this option to the draft.';
		}
	}
</script>

<div class="reference-browser">
	{#if pending}<p class="muted" role="status">Loading the bundled Klipper reference…</p>{/if}
	{#if failure}<p class="notice" role="alert">{failure}</p>
		{#if !catalogue}<button onclick={load}>Retry reference</button>{/if}{/if}
	{#if catalogue}
		<p class="muted">
			Browse upstream explanations and options absent from this file. Includes are not resolved, and
			documented examples are not automatically applied defaults.
		</p>
		<div class="filters">
			<label
				>Section<select bind:value={section}
					>{#each sectionNames as name}<option value={name}>[{name}]</option>{/each}</select
				></label
			><label
				>Documentation context<select bind:value={contextChoice}
					><option value="auto"
						>{inventory.kinematics
							? `Local kinematics: ${inventory.kinematics}`
							: 'Common settings only'}</option
					>{#each contexts as name}<option value={name}>{name}</option>{/each}</select
				></label
			><label class="search"
				>Find a setting<input
					type="search"
					bind:value={query}
					placeholder="Name or description"
				/></label
			>
		</div>
		{#if !section}<p>
				No existing sections were found. Use raw source to define a section first.
			</p>{:else}
			<p class="count muted">
				{matching.length} documented options{matching.length > 100
					? ' · showing the first 100; refine your search'
					: ''}. Context comes from this file or your selection, not detected firmware.
			</p>
			<div class="reference-layout">
				<div class="options" role="group" aria-label="Documented options">
					{#each matching.slice(0, 100) as option}<button
							aria-pressed={selectedId === option.id}
							onclick={() => {
								selectedId = option.id;
								failure = '';
							}}
							><code>{option.key}</code><span
								>{labels[inventoryPresence(inventory, section, option.key)]}</span
							><small>{option.heading}</small></button
						>{/each}{#if !matching.length}<p class="muted">
							No matching documentation for this section and context.
						</p>{/if}
				</div>
				{#if selected}<section class="option-detail" aria-label="Selected option documentation">
						<p class="eyebrow">{selected.heading}</p>
						<h3>{selected.key}</h3>
						<span class="presence">{labels[presence!]}</span>
						<p class="description">
							{selected.description ||
								'This example does not provide an option-specific explanation. Read the complete section before changing it.'}
						</p>
						{#if selected.exampleValue}<p class="muted">
								Reference example <code>{selected.exampleValue}</code>
							</p>{/if}
						<div class="links">
							<a href={referenceUrl(selected)} target="_blank" rel="noreferrer"
								>Klipper documentation ↗</a
							><a
								href={`https://github.com/Klipper3d/klipper/blob/${catalogue.source.revision}/docs/Config_Reference.md#L${selected.line}`}
								target="_blank"
								rel="noreferrer">Pinned source ↗</a
							>
						</div>
						{#if canAdd}<form
								onsubmit={(event) => {
									event.preventDefault();
									add();
								}}
							>
								<label
									>Explicit value<input
										bind:value
										maxlength="240"
										required
										autocomplete="off"
										placeholder="Choose a value after reading the reference"
									/></label
								>{#if inventory.hasIncludes}<p class="notice">
										An included file may already supply this option. Adding a local value could
										override or conflict with it.
									</p>
									<label class="check"
										><input type="checkbox" bind:checked={includesReviewed} />I checked included
										files for this option.</label
									>{/if}<button
									class="primary"
									disabled={!value.trim() || (inventory.hasIncludes && !includesReviewed)}
									>Add to draft</button
								>
								<p class="muted small">
									This adds one line to your draft. Review changes before saving; no runtime value
									is applied.
								</p>
							</form>{:else}<p class="muted">
								{contextConflict
									? 'This documentation context differs from the local kinematics. Browse it here; use matching documentation before adding a value.'
									: inventory.parts.warning
										? 'Inspect the generated-settings warning before adding an option.'
										: presence === 'generated'
											? 'Klipper owns this value in the protected calibration block.'
											: presence === 'configured'
												? 'This option already appears in the source. Edit it in the explained settings or raw editor.'
												: presence === 'ambiguous'
													? 'The section is repeated or ambiguous. Use raw source.'
													: 'Finish the pending edit before adding an option.'}
							</p>{/if}
					</section>{:else}<div class="option-detail muted">
						<p>Select a setting to read its upstream explanation.</p>
					</div>{/if}
			</div>
		{/if}
		<p class="attribution small muted">
			Klipper documentation · revision <a
				href={`https://github.com/Klipper3d/klipper/blob/${catalogue.source.revision}/docs/Config_Reference.md`}
				target="_blank"
				rel="noreferrer">{catalogue.source.revision.slice(0, 12)}</a
			>
			·
			<a href={catalogue.source.licenseUrl} target="_blank" rel="noreferrer"
				>{catalogue.source.license}</a
			>. Reference metadata describes this pinned version; installed firmware may differ.
		</p>
	{/if}
</div>

<style>
	.reference-browser {
		min-width: 0;
		padding: 0.5rem 0;
	}
	.muted {
		color: var(--muted);
	}
	p {
		line-height: 1.6;
		font-size: 0.85rem;
	}
	.filters {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.search {
		grid-column: 1/-1;
	}
	label {
		display: grid;
		gap: 0.5rem;
		font-weight: 600;
		font-size: 0.85rem;
	}
	input:not([type='checkbox']),
	select {
		width: 100%;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		padding: 0.7rem;
		background: var(--canvas);
		color: var(--text);
		font: inherit;
	}
	.reference-layout {
		display: grid;
		grid-template-columns: minmax(150px, 1fr) minmax(0, 1.7fr);
		gap: 1rem;
		align-items: start;
	}
	.options {
		max-height: 450px;
		overflow: auto;
		display: grid;
		gap: 0.4rem;
	}
	.options button {
		display: grid;
		gap: 0.3rem;
		text-align: left;
		padding: 0.8rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.options button[aria-pressed='true'] {
		background: var(--highlight);
		color: var(--highlight-text);
		border-color: transparent;
	}
	.options span,
	.options small {
		font-size: 0.7rem;
		color: var(--muted);
	}
	.options button[aria-pressed='true'] span,
	.options button[aria-pressed='true'] small {
		color: inherit;
	}
	button {
		cursor: pointer;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		padding: 0.7rem 1rem;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.primary {
		background: var(--accent);
		color: #fff;
		border-color: transparent;
	}
	.option-detail {
		padding: 1rem;
		background: var(--canvas);
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		min-width: 0;
	}
	h3 {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 1rem;
		overflow-wrap: anywhere;
		margin: 0.5rem 0;
	}
	.presence {
		font-size: 0.7rem;
		font-weight: 600;
		background: var(--highlight);
		color: var(--highlight-text);
		padding: 0.3rem 0.5rem;
		border-radius: 0.4rem;
	}
	.description {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		font-size: 0.8rem;
		margin: 1rem 0;
	}
	a {
		color: var(--accent);
	}
	form {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
		margin-top: 1rem;
	}
	.notice {
		padding: 0.8rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		background: var(--surface);
	}
	.check {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		font-weight: 400;
		line-height: 1.5;
		margin: 1rem 0;
	}
	.check input {
		accent-color: var(--accent);
	}
	.small {
		font-size: 0.75rem;
	}
	.attribution {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
		margin-top: 1.5rem;
	}
	.count {
		font-size: 0.75rem;
	}
	@media (max-width: 700px) {
		.reference-layout,
		.filters {
			grid-template-columns: 1fr;
		}
		.options {
			max-height: 220px;
		}
		.search {
			grid-column: auto;
		}
		.option-detail {
			padding: 0.8rem;
		}
	}
</style>
