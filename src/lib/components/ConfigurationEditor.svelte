<script lang="ts">
	import { configFileIndex, configMacros, configRevision } from '#lib/domain/config-browser.js';
	import type { ConfigSources } from '#lib/domain/config-sources.js';
	import { untrack, onMount } from 'svelte';
	import CalibrationDraft from './CalibrationDraft.svelte';
	import type { CalibrationDraftProposal } from '#lib/domain/calibration-draft.js';
	import ConfigurationSource from './ConfigurationSource.svelte';
	import ConfigurationReference from './ConfigurationReference.svelte';
	import {
		referenceMatches,
		referenceUrl,
		type ReferenceCatalogue
	} from '#lib/domain/klipper-reference.js';
	import { referenceInventory } from '#lib/domain/reference-configuration.js';
	import { Dialog } from 'bits-ui';
	import {
		configParts,
		configFields,
		configDiff,
		rawConfigEdit,
		updateConfigField,
		checkConfigChange,
		type ConfigDocument,
		type ConfigFile,
		type ConfigSave,
		type ConfigSaved
	} from '#lib/domain/configuration.js';
	let {
		document: source,
		files,
		onRead,
		onSave,
		onBackup,
		onDirty,
		applicationEnabled = false,
		onApply,
		onResolveSources,
		calibrationProposal = null,
		onDismissProposal
	}: {
		document: ConfigDocument;
		files: ConfigFile[];
		onRead: (path: string) => Promise<ConfigDocument>;
		onSave: (request: ConfigSave) => Promise<ConfigSaved>;
		onBackup: (path: string, id: string) => Promise<string>;
		onDirty?: (dirty: boolean) => void;
		applicationEnabled?: boolean;
		onApply?: (
			request: ConfigSave & { sources?: { root: string; fingerprint: string } }
		) => Promise<void>;
		onResolveSources?: () => Promise<ConfigSources>;
		calibrationProposal?: CalibrationDraftProposal | null;
		onDismissProposal?: () => void;
	} = $props();
	interface Draft {
		base: ConfigDocument;
		text: string;
		latest: ConfigDocument;
		sources?: { root: string; fingerprint: string };
	}
	const initial = untrack(() => source);
	let drafts = $state<Record<string, Draft>>({
		[initial.path]: { base: initial, text: initial.text, latest: initial }
	});
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	let reference = $state<ReferenceCatalogue | null>(null);
	let modes = $state<Record<string, 'guided' | 'raw'>>({});
	let fileQuery = $state('');
	let fileBrowserOpen = $state(false);
	let settingQuery = $state('');
	let jump = $state<{ line: number; token: number } | null>(null);
	const fileIndex = $derived(configFileIndex(files, fileQuery));
	const revisionOf = $derived(configRevision(source.path, files));
	let busy = $state(false),
		failure = $state(''),
		notice = $state(''),
		invalidField = $state(false);
	let restartConfirmed = $state(false);
	let reviewOpen = $state(false),
		reviewed = $state<{
			request: ConfigSave & { sources?: { root: string; fingerprint: string } };
			base: ConfigDocument;
		}>(),
		confirmed = $state(false);
	let selectedBackup = $state('');
	const current = $derived(drafts[source.path]);
	const referenceContext = $derived(current ? referenceInventory(current.text).kinematics : null);
	const parts = $derived(configParts(current?.text ?? source.text));
	const fields = $derived(configFields(current?.text ?? source.text));
	const visibleFields = $derived(
		fields
			.filter((field) =>
				`${field.hint.title} ${field.section} ${field.key}`
					.toLowerCase()
					.includes(settingQuery.trim().toLowerCase())
			)
			.slice(0, 100)
	);
	const fieldSections = $derived([...new Set(visibleFields.map((field) => field.section))]);
	const macros = $derived(configMacros(parts.editable));
	const mode = $derived(
		revisionOf ? 'raw' : fields.length ? (modes[source.path] ?? 'guided') : 'raw'
	);
	const dirty = $derived(Boolean(current && current.text !== current.base.text));
	const anyDirty = $derived(Object.values(drafts).some((d) => d.text !== d.base.text));
	const conflict = $derived(Boolean(current && current.latest.version !== current.base.version));
	const difference = $derived(
		reviewed ? configDiff(reviewed.base.text, reviewed.request.text) : null
	);
	const includes = $derived(
		[...parts.editable.matchAll(/^\[include ([^\]\r\n]+)\]/gm)].map((match) => match[1]!)
	);
	$effect(() => {
		const doc = source;
		if (!modes[doc.path]) modes[doc.path] = configFields(doc.text).length ? 'guided' : 'raw';
		if (!drafts[doc.path]) drafts[doc.path] = { base: doc, text: doc.text, latest: doc };
		else drafts[doc.path].latest = doc;
	});
	$effect(() => {
		void source.path;
		jump = null;
		failure = '';
		notice = '';
		invalidField = false;
		selectedBackup = '';
		reviewOpen = false;
	});
	$effect(() => {
		onDirty?.(anyDirty);
	});
	$effect(() => {
		if (revisionOf) {
			reviewOpen = false;
			confirmed = false;
			restartConfirmed = false;
		}
	});

	function addFromReference(change: {
		path: string;
		expectedText: string;
		text: string;
		sources?: { root: string; fingerprint: string };
	}) {
		if (
			revisionOf ||
			busy ||
			source.path !== change.path ||
			!current ||
			current.text !== change.expectedText
		)
			throw new Error('The draft changed. Review the current file before adding the option.');
		checkConfigChange(current.text, change.text);
		current.text = change.text;
		if (change.sources) current.sources = change.sources;
		failure = '';
		invalidField = false;
		notice = 'Change added to your draft. Review changes before saving.';
	}

	function rawEdit(value: string) {
		if (!current || revisionOf) return;
		current.text = rawConfigEdit(parts.editable, value) + parts.generated;
		failure = '';
		notice = '';
		invalidField = false;
	}
	function editField(id: string, value: string) {
		if (!current) return false;
		try {
			current.text = updateConfigField(current.text, id, value);
			failure = '';
			notice = '';
			invalidField = false;
			return true;
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Check this field.';
			invalidField = false;
			return false;
		}
	}
	let editingBaseline: { path: string; id: string; text: string } | undefined;
	function finishField(id: string, input: HTMLInputElement) {
		const baseline = editingBaseline;
		if (!editField(id, input.value) && baseline && baseline.id === id) {
			drafts[baseline.path]!.text = baseline.text;
			input.value = configFields(baseline.text).find((field) => field.id === id)?.value ?? '';
		}
		editingBaseline = undefined;
		invalidField = false;
	}
	async function refresh(replaceClean = true) {
		if (!current) return;
		const path = source.path;
		const draft = current;
		busy = true;
		failure = '';
		try {
			const latest = await onRead(path);
			draft.latest = latest;
			if (replaceClean && draft.text === draft.base.text) {
				draft.base = latest;
				draft.text = latest.text;
			}
			notice =
				latest.version === draft.base.version
					? 'Saved version checked.'
					: 'The saved file changed. Your draft has been kept; compare it with the current saved source below.';
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not check the saved file.';
		} finally {
			busy = false;
		}
	}
	function discard() {
		if (!current) return;
		if (
			dirty &&
			!window.confirm('Discard this file’s draft and load the latest checked saved version?')
		)
			return;
		current.base = current.latest;
		current.text = current.latest.text;
		failure = '';
		notice = 'Loaded the saved version.';
		invalidField = false;
	}
	function review() {
		if (revisionOf) {
			failure = 'Saved revisions are read-only. Open the current file to make changes.';
			return;
		}
		if (!current) return;
		try {
			checkConfigChange(current.base.text, current.text);
			reviewed = {
				base: current.base,
				request: {
					id: crypto.randomUUID(),
					path: source.path,
					expectedVersion: current.base.version,
					text: current.text,
					sources: current.sources
				}
			};
			confirmed = false;
			restartConfirmed = false;
			reviewOpen = true;
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Check the draft.';
		}
	}
	async function apply() {
		if (revisionOf) {
			failure = 'Saved revisions are read-only. Open the current file to make changes.';
			return;
		}
		if (!reviewed || !confirmed || !restartConfirmed || busy || !onApply) return;
		busy = true;
		failure = '';
		try {
			await onApply(reviewed.request);
			notice =
				'Reviewed operation submitted. Follow configuration recovery for the result; file save is not startup verification.';
			reviewOpen = false;
		} catch (cause) {
			failure =
				cause instanceof Error
					? cause.message
					: 'Application request failed. Check recovery before retrying.';
			reviewOpen = false;
		} finally {
			busy = false;
		}
	}
	async function save() {
		if (revisionOf) {
			failure = 'Saved revisions are read-only. Open the current file to make changes.';
			return;
		}
		if (!reviewed || !confirmed || busy) return;
		const record = reviewed;
		const draft = drafts[record.request.path]!;
		busy = true;
		failure = '';
		try {
			const result = await onSave(record.request);
			draft.base = { ...record.base, ...result, text: record.request.text };
			draft.latest = draft.base;
			notice = 'Simulator file saved. Running printer settings were not changed.';
			reviewOpen = false;
			try {
				const latest = await onRead(record.request.path);
				draft.latest = latest;
				if (latest.version === result.version) draft.base = latest;
			} catch {
				/* The save receipt is authoritative; refresh is optional. */
			}
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Save failed. Keep your draft.';
			reviewOpen = false;
			try {
				draft.latest = await onRead(record.request.path);
			} catch {
				/* Keep draft and baseline if the service remains unavailable. */
			}
		} finally {
			busy = false;
		}
	}
	async function loadBackup() {
		if (revisionOf) {
			failure = 'Saved revisions are read-only. Open the current file to make changes.';
			return;
		}
		if (!current || !selectedBackup) return;
		if (dirty && !window.confirm('Replace this file’s unsaved draft with the selected backup?'))
			return;
		const draft = current;
		const path = source.path;
		busy = true;
		failure = '';
		try {
			const text = await onBackup(path, selectedBackup);
			if (configRevision(path, files))
				throw new Error('Saved revisions are read-only. Open the current file to make changes.');
			draft.text = text;
			invalidField = false;
			notice = 'Backup loaded into your draft. Review and save to create a new revision.';
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not load the backup.';
		} finally {
			busy = false;
		}
	}
	function download(text: string, path: string) {
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
		const link = globalThis.document.createElement('a');
		link.href = url;
		link.download = path.split('/').at(-1)!;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function exportDraft() {
		if (current) download(current.text, source.path);
	}
	function exportReviewed() {
		if (reviewed) download(reviewed.request.text, reviewed.request.path);
	}
</script>

<svelte:window
	onbeforeunload={(event) => {
		if (anyDirty) {
			event.preventDefault();
			event.returnValue = '';
		}
	}}
/>
<div class="workspace" data-config-ready={mounted}>
	<aside class="file-list panel">
		<h2>Configuration files</h2>
		<button
			type="button"
			class="file-browser-toggle"
			aria-expanded={fileBrowserOpen}
			onclick={() => (fileBrowserOpen = !fileBrowserOpen)}
			>Browse files <span>{source.path}</span><span aria-hidden="true"
				>{fileBrowserOpen ? '−' : '+'}</span
			></button
		>
		<div class:file-browser-collapsed={!fileBrowserOpen}>
			<p class="muted">
				{source.source === 'simulator' ? 'Simulator examples' : 'Private · owner access'}
			</p>
			<label class="file-search"
				>Find a file<input
					type="search"
					bind:value={fileQuery}
					placeholder="Name or folder"
				/></label
			>
			<nav aria-label="Configuration files">
				{#snippet fileLink(file: ConfigFile)}<a
						href={`?file=${encodeURIComponent(file.path)}`}
						data-sveltekit-reset="false"
						aria-current={file.path === source.path ? 'page' : undefined}
					>
						<span>{file.path}</span
						>{#if drafts[file.path] && drafts[file.path]!.text !== drafts[file.path]!.base.text}<span
								class="draft-dot"
								aria-label="Unsaved draft">●</span
							>{/if}</a
					>{/snippet}
				{#each fileIndex.folders as folder}<section class="file-group">
						<h3>{folder.path || 'Configuration'}</h3>
						{#each folder.files as file}{@render fileLink(file)}{/each}
					</section>{/each}
				{#each fileIndex.revisions as group}<details
						open={group.files.some((file) => file.path === source.path) || !!fileQuery}
					>
						<summary>Saved revisions · {group.current} ({group.files.length})</summary
						>{#each group.files as file}{@render fileLink(file)}{/each}
					</details>{/each}
				{#if !fileIndex.folders.length && !fileIndex.revisions.length}<p>No matching files.</p>{/if}
			</nav>
			<p class="muted small">
				Includes stay separate. Perilune never flattens files or rewrites unknown settings.
			</p>
		</div>
	</aside>
	{#if current}<div class="editor-column">
			{#if calibrationProposal}{#key calibrationProposal.id}<CalibrationDraft
						proposal={calibrationProposal}
						{onResolveSources}
						text={current.text}
						path={source.path}
						source={source.source}
						includesPresent={files.length > 1}
						disabled={busy || !mounted || conflict || !!revisionOf}
						onAdd={addFromReference}
						onDismiss={() => onDismissProposal?.()}
					/>{/key}{/if}
			<section class="panel">
				<header class="file-heading">
					<div>
						<p class="eyebrow">
							{source.source === 'simulator'
								? 'Simulator workspace'
								: 'Live file · draft and export'}
						</p>
						<h2>{source.path}</h2>
						<p class="muted">
							{dirty ? 'Unsaved draft' : 'Matches your opened revision'}{conflict
								? ' · newer saved version available'
								: ''}
						</p>
					</div>
					<div class="toolbar">
						<button disabled={busy || !mounted} onclick={() => refresh()}
							>Check saved version</button
						><button disabled={busy || !mounted} onclick={exportDraft}>Export draft</button>
					</div>
				</header>
				{#if revisionOf}<p class="notice">
						Read-only saved revision of <a
							href={`?file=${encodeURIComponent(revisionOf)}`}
							data-sveltekit-reset="false">{revisionOf}</a
						>. Opening it does not restore or activate it. Export or copy the changes you need into
						the current file for review.
					</p>{:else if source.source === 'moonraker' && !applicationEnabled}<p class="notice">
						Live file edits remain local drafts. Export for review; printer writes are disabled on
						this server.
					</p>{/if}
				{#if failure}<p class="notice error" role="alert">{failure}</p>{/if}{#if notice}<p
						class="notice"
						role="status"
					>
						{notice}
					</p>{/if}
				{#if conflict}<section class="conflict">
						<h3>A newer saved file exists</h3>
						<p>
							Your draft still uses its original baseline. Compare the current saved source, then
							export your work or load the saved version before reapplying changes.
						</p>
						<details>
							<summary>Current saved source</summary>
							<pre>{current.latest.text}</pre>
						</details>
						<button disabled={busy || !mounted} onclick={discard}
							>Load current saved version…</button
						>
					</section>{/if}
				<footer aria-label="Draft actions">
					<details class="save-help">
						<summary>{dirty ? 'Unsaved changes' : 'No changes'} · save details</summary>
						<p class="muted small">
							{revisionOf
								? 'Saved revisions are read-only. Export or copy changes into the current file for review.'
								: source.source === 'simulator'
									? 'Saving creates a backup and changes the simulator file only. It does not apply or restart the printer.'
									: applicationEnabled
										? 'Reviewed application writes this file and restarts Klipper. A previous-file snapshot is kept for recovery. Syntax and hardware compatibility are not guaranteed.'
										: 'Drafts stay in this tab until exported. No live file is written.'}
						</p>
					</details>
					<div class="toolbar">
						<button disabled={busy || !mounted || !!revisionOf || !dirty} onclick={discard}
							>Discard draft…</button
						><button
							class="primary"
							disabled={busy || !!revisionOf || !dirty || invalidField || conflict}
							onclick={review}>Review changes…</button
						>
					</div>
				</footer>
				<div class="mode-switch" role="group" aria-label="Editor mode">
					<button
						disabled={!mounted || !fields.length || !!revisionOf}
						aria-pressed={mode === 'guided'}
						onclick={() => (modes[source.path] = 'guided')}>Explained settings</button
					><button
						disabled={!mounted}
						aria-pressed={mode === 'raw'}
						onclick={() => (modes[source.path] = 'raw')}>Raw source</button
					>
				</div>
				{#if macros.length}<section class="macro-index" aria-label="Macros in this file">
						<h3>Macros in this file</h3>
						<p class="muted small">Edit definitions in source; selecting one does not run it.</p>
						{#each macros as macro}<button
								disabled={!mounted}
								onclick={() => {
									modes[source.path] = 'raw';
									jump = { line: macro.line, token: Date.now() };
								}}>Edit {macro.name} · line {macro.line}</button
							>{/each}
					</section>{/if}
				{#if includes.length}<div class="includes">
						<strong>Includes</strong
						>{#each includes as include}{#if files.some((file) => file.path === include)}<a
									href={`?file=${encodeURIComponent(include)}`}
									data-sveltekit-reset="false">{include} →</a
								>{:else}<code>{include}</code>{/if}{/each}<span class="muted small"
							>Resolved by Klipper in source order; wildcard matches and overrides are not expanded
							here.</span
						>
					</div>{/if}
				<details class="upstream-reference">
					<summary>Klipper reference · Find or add a setting</summary><ConfigurationReference
						text={current.text}
						path={source.path}
						disabled={busy || !mounted || !!revisionOf}
						onAdd={addFromReference}
						onCatalogue={(value) => (reference = value)}
					/>
				</details>
				{#if mode === 'guided'}
					<p class="muted">
						Configuration values, not live readings. Review changes before applying them.
					</p>
					{#if fields.length > 100}<p class="muted">
							Showing up to 100 matching settings. Search to narrow the list, or open raw source for
							the complete file.
						</p>{/if}
					<label class="setting-search"
						>Find a setting<input
							type="search"
							bind:value={settingQuery}
							placeholder="Name, section or setting key"
						/></label
					>
					{#if !visibleFields.length}<p role="status">
							No settings match your search. Raw source contains the complete file.
						</p>{/if}
					{#if fields.length}<div class="fields">
							{#each fieldSections as section}<section
									class="setting-group"
									aria-label={`${section} settings`}
								>
									<h3>[{section}]</h3>
									{#each visibleFields.filter((field) => field.section === section) as field (field.start)}<div
											class="setting"
										>
											<div>
												<label for={`setting-${field.start}`}>{field.hint.title}</label>
												<details class="setting-help">
													<summary>About this setting</summary>
													<p>{field.hint.help}</p>
													{#if reference}{@const upstream = reference.options.find(
															(option) =>
																option.key === field.key &&
																referenceMatches(option, field.section, referenceContext) &&
																option.description
														)}{#if upstream}<details class="field-reference">
																<summary>Upstream explanation</summary>
																<p>{upstream.description}</p>
																<a href={referenceUrl(upstream)} target="_blank" rel="noreferrer"
																	>Read the full section ↗</a
																>
															</details>{/if}{/if}
													<div class="source-ref">
														<code>[{field.section}] {field.key}</code><span>Line {field.line}</span
														><a
															href={`https://www.klipper3d.org/Config_Reference.html#${field.hint.section}`}
															target="_blank"
															rel="noreferrer">Klipper reference ↗</a
														>
													</div>
												</details>
											</div>
											<div>
												{#if field.editable}<input
														id={`setting-${field.start}`}
														type="number"
														step="any"
														min={field.hint.min}
														max={field.hint.max}
														value={field.value}
														disabled={busy || !mounted}
														onfocus={() => {
															editingBaseline = {
																path: source.path,
																id: field.id,
																text: current!.text
															};
														}}
														oninput={(event) => {
															invalidField = !editField(field.id, event.currentTarget.value);
														}}
														onchange={(event) => finishField(field.id, event.currentTarget)}
													/>{:else}<code>{field.value || 'Multiline value'}</code>
													<p class="muted small">
														Ambiguous, repeated, or multiline: edit in raw source.
													</p>{/if}
											</div>
										</div>{/each}
								</section>{/each}
						</div>{/if}
				{:else}<p class="raw-label">
						Editable source <span class="muted small"
							>Comments, macros, and formatting are preserved.</span
						>
					</p>
					{#key source.path}<ConfigurationSource
							value={parts.editable}
							{jump}
							{reference}
							path={source.path}
							disabled={busy || !mounted || !!revisionOf}
							onChange={rawEdit}
						/>{/key}{/if}
				{#if parts.generated || parts.warning}<section class="generated">
						<h3>Calibration-generated settings</h3>
						<p>
							{parts.warning ??
								'Klipper owns this block. It stays byte-for-byte unchanged when editing the file above.'}
						</p>
						{#if parts.generated}<details>
								<summary>Inspect protected block</summary>
								<pre>{parts.generated}</pre>
							</details>{/if}<a
							href="https://www.klipper3d.org/G-Codes.html#save_config"
							target="_blank"
							rel="noreferrer">About SAVE_CONFIG ↗</a
						>
					</section>{/if}
			</section>
			{#if source.source === 'simulator'}<section class="panel backups">
					<h2>Previous versions</h2>
					<p class="muted">
						Each save keeps the previous source. The latest 20 backups per file are retained.
					</p>
					{#if current.base.backups.length}<label
							>Backup<select bind:value={selectedBackup}
								><option value="">Choose a previous version</option
								>{#each current.base.backups as backup}<option value={backup.id}
										>{new Date(backup.createdAt).toLocaleString()} · {backup.actor}</option
									>{/each}</select
							></label
						><button
							disabled={busy || !mounted || !!revisionOf || !selectedBackup}
							onclick={loadBackup}>Load backup into draft…</button
						>{:else}<p>No backups yet. The first save will create one.</p>{/if}
				</section>{/if}
		</div>{/if}
</div>
<Dialog.Root bind:open={reviewOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content config-review"
			><Dialog.Title class="dialog-title">Review {reviewed?.request.path}</Dialog.Title
			><Dialog.Description
				>{source.source === 'simulator'
					? 'Save the simulator file with an automatic backup. Running printer settings and hardware are unchanged.'
					: applicationEnabled
						? 'Apply this one file and restart Klipper. A recovery snapshot is stored first. Includes and Jinja syntax are not fully validated. Unsaved runtime calibration may be lost. Other clients must not edit or operate the printer during this operation.'
						: 'Review this draft before exporting. No live printer file will be written.'}</Dialog.Description
			>{#if difference}<p class="muted">
					Change begins at line {difference.line}. Whitespace and line endings are part of the
					source.
				</p>
				<div class="diff">
					<div>
						<h3>Previous source</h3>
						<pre aria-label="Previous source">{difference.removed.join('\n')}</pre>
					</div>
					<div>
						<h3>Your draft</h3>
						<pre aria-label="Proposed source">{difference.added.join('\n')}</pre>
					</div>
				</div>
				{#if difference.truncated}<p class="notice">
						This preview is limited to 200 lines per side. Close this review and inspect/export the
						full raw draft before saving.
					</p>{/if}{/if}<label class="confirmation"
				><input type="checkbox" bind:checked={confirmed} />I reviewed the source changes.</label
			>
			{#if applicationEnabled && source.source === 'moonraker'}<label class="confirmation"
					><input type="checkbox" bind:checked={restartConfirmed} />Restart Klipper after saving.
					Unsaved runtime calibration may be lost.</label
				>{/if}
			<div class="toolbar">
				<Dialog.Close class="button secondary" disabled={busy || !mounted}
					>Keep editing</Dialog.Close
				><button
					class="primary"
					disabled={busy ||
						!!revisionOf ||
						!confirmed ||
						(applicationEnabled && source.source === 'moonraker' && !restartConfirmed)}
					onclick={source.source === 'simulator'
						? save
						: applicationEnabled
							? apply
							: exportReviewed}
					>{busy
						? 'Saving…'
						: source.source === 'simulator'
							? 'Save simulator file'
							: applicationEnabled
								? 'Apply and restart Klipper'
								: 'Export reviewed draft'}</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
	.upstream-reference {
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		padding: 0.2rem 1rem;
		margin: 1rem 0;
	}
	.field-reference {
		font-size: 0.8rem;
	}
	.workspace {
		display: grid;
		grid-template-columns: 230px minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}
	.panel {
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 1rem;
		padding: 1.5rem;
		min-width: 0;
	}
	.file-browser-toggle {
		display: none;
	}
	.file-list {
		position: sticky;
		top: 1rem;
	}
	.file-list h2 {
		font-family: inherit;
		font-size: 1rem;
	}
	.file-search {
		display: grid;
		gap: 0.4rem;
		font-size: 0.8rem;
	}
	.file-search input {
		width: 100%;
		box-sizing: border-box;
		min-width: 0;
		padding: 0.6rem;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
	}
	.file-group h3,
	.file-list summary {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0.7rem 0 0.35rem;
		overflow-wrap: anywhere;
	}
	.macro-index button {
		margin: 0.3rem 0.4rem 0.3rem 0;
	}
	.file-list nav {
		max-height: 55dvh;
		overflow: auto;
		overscroll-behavior: contain;
		display: grid;
		gap: 0.35rem;
		margin: 1rem -0.5rem;
	}
	.file-list a {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		overflow-wrap: anywhere;
		text-decoration: none;
		padding: 0.7rem 0.5rem;
		border-radius: 0.5rem;
		color: var(--text);
	}
	.file-list a[aria-current='page'] {
		background: var(--highlight);
		color: var(--highlight-text);
		font-weight: 600;
	}
	.draft-dot {
		color: var(--accent);
	}
	.editor-column {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
	}
	.file-heading {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
		align-items: start;
	}
	h2 {
		margin: 0.3rem 0 0.75rem;
		overflow-wrap: anywhere;
	}
	p {
		line-height: 1.6;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: 0.8rem;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	button {
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
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
	.mode-switch {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 0.65rem;
		margin: 1rem 0;
		padding: 0.2rem;
		gap: 0.2rem;
	}
	.mode-switch button {
		border: 0;
	}
	.mode-switch button[aria-pressed='true'] {
		background: var(--highlight);
		color: var(--highlight-text);
	}
	.setting-search {
		display: grid;
		gap: 0.4rem;
		margin-block: 1rem;
	}
	.setting-search input {
		width: 100%;
		min-width: 0;
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--canvas);
		color: var(--text);
		font: inherit;
	}
	.setting-group h3 {
		color: var(--muted);
		font-family: monospace;
		font-size: 0.9rem;
		margin: 1.2rem 0 0;
	}
	.setting-help summary {
		margin: 0.4rem 0;
	}
	.fields {
		display: grid;
	}
	.setting {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 130px;
		gap: 1.5rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--border);
	}
	.setting input {
		scroll-margin-top: 14rem;
	}
	.setting label {
		font-weight: 600;
	}
	.setting p {
		font-size: 0.85rem;
		color: var(--muted);
		margin: 0.5rem 0;
	}
	.source-ref {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.75rem;
		color: var(--muted);
	}
	input[type='number'],
	select {
		width: 100%;
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--canvas);
		color: var(--text);
		font: inherit;
	}
	.raw-label {
		display: grid;
		gap: 0.4rem;
		margin: 0.5rem 0 0.8rem;
		font-weight: 600;
	}
	.includes {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
		padding: 0.8rem 0;
	}
	.includes > span {
		flex-basis: 100%;
	}
	a {
		color: var(--accent);
	}
	.notice,
	.generated,
	.conflict {
		padding: 1rem;
		background: var(--canvas);
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		margin: 1rem 0;
	}
	.generated h3,
	.conflict h3 {
		margin: 0.2rem 0;
		font-family: 'Newsreader Variable', Georgia, serif;
		font-size: 1.4rem;
	}
	.generated p,
	.conflict p {
		font-size: 0.85rem;
	}
	.error {
		color: var(--danger);
	}
	pre {
		font:
			0.8rem/1.6 ui-monospace,
			SFMono-Regular,
			Consolas,
			monospace;
		white-space: pre;
		overflow: auto;
		max-height: 300px;
		padding: 0.75rem;
		background: var(--canvas);
		border-radius: 0.4rem;
	}
	summary {
		cursor: pointer;
		font-size: 0.85rem;
		margin: 0.8rem 0;
	}
	footer {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--surface);
		border-block: 1px solid var(--border);
		padding: 0.65rem 0;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
		align-items: center;
		margin-top: 1rem;
	}
	footer p {
		max-width: 45ch;
	}
	.backups label {
		display: grid;
		gap: 0.5rem;
		max-width: 450px;
		margin-bottom: 1rem;
	}
	.confirmation {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		margin: 1.5rem 0;
	}
	.confirmation input {
		accent-color: var(--accent);
	}
	.diff {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.diff > div {
		min-width: 0;
	}
	.diff h3 {
		font-size: 0.85rem;
	}
	.diff > div:first-child pre {
		border-left: 3px solid var(--danger);
	}
	.diff > div:last-child pre {
		border-left: 3px solid var(--accent);
	}
	:global(.config-review) {
		width: min(900px, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow: auto;
	}
	@media (max-width: 1050px) {
		.file-browser-toggle {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			justify-content: space-between;
			width: 100%;
			text-align: left;
			padding: 0.4rem 0;
			border: 0;
			background: transparent;
		}
		.file-browser-toggle span:first-child {
			color: var(--muted);
			font-size: 0.8rem;
			overflow-wrap: anywhere;
			min-width: 0;
		}
		.file-browser-collapsed,
		.file-list h2 {
			display: none;
		}
		.workspace {
			grid-template-columns: 1fr;
		}
		.file-list {
			position: static;
		}
		.file-search {
			display: grid;
			gap: 0.4rem;
			font-size: 0.8rem;
		}
		.file-search input {
			width: 100%;
			box-sizing: border-box;
			min-width: 0;
			padding: 0.6rem;
			color: var(--text);
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 0.5rem;
		}
		.file-group h3,
		.file-list summary {
			font-size: 0.8rem;
			color: var(--muted);
			margin: 0.7rem 0 0.35rem;
			overflow-wrap: anywhere;
		}
		.macro-index button {
			margin: 0.3rem 0.4rem 0.3rem 0;
		}
		.file-list nav {
			max-height: 55dvh;
			overflow: auto;
			overscroll-behavior: contain;
			display: flex;
			flex-wrap: wrap;
			margin: 0.5rem 0;
		}
		.file-list a {
			padding: 0.5rem;
		}
		.file-list .small {
			margin-bottom: 0;
		}
	}
	@media (max-width: 600px) {
		.panel {
			padding: 1rem;
		}
		.setting {
			grid-template-columns: 1fr;
			gap: 0.7rem;
		}
		.setting input {
			max-width: 180px;
		}
		.diff {
			grid-template-columns: 1fr;
		}
		.toolbar button {
			flex: 1 1 auto;
		}
		.file-heading .toolbar {
			width: 100%;
		}
		.mode-switch {
			display: flex;
		}
		.mode-switch button {
			flex: 1;
		}
		.file-heading h2 {
			font-size: 1.6rem;
		}
	}
</style>
