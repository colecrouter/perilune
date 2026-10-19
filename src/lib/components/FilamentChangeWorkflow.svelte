<script lang="ts">
	import { onMount } from 'svelte';
	import {
		filamentChangeActive,
		type FilamentChangeCommand,
		type FilamentChangeSettings
	} from '#lib/domain/filament-change.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { submitAction } from '../../routes/printer.remote.js';
	let {
		snapshot,
		settingsRevision,
		settings,
		setupReason,
		userId,
		role
	}: {
		snapshot: PrinterSnapshot;
		settingsRevision: number;
		settings: FilamentChangeSettings;
		setupReason: string | null;
		userId: string;
		role: string;
	} = $props();
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	const session = $derived(snapshot.filamentChange);
	const active = $derived(filamentChangeActive(session));
	const owned = $derived(session?.ownerId === userId);
	const identity = $derived({ filename: snapshot.job.filename, runId: snapshot.job.runId ?? '' });
	const context = $derived(
		JSON.stringify([
			identity,
			session?.id,
			session?.step,
			session?.stage,
			session?.ownerId,
			settingsRevision
		])
	);
	let confirmation = $state('');
	const confirmed = $derived(confirmation === context);
	let submitting = $state(false);
	let lastId = $state('');
	let error = $state('');
	const receipt = $derived(snapshot.actions.find((a) => a.id === lastId));
	const pending = $derived(
		submitting || snapshot.actions.some((a) => a.status === 'queued' || a.status === 'sending')
	);
	const blocked = $derived(
		!hydrated ||
			pending ||
			!confirmed ||
			snapshot.connection !== 'connected' ||
			!snapshot.telemetryReady ||
			snapshot.klippy !== 'ready' ||
			!snapshot.liveControls ||
			snapshot.storage !== 'healthy' ||
			!!snapshot.liveRecovery ||
			!!snapshot.safety?.halted
	);
	async function send(
		type: FilamentChangeCommand['type'],
		operation?: 'unload' | 'load' | 'purge'
	) {
		if (
			type === 'filamentChangeEnd' && role === 'owner'
				? !hydrated || pending || !confirmed || snapshot.storage !== 'healthy'
				: blocked
		)
			return;
		submitting = true;
		error = '';
		lastId = crypto.randomUUID();
		const common = { expectedJob: identity, confirmed };
		const command: FilamentChangeCommand =
			type === 'filamentChangeBegin'
				? { type, ...common, settingsRevision, adoptPaused: snapshot.job.state === 'paused' }
				: operation
					? {
							type: 'filamentChangeFeed',
							operation,
							...common,
							sessionId: session!.id,
							expectedStep: session!.step
						}
					: {
							type: type as Exclude<
								FilamentChangeCommand['type'],
								'filamentChangeBegin' | 'filamentChangeFeed'
							>,
							...common,
							sessionId: session!.id,
							expectedStep: session!.step
						};
		try {
			await submitAction({ id: lastId, command });
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: 'The action could not be submitted. Inspect its receipt before trying again.';
		} finally {
			submitting = false;
		}
	}
</script>

