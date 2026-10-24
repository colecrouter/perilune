<script lang="ts">
	import FeedbackRegion from './FeedbackRegion.svelte';
	import { refreshPendingSettings } from '#lib/client/pending-settings.js';
	import { tick } from 'svelte';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { pidActive, pidReason } from '#lib/domain/pid.js';
	import ActionForm from './ActionForm.svelte';
	import PendingSettingsDialog from './PendingSettingsDialog.svelte';
	let reviewOpen = $state(false);
	let reviewMode = $state<'save' | 'discard'>('save');
	import SafetyButton from './SafetyButton.svelte';
	let {
		snapshot,
		connected = true,
		role = 'viewer'
	}: { snapshot: PrinterSnapshot; connected?: boolean; role?: string } = $props();
	let heater = $state<'nozzle' | 'bed'>('nozzle');
	let targets = $state({ nozzle: 200, bed: 60 });
	let attended = $state(false);
	let resultPanel: HTMLElement | undefined = $state();
	let followResult = $state(false);
	$effect(() => {
		if (followResult && run && ['running', 'staged'].includes(run.stage) && resultPanel) {
			followResult = false;
			void tick().then(() => resultPanel?.focus({ preventScroll: false }));
		}
	});
	const live = $derived(snapshot.mode === 'moonraker');
	const run = $derived(snapshot.pid?.run);
	const running = $derived(pidActive(snapshot.pid));
	const reason = $derived(pidReason(snapshot, heater, targets[heater], role === 'owner'));
	let acknowledgedChoice = '';
	$effect(() => {
		const choice = `${heater}:${targets[heater]}:${role}`;
		if (choice !== acknowledgedChoice) {
			attended = false;
			acknowledgedChoice = choice;
		}
	});
</script>

