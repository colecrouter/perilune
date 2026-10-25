<script lang="ts">
	import { liveQuery } from '#lib/client/live-query.js';
	import { onMount, untrack } from 'svelte';
	import FilamentChangeWorkflow from '#lib/components/FilamentChangeWorkflow.svelte';
	import {
		filamentChangeActive,
		defaultFilamentChangeSettings,
		defaultAssistedFilamentProfile
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
	let mode = $state(initial.settings.mode);
	let changeMacro = $state(initial.settings.changeMacro);
	let resumeMacro = $state(initial.settings.resumeMacro);
	let assisted = $state({ ...defaultAssistedFilamentProfile, ...initial.settings.assisted });
	let reviewedTuple = $state('');
	const reviewTuple = $derived(
		JSON.stringify([mode, changeMacro, resumeMacro, assisted, setup.capability?.fingerprint])
	);
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
				assisted: mode === 'assisted' ? assisted : undefined,
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
			<p>Use a reviewed printer macro or explicit assisted steps for a paused print.</p>
		</header>
		{#if !allowed}<section class="panel">
				<h2>Operator access required</h2>
				<p>An operator or owner can review private printer macros and filament-change setup.</p>
			</section>{:else}
			<FilamentChangeWorkflow
				{snapshot}
				settingsRevision={setup.settings.revision}
				settings={setup.settings}
				setupReason={setup.reason}
				userId={data.user!.id}
				role={data.user!.role}
			/>
			<section class="panel">
				<h2>Printer compatibility</h2>
				{#if setup.capability}
					{#each setup.capability.findings as finding}<p>{finding}</p>{/each}
				{:else}<p>
						{setup.mode === 'simulator'
							? 'The simulator has no physical macro configuration. Connect a printer to review compatibility.'
							: 'Waiting for fresh capability discovery. Your saved setup is retained.'}
					</p>{/if}
				<p>
					Detection does not certify parking clearance, unload distance, heater behavior or safe
					resumption.
				</p>
				<button
					class="button secondary"
					disabled={!hydrated || pending}
					onclick={() => query?.refresh()}>Refresh discovery</button
				>
			</section>
			<section class="panel">
				<h2>Change method</h2>
				<p>Choose how to pause and handle filament. Configuration changes invalidate review.</p>
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<label for="filament-method">Method</label><select
						id="filament-method"
						bind:value={mode}
						disabled={!hydrated || !owner || pending}
					>
						<option value="disabled">Not enabled</option><option value="printer"
							>Use my printer’s macros</option
						>
						<option value="assisted">Perilune-assisted steps</option></select
					>
					{#if mode === 'printer'}
						<label for="change-macro">Change macro</label><select
							id="change-macro"
							bind:value={changeMacro}
							disabled={!hydrated || !owner || pending}
						>
							{#if !setup.capability?.macros.includes(changeMacro)}<option value={changeMacro}
									>{changeMacro} · unavailable</option
								>{/if}
							{#each setup.capability?.macros ?? [] as name}<option value={name}>{name}</option
								>{/each}
						</select>
					{/if}
					{#if mode === 'assisted'}
						<p>
							Pause first, then choose one bounded step at a time. A custom PAUSE may already
							retract or park. Resume uses the printer’s saved pause position.
						</p>
						<label for="parking">Parking</label><select
							id="parking"
							bind:value={assisted.parking}
							disabled={!hydrated || !owner || pending}
							><option value="printer">Printer parks; I inspect nozzle clearance</option><option
								value="perilune">Perilune lifts Z then parks XY</option
							></select
						>
						{#if assisted.parking === 'perilune'}<p>
								Available with native PAUSE and no active bed mesh. Review clearance over the print;
								travel limits alone do not prove a clear path.
							</p>{/if}
						{#each ['parkX', 'parkY', 'zLift', 'unload', 'load', 'purge', 'speed'] as const as field}
							{#if assisted.parking === 'perilune' || !['parkX', 'parkY', 'zLift'].includes(field)}
								<label for={'assist-' + field}
									>{{
										parkX: 'Park X (mm)',
										parkY: 'Park Y (mm)',
										zLift: 'Z lift (mm)',
										unload: 'Unload per step (mm)',
										load: 'Load per step (mm)',
										purge: 'Purge per step (mm)',
										speed: 'Extrusion speed (mm/s)'
									}[field]}</label
								>
								<input
									id={'assist-' + field}
									type="number"
									step="0.1"
									bind:value={assisted[field]}
									disabled={!hydrated || !owner || pending}
									required
								/>
							{/if}{/each}
						<p>
							Single-extruder Cartesian/CoreXY only. Each extrusion step is limited to 50 mm and 90
							seconds, and to the printer’s configured limits. Longer paths require a new inspected
							step.
						</p>
						{#if setup.capability?.assisted?.reason}<p>{setup.capability.assisted.reason}</p>{/if}
					{/if}
					{#if mode !== 'disabled'}
						<label for="resume-macro">Resume command</label><select
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
							/>I reviewed this plan’s parking, extrusion distances, speed and resume behavior. I
							will attend the first test.</label
						>
					{/if}
					{#if owner}<button
							class="button primary"
							disabled={!hydrated ||
								setupLocked ||
								pending ||
								(mode !== 'disabled' && (!reviewed || !setup.ready))}
							>{pending ? 'Saving…' : 'Save plan'}</button
						>{:else}<p>An owner can change this setup.</p>{/if}
				</form>
				{#if message}<p role="status">{message}</p>{/if}
				{#if setup.reason && filamentChangeActive(snapshot.filamentChange)}<p>
						{setup.reason}
					</p>{/if}
			</section>
			<section class="panel">
				<h2>No suitable macro?</h2>
				<p>
					Perilune-assisted changes need explicit parking and extrusion settings. This setup does
					not install or replace M600. For a planned slicer change without M600, emit PAUSE and open
					guidance after the print pauses. A pause does not identify whether a runout or filament
					change caused it.
				</p>
				<p>
					Review Klipper’s <a
						href="https://github.com/Klipper3d/klipper/blob/master/config/sample-macros.cfg"
						target="_blank"
						rel="noreferrer">example macros</a
					> for context. Examples require adaptation to your printer.
				</p>
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
	select,
	input[type='number'] {
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
	section > button {
		justify-self: start;
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