<section class="panel workflow" aria-label="Guided filament change">
	<h2>{active ? 'Current filament change' : 'Change filament'}</h2>
	{#if snapshot.mode === 'simulator'}<p>
			Guided filament changes are available when Perilune is connected to a printer. You can review
			setup below.
		</p>
	{:else}
		{#if active && session}<p role="status">{session.message}</p>
			<p class="muted">
				{owned ? 'You are handling this change.' : 'Another operator is handling this change.'} Leaving
				this page keeps the shared session. Ending guidance does not stop or resume the printer or verify
				its position.
			</p>
		{:else if session?.stage === 'finished'}<p role="status">{session.message}</p>{/if}
		<p>
			Nozzle: {snapshot.heaters.nozzle.current ?? '—'}°C · target {snapshot.heaters.nozzle.target ??
				'—'}°C. <a href="/">Adjust heater targets</a>
		</p>
		{#if snapshot.liveRecovery}<p>
				Review the uncertain command in <a href="/controls">Controls</a> before continuing. No command
				will be replayed.
			</p>{/if}
		{#if settings.mode === 'assisted' && !snapshot.liveFilament}<p>
				Assisted parking and extrusion are disabled on this server. An owner must enable live
				filament controls before using these steps.
			</p>{/if}
		{#if active || snapshot.job.state === 'printing' || snapshot.job.state === 'paused'}
			<p>
				{active && settings.mode === 'assisted'
					? 'Inspect parking and the filament path before each step. A custom PAUSE may already have retracted filament. Remove purged material before Resume. If heaters timed out, explicitly reheat first. Do not home into a paused print.'
					: active
						? 'Follow your printer macro’s unload/load instructions. Check the filament path and remove purged material before resuming. If heaters timed out, explicitly reheat first. Do not home into a paused print.'
						: snapshot.job.state === 'paused'
							? 'This print is already paused. Starting guidance sends no change macro; a pause alone does not identify an M600 event.'
							: settings.mode === 'assisted'
								? 'Pause the print first. No assisted parking or extrusion is sent until you choose the next step.'
								: 'The configured change macro may move or unload the printer. Stay with it. Perilune will not add a second park or unload.'}
			</p>
			<label class="check"
				><input
					type="checkbox"
					checked={confirmed}
					disabled={!hydrated || pending}
					onchange={(event) => {
						confirmation = event.currentTarget.checked ? context : '';
					}}
				/>I am at the printer and have inspected its current state and this step.</label
			>
			<div class="buttons">
				{#if !active}<button
						class="button primary"
						disabled={blocked || !!setupReason}
						onclick={() => send('filamentChangeBegin')}
						>{snapshot.job.state === 'paused'
							? 'Guide this paused print'
							: settings.mode === 'assisted'
								? 'Pause for filament change'
								: 'Run change macro'}</button
					>
				{:else if session}
					{#if owned && session.stage === 'paused'}
						{#if session.assisted && !session.assisted.parked}{#if settings.assisted?.parking === 'perilune'}<p
								>
									Inspect the current position and clearance. An interrupted park may already have
									lifted Z. Choosing Lift Z and park XY sends a new relative lift from the current
									position; it does not replay or finish an earlier move.
								</p>{/if}
							<button
								class="button primary"
								disabled={blocked || !snapshot.liveFilament}
								onclick={() => send('filamentChangePark')}
								>{settings.assisted?.parking === 'printer'
									? 'Nozzle is clear; verify parking'
									: 'Lift Z and park XY'}</button
							>{/if}
						{#if session.assisted?.parked && settings.assisted}
							{#each ['unload', 'load', 'purge'] as const as operation}<button
									class="button secondary"
									disabled={blocked || !snapshot.liveFilament}
									onclick={() => send('filamentChangeFeed', operation)}
									>{operation === 'unload' ? 'Unload' : operation === 'load' ? 'Load' : 'Purge'}
									{settings.assisted[operation]} mm · {settings.assisted.speed} mm/s</button
								>{/each}
						{/if}
						<button
							class="button primary"
							disabled={blocked || (!!session.assisted && !session.assisted.parked)}
							onclick={() => send('filamentChangeResume')}>Resume print</button
						>{/if}
					{#if role === 'owner' && (session.stage === 'review' || !owned)}<button
							class="button secondary"
							disabled={blocked}
							onclick={() => send('filamentChangeRecover')}>Review &amp; take over</button
						>{/if}
					{#if owned || role === 'owner'}<button
							class="button secondary"
							disabled={role === 'owner'
								? !hydrated || pending || !confirmed || snapshot.storage !== 'healthy'
								: blocked}
							onclick={() => send('filamentChangeEnd')}>End guidance; leave printer as is</button
						>{/if}
				{/if}
			</div>
		{:else}<p>Start a print to use guided changes. Setup can be reviewed below.</p>{/if}
		{#if !active && setupReason}<p>{setupReason}</p>{/if}
		{#if pending}<p role="status">Waiting for the printer and fresh verification…</p>{/if}
		{#if error}<p role="alert">{error}</p>{/if}
		{#if receipt && ['failed', 'unknown'].includes(receipt.status)}<p role="alert">
				{receipt.message}
			</p>{/if}
	{/if}
</section>

<style>
	.workflow {
		padding: 1.5rem;
		display: grid;
		gap: 0.85rem;
	}
	h2,
	p {
		margin: 0;
	}
	p,
	.check {
		line-height: 1.6;
	}
	.muted {
		color: var(--muted);
	}
	.check {
		display: flex;
		align-items: start;
		gap: 0.7rem;
	}
	input {
		margin-top: 0.4rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
	}
	@media (max-width: 600px) {
		.buttons button {
			width: 100%;
		}
	}
</style>