{#if !live}<p class="notice">
		Simulator · The example result is not measured and must not be applied to a real heater.
	</p>{/if}
{#if run}<section
		bind:this={resultPanel}
		tabindex="-1"
		class="panel"
		aria-label="PID calibration result"
		aria-live="polite"
	>
		<p class="eyebrow">{run.heater === 'bed' ? 'Bed' : 'Nozzle'} · {run.target}°C</p>
		<h2>
			{run.stage === 'running'
				? 'Tuning the heater'
				: run.stage === 'staged'
					? live
						? 'Review the proposed PID settings'
						: 'Example result'
					: run.stage === 'resolved'
						? 'Pending settings changed'
						: 'Calibration needs attention'}
		</h2>
		<p>{run.message}</p>
		{#if run.parameters}<dl class="gains">
				<div>
					<dt>Kp</dt>
					<dd>{run.parameters.kp}</dd>
				</div>
				<div>
					<dt>Ki</dt>
					<dd>{run.parameters.ki}</dd>
				</div>
				<div>
					<dt>Kd</dt>
					<dd>{run.parameters.kd}</dd>
				</div>
			</dl>{/if}
		{#if run.stage === 'running'}<p class="muted">Leaving this page does not stop the test.</p>{/if}
		{#if run.stage === 'running' && live && role === 'owner'}
			<p>
				Stopping shuts down Klipper and all heaters. Motors may release. Inspect the printer before
				using the guided firmware recovery.
			</p>
			<SafetyButton {snapshot} label="Stop calibration" />
		{:else if run.stage === 'staged' && live}
			{#if role === 'owner'}<div class="result-actions">
					<button
						class="button primary"
						onclick={() => {
							reviewMode = 'save';
							refreshPendingSettings();
							reviewOpen = true;
						}}>Save…</button
					>
					<button
						class="button secondary"
						onclick={() => {
							reviewMode = 'discard';
							refreshPendingSettings();
							reviewOpen = true;
						}}>Discard…</button
					>
				</div>{/if}
			<p class="muted">
				These gains are unsaved. Review all pending changes before saving or discarding; either
				action restarts Klipper.
			</p>
		{:else if run.stage === 'interrupted'}<a href="/activity#recovery">Review printer recovery →</a
			>{/if}
		<a class="details-link" href={`/actions/${run.id}`}>Calibration details</a>
	</section>{/if}

{#if live && role === 'owner'}<PendingSettingsDialog
		onComplete={() => window.location.assign('/calibration/pid')}
		bind:open={reviewOpen}
		mode={reviewMode}
	/>{/if}

{#if !live || !run || !['running', 'staged'].includes(run.stage)}
	<section class="panel preparation" aria-label="Prepare PID calibration">
		<h2>Prepare a heater test</h2>
		<p>
			Choose your usual printing temperature. Stay at the printer throughout the heating cycles.
		</p>
		<details class="guidance">
			<summary>Preparation and safety</summary>
			<ul>
				<li>Clear the bed and use the usual cooling arrangement.</li>
				<li>Finish any print, turn off both heater targets, and resolve pending settings first.</li>
				<li>The test takes several minutes. Leaving this page does not stop it.</li>
			</ul>
			{#if live}<p>
					Keep other printer clients idle. Stop calibration shuts down all heaters and may release
					motors; ordinary queued commands may not stop a tune.
				</p>{/if}
		</details>
		<ActionForm
			fields={{ intent: 'pidCalibrate' }}
			receipts={snapshot.actions}
			onAccepted={() => {
				attended = false;
				followResult = true;
			}}
		>
			{#snippet children({ pending, uncertain })}
				<div class="preparation-fields">
					<label
						>Heater<select name="heater" bind:value={heater} disabled={pending || running}
							><option value="nozzle">Nozzle</option><option value="bed">Bed</option></select
						></label
					>
					<label
						>Calibration target (°C)<input
							type="number"
							name="target"
							min="30"
							max={Math.min(300, (snapshot.pidTelemetry?.limits[heater]?.max ?? 310) - 10)}
							step="1"
							required
							bind:value={() => targets[heater], (value) => (targets[heater] = value ?? NaN)}
							disabled={pending || running}
						/></label
					>
				</div>
				<label class="confirmation"
					><input
						type="checkbox"
						name="confirmed"
						value="true"
						bind:checked={attended}
						required
						disabled={pending || running || role !== 'owner'}
					/> I am attending the printer, have checked the heater and cooling arrangement, and am ready
					for this temperature test.</label
				>
				<button
					class="button primary"
					disabled={!connected || !!reason || pending || uncertain || !attended}
					>{live ? 'Start heater calibration' : 'Run simulator calibration'}</button
				>
			{/snippet}
		</ActionForm>
		<FeedbackRegion active={!!reason} label="PID readiness"
			>{#if reason}<p class="readiness" role="status">{reason}</p>{/if}</FeedbackRegion
		>
		<p>
			<a href="/">Printer status and cooldown controls →</a> ·
			<a
				href="https://www.klipper3d.org/Config_checks.html#calibrate-pid-settings"
				target="_blank"
				rel="noreferrer">Klipper PID guide ↗</a
			>
		</p>
	</section>
{/if}

<style>
	.guidance {
		margin-block: 0.75rem;
		color: var(--muted);
		line-height: 1.5;
	}
	.guidance summary {
		cursor: pointer;
	}
	.guidance ul {
		padding-left: 1.2rem;
	}
	.result-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.panel {
		padding: clamp(1rem, 3vw, 1.75rem);
		margin-bottom: 1.25rem;
	}
	h2 {
		margin: 0.2rem 0 0.8rem;
	}
	p {
		line-height: 1.6;
	}
	a {
		color: var(--accent);
	}
	.preparation-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 1.2rem 0;
	}
	.preparation-fields label {
		display: grid;
		gap: 0.5rem;
		flex: 1 1 12rem;
		min-width: 0;
	}
	select,
	input[type='number'] {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}
	.confirmation {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		line-height: 1.5;
		margin: 1rem 0;
	}
	.confirmation input {
		margin-top: 0.3rem;
	}
	.readiness,
	.notice {
		border-left: 3px solid var(--border-strong);
		padding: 0.6rem 1rem;
		line-height: 1.6;
	}
	.muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.gains {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
	}
	dt {
		color: var(--muted);
		font-size: 0.85rem;
	}
	dd {
		margin: 0.4rem 0;
		font-size: 1.3rem;
	}
	.details-link {
		display: block;
		margin-top: 1rem;
		font-size: 0.85rem;
	}
</style>
