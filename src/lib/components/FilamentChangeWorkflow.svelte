<script lang="ts">
	import ManualExtrusionControls from './ManualExtrusionControls.svelte';
	import { onMount } from 'svelte';
	import { isHttpError } from '@sveltejs/kit';
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
		role,
		connected = true,
		onSubmit = submitAction
	}: {
		snapshot: PrinterSnapshot;
		settingsRevision: number;
		settings: FilamentChangeSettings;
		setupReason: string | null;
		userId: string;
		role: string;
		connected?: boolean;
		onSubmit?: (request: { id: string; command: FilamentChangeCommand }) => Promise<unknown>;
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
			userId,
			session?.id,
			session?.generation,
			session?.stage === 'review',
			session?.ownerId,
			settingsRevision,
			settings.fingerprint
		])
	);
	let confirmation = $state('');
	let beginId = $state('');
	let beginScope = '';
	const scope = $derived(
		JSON.stringify([identity, settingsRevision, settings.fingerprint, userId])
	);
	let attendingUser: string | undefined;
	$effect(() => {
		if (attendingUser !== userId) {
			confirmation = '';
			beginId = '';
			beginScope = '';
			attendingUser = userId;
		}
	});
	$effect(() => {
		if (
			!connected ||
			snapshot.connection !== 'connected' ||
			!snapshot.telemetryReady ||
			snapshot.klippy !== 'ready' ||
			session?.stage === 'review'
		) {
			confirmation = '';
			beginId = '';
			beginScope = '';
		}
	});
	$effect(() => {
		if (
			beginId &&
			session?.id === beginId &&
			owned &&
			session.stage === 'paused' &&
			receipt?.status === 'completed' &&
			receipt.id === beginId &&
			beginScope === scope &&
			connected
		) {
			confirmation = context;
			beginId = '';
		}
	});
	const confirmed = $derived(confirmation === context);
	let submitting = $state(false);
	let uncertain = $state(false);
	let lastId = $state('');
	let error = $state('');
	const receipt = $derived(snapshot.actions.find((a) => a.id === lastId));
	$effect(() => {
		if (receipt) {
			uncertain = false;
			error = '';
		}
	});
	const pending = $derived(
		uncertain ||
			(active && session?.stage === 'waiting') ||
			submitting ||
			snapshot.actions.some((a) => a.status === 'queued' || a.status === 'sending')
	);
	const blocked = $derived(
		!hydrated ||
			!connected ||
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
		operation?: 'unload' | 'load' | 'purge',
		distance?: -25 | -10 | -5 | 5 | 10 | 25
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
		if (type === 'filamentChangeBegin') {
			beginId = lastId;
			beginScope = scope;
		}
		const common = { expectedJob: identity, confirmed };
		const command: FilamentChangeCommand =
			type === 'filamentChangeBegin'
				? { type, ...common, settingsRevision, adoptPaused: snapshot.job.state === 'paused' }
				: operation
					? {
							type: 'filamentChangeFeed',
							operation,
							distance,
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
			await onSubmit({ id: lastId, command });
		} catch (cause) {
			uncertain = !isHttpError(cause);
			error =
				cause instanceof Error
					? cause.message
					: 'The action could not be submitted. Inspect its receipt before trying again.';
		} finally {
			submitting = false;
		}
	}
</script>

<section
	class="panel workflow"
	aria-label="Filament change"
	data-filament-step={session?.step}
	data-filament-stage={session?.stage}
>
	<h2>{active ? 'Replace filament' : 'Filament change'}</h2>
	{#if snapshot.mode === 'simulator'}<p>Connect a printer to use filament changes.</p>
	{:else}
		<p>
			Nozzle: {snapshot.heaters.nozzle.current?.toFixed(0) ?? '—'}°C · target {snapshot.heaters
				.nozzle.target ?? '—'}°C. <a href="/">Heater controls</a>
		</p>
		{#if snapshot.liveRecovery}<p>
				Resolve the uncertain action in <a href="/controls">Controls</a> before continuing.
			</p>{/if}
		{#if active && session && !session.slicerManaged}
			<p>
				This is an older guidance session. End it before switching to slicer-managed changes. The
				printer will stay paused.
			</p>
		{:else if active && session?.stage === 'review'}<p role="alert">{session.message}</p>
		{:else if active || snapshot.job.state === 'paused'}
			<p>
				Replace the filament now. Insert the new filament into the extruder; use manual feeding only
				if needed. Your slicer handles loading and purging after Resume.
			</p>
		{:else if snapshot.job.state === 'printing'}<p>
				Wait for the slicer to pause at the filament change.
			</p>
		{:else}<p>Start a sliced print with a filament-change pause.</p>{/if}
		{#if (active || snapshot.job.state === 'paused') && (settings.mode === 'slicer' || active)}
			<label class="check"
				><input
					type="checkbox"
					checked={confirmed}
					disabled={!hydrated || pending}
					onchange={(event) => {
						confirmation = event.currentTarget.checked ? context : '';
					}}
				/>I am at the printer for this filament change.</label
			>
			{#if !active}<button
					class="button primary"
					disabled={blocked || !!setupReason}
					onclick={() => send('filamentChangeBegin')}>Begin filament change</button
				>
			{:else if session}
				{#if owned && ['paused', 'waiting'].includes(session.stage) && session.slicerManaged}
					<details>
						<summary>Manual extrusion (optional)</summary>
						{#if !snapshot.liveFilament}<p>Manual extrusion is not enabled on this server.</p>
						{:else if !session.assisted?.parked}<p>
								Confirm the nozzle is clear of the print and filament can feed freely.
							</p>
							<button
								class="button secondary"
								disabled={blocked}
								onclick={() => send('filamentChangePark')}
								>Nozzle is clear; enable manual controls</button
							>
						{:else}<ManualExtrusionControls
								disabled={blocked}
								onMove={(distance) =>
									send('filamentChangeFeed', distance < 0 ? 'unload' : 'load', distance)}
							/>{/if}
					</details>
					<button
						class="button primary"
						disabled={blocked}
						onclick={() => send('filamentChangeResume')}>Resume print</button
					>
				{/if}
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
						onclick={() => send('filamentChangeEnd')}>End guidance</button
					>{/if}
			{/if}
		{/if}
		{#if !active && (setupReason || settings.mode !== 'slicer')}<p>
				{setupReason ?? 'Choose slicer-managed changes in setup.'}
				<a href="#filament-setup">Review setup</a>
			</p>{/if}
		{#if error}<p role="alert">
				{error}
			</p>{:else if receipt && ['failed', 'unknown'].includes(receipt.status) && !(session?.stage === 'review' && session.message === receipt.message)}<p
				role="alert"
			>
				{receipt.message ?? 'The action did not complete. Review its receipt before continuing.'}
			</p>{/if}
		{#if lastId}<a href={'/actions/' + lastId}>Review action</a>{/if}
	{/if}
</section>

<style>
	.workflow {
		display: grid;
		gap: 1rem;
	}
	.workflow p,
	.workflow h2 {
		margin: 0;
	}
	.workflow .check {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.workflow details {
		padding-block: 0.5rem;
	}
	.workflow summary {
		cursor: pointer;
	}
</style>
