<script lang="ts">
	import { liveQuery } from '#lib/client/live-query.js';
	import { onMount, untrack } from 'svelte';
	import FilamentChangeWorkflow from '#lib/components/FilamentChangeWorkflow.svelte';
	import {
		filamentChangeActive,
		defaultFilamentChangeSettings
	} from '#lib/domain/filament-change.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import { getPrinter } from '../printer.remote.js';
	import { getFilamentSetup, saveFilamentSetup } from './filament.remote.js';
	let { data } = $props();
	const printer = liveQuery(getPrinter);
	const initialPrinter = await printer;
	const snapshot = $derived(printer.current ?? initialPrinter);
	const allowed = $derived(data.user?.role === 'owner' || data.user?.role === 'operator');
	const query = untrack(() => (allowed ? getFilamentSetup() : null));
	const initial = query
		? await query
		: {
				settings: defaultFilamentChangeSettings,
				capability: null,
				ready: false,
				mode: initialPrinter.mode,
				reason: null
			};
	const setup = $derived(query?.current ?? initial);
	let mode = $state<'disabled' | 'slicer'>(
		initial.settings.mode === 'disabled' ? 'disabled' : 'slicer'
	);
	let changeMacro = $state(initial.settings.changeMacro);
	let resumeMacro = $state(initial.settings.resumeMacro);
	let reviewedTuple = $state('');
	const reviewTuple = $derived(JSON.stringify([mode, resumeMacro, setup.capability?.fingerprint]));
	const reviewed = $derived(reviewedTuple === reviewTuple);
	let revision = $state(initial.settings.revision);
	let pending = $state(false);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	let message = $state('');
	const owner = $derived(data.user?.role === 'owner');
	const setupLocked = $derived(
		filamentChangeActive(snapshot.filamentChange) ||
			snapshot.actions.some((a) => a.status === 'queued' || a.status === 'sending')
	);
	async function save() {
		if (!query || !hydrated) return;
		pending = true;
		message = '';
		try {
			await saveFilamentSetup({
				revision,
				mode,
				assisted: undefined,
				changeMacro,
				resumeMacro,
				reviewed,
				fingerprint: setup.capability?.fingerprint ?? ''
			});
			revision = (await query).settings.revision;
			message =
				'Setup plan saved. Guided changes use this plan; physical compatibility still needs an attended test.';
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Setup could not be saved.';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head><title>Filament changes · Perilune</title></svelte:head>
<AppShell {snapshot} active="Controls"
	><div class="page-frame serif filament-page">
		<header>
			<h1>Filament changes</h1>
			<p>Let your slicer handle the change. Feed filament manually only when needed.</p>
		</header>
		{#if !allowed}<section class="panel">
				<h2>Operator access required</h2>
				<p>An operator or owner can review private printer macros and filament-change setup.</p>
			</section>{:else}
			<FilamentChangeWorkflow
				{snapshot}
				connected={printer.connected}
				settingsRevision={setup.settings.revision}
				settings={setup.settings}
				setupReason={setup.reason}
				userId={data.user!.id}
				role={data.user!.role}
			/>
			<section class="panel" id="filament-setup">
				<h2>Filament-change setup</h2>
				<p>
					The slicer pauses and handles loading and purging after Resume. Perilune adds no change
					macro, parking or purge sequence.
				</p>
				{#if !['disabled', 'slicer'].includes(setup.settings.mode)}<p>
						Replace the older guided plan with slicer-managed changes after ending any active
						guidance.
					</p>{/if}
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<label for="filament-method">Method</label>
					<select id="filament-method" bind:value={mode} disabled={!hydrated || !owner || pending}>
						<option value="disabled">Not configured</option><option value="slicer"
							>Slicer-managed changes</option
						>
					</select>
					{#if mode === 'slicer'}
						<label for="resume-macro">Resume command</label>
						<select
							id="resume-macro"
							bind:value={resumeMacro}
							disabled={!hydrated || !owner || pending}
						>
							<option value="RESUME">RESUME</option>
							{#each (setup.capability?.macros ?? []).filter((name) => name !== 'RESUME') as name}<option
									value={name}>{name}</option
								>{/each}
						</select>
						<label class="check"
							><input
								type="checkbox"
								checked={reviewed}
								onchange={(event) => {
									reviewedTuple = event.currentTarget.checked ? reviewTuple : '';
								}}
								disabled={!hydrated || !owner || pending}
							/>My slicer handles loading and purging. I reviewed that this Resume command returns
							to printing in one call, without an extra filament-change sequence.</label
						>
					{/if}
					{#if owner}<button
							class="button primary"
							disabled={!hydrated ||
								setupLocked ||
								pending ||
								(mode !== 'disabled' && (!reviewed || !setup.ready))}>Save plan</button
						>{:else}<p>An owner can review this setup.</p>{/if}
				</form>
				{#if message}<p role="status">{message}</p>{/if}
				{#if setup.reason}<p>{setup.reason}</p>{/if}
				<details>
					<summary>Printer compatibility</summary
					>{#each setup.capability?.findings ?? [] as finding}<p>{finding}</p>{/each}<button
						class="button secondary"
						disabled={!hydrated || pending}
						onclick={() => query?.refresh()}>Refresh discovery</button
					>
				</details>
			</section>
		{/if}
	</div></AppShell
>

<style>
	.filament-page {
		--page-content-max: 65rem;
		display: grid;
		gap: 1.5rem;
	}
	header p,
	section p {
		color: var(--muted);
		line-height: 1.6;
	}
	.panel {
		padding: 1.5rem;
		display: grid;
		gap: 0.85rem;
	}
	form {
		display: grid;
		gap: 0.8rem;
		max-width: 36rem;
	}
	select {
		width: 100%;
		min-height: 44px;
		padding: 0.65rem 0.8rem;
		font: inherit;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 0.55rem;
	}
	h2,
	section p {
		margin: 0;
	}
	.check {
		display: flex;
		align-items: start;
		gap: 0.7rem;
		line-height: 1.5;
	}
	.check input {
		margin-top: 0.3rem;
	}
	form button {
		justify-self: start;
	}
</style>
