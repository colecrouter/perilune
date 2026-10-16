<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import type { PrinterSnapshot, PrinterCommand } from '#lib/domain/printer.js';
	import { safetyReason } from '#lib/domain/safety.js';
	import { calibrationSteps } from '#lib/domain/calibration.js';
	let {
		snapshot,
		userId,
		role,
		connected,
		onSubmit
	}: {
		snapshot: PrinterSnapshot;
		userId: string;
		role: string;
		connected: boolean;
		onSubmit: (command: PrinterCommand, id: string) => Promise<unknown>;
	} = $props();
	let uncertain = $state(false);
	let clean = $state(false),
		clear = $state(false),
		paper = $state(false),
		accepted = $state(false),
		step = $state<number>(0.01),
		submitting = $state(false),
		failure = $state(''),
		last = $state(''),
		abortOpen = $state(false);
	const session = $derived(snapshot.liveZ?.session),
		cap = $derived(snapshot.zProbe),
		owns = $derived(session?.ownerId === userId),
		operator = $derived(['owner', 'operator'].includes(role));
	const pending = $derived(
		submitting ||
			uncertain ||
			snapshot.actions.some((a) => ['queued', 'sending'].includes(a.status))
	);
	const reason = $derived(
		!operator
			? 'An operator account is required.'
			: !snapshot.liveZEnabled
				? 'Live Z calibration is disabled on this server.'
				: !connected ||
					  snapshot.connection !== 'connected' ||
					  snapshot.klippy !== 'ready' ||
					  !snapshot.telemetryReady
					? 'Wait for a fresh ready printer connection.'
					: safetyReason(snapshot.safety) ||
						snapshot.liveRecovery?.message ||
						(snapshot.storage !== 'healthy'
							? 'Action storage is recovering.'
							: snapshot.configurationBusy
								? 'Configuration recovery owns the printer.'
								: !cap?.method
									? 'A supported probe or physical Z endstop is required.'
									: !['standby', 'complete', 'cancelled'].includes(snapshot.job.state)
										? 'Stop the current job first.'
										: snapshot.motion.busy !== false
											? 'Wait for printer movement to finish.'
											: snapshot.heaters.nozzle.target !== 0 || snapshot.heaters.bed.target !== 0
												? 'Turn off both heater targets before the paper test.'
												: null)
	);
	const active = $derived(session?.stage === 'active' && cap?.active),
		abortable = $derived(!!session && cap?.active && (owns || role === 'owner'));
	const receipt = $derived(snapshot.actions.find((a) => a.id === last));
	$effect(() => {
		if (uncertain && receipt) {
			uncertain = false;
			failure = '';
		}
	});
	$effect(() => {
		void session?.id;
		void session?.version;
		void cap?.z;
		accepted = false;
	});
	async function send(command: PrinterCommand) {
		if (pending) return;
		submitting = true;
		last = command.type === 'zProbeBegin' ? command.run : crypto.randomUUID();
		failure = '';
		try {
			await onSubmit(command, last);
			return true;
		} catch (cause) {
			if (!isHttpError(cause) || ![400, 401, 403, 404, 409, 413, 422].includes(cause.status)) {
				uncertain = true;
				failure =
					'Submission is unconfirmed. Wait for its recorded receipt before sending another command. Nothing will be resent.';
			} else failure = cause.body.message;
			return false;
		} finally {
			submitting = false;
		}
	}
</script>

<section class="panel">
	<p class="eyebrow">Live Z calibration</p>
	<h2>
		{cap?.method === 'endstop' ? 'Find the Z endstop position' : 'Find the nozzle-to-bed gap'}
	</h2>
	<p>
		Klipper probes, then opens its manual paper-test helper. Adjust slowly until the paper has
		slight drag. Stay at the printer; a camera cannot judge the gap.
	</p>
	<p>
		<a href="https://www.klipper3d.org/Probe_Calibrate.html" target="_blank" rel="noreferrer"
			>Klipper’s calibration guide ↗</a
		>
	</p>
	{#if failure || receipt?.status === 'failed' || receipt?.status === 'unknown'}<p
			class="notice"
			role="alert"
		>
			{failure || receipt?.message}
		</p>{/if}
	{#if uncertain}<p role="alert">
			<a href={`/actions/${last}`}>Check unconfirmed submission receipt</a>
		</p>{/if}
	{#if reason}<p role="status" class="notice">{reason}</p>{/if}
	{#if !active && !cap?.active}
		{#if session?.stage === 'staged'}<h3>Accepted · waiting to save</h3>
			<p>
				Proposed setting: {session.candidate?.toFixed(3) ?? '—'} mm. Klipper has staged the result. It
				is not written to configuration or active after restart until you explicitly save it.
			</p>
			<a class="button secondary" href="/configuration">Review pending configuration</a>
		{:else}
			<div class="preparation">
				<p>
					1. Home all axes using <a href="/controls">printer controls</a>. Position the nozzle where
					both it and the probe fit inside travel bounds.
				</p>
				<p>
					2. Turn off heater targets. Clean the nozzle and clear the bed. The heater may still be
					hot while cooling.
				</p>
			</div>
			<label><input type="checkbox" bind:checked={clean} /> The nozzle and bed are clean</label>
			<label
				><input type="checkbox" bind:checked={clear} /> The bed is clear and I am watching the printer</label
			>
			<label
				><input type="checkbox" bind:checked={paper} /> I have paper ready and understand that adjustment
				moves Z</label
			>
			<button
				class="button primary"
				disabled={!!reason ||
					pending ||
					!clean ||
					!clear ||
					!paper ||
					!['x', 'y', 'z'].every((a) => snapshot.motion.homed.includes(a as 'x' | 'y' | 'z')) ||
					cap?.pending}
				onclick={() => send({ type: 'zProbeBegin', run: crypto.randomUUID(), confirmed: true })}
				>Begin paper test</button
			>
			{#if cap?.pending}<p class="notice">
					There are pending calibration changes. Review/save them before starting a fresh test.
				</p>{/if}
		{/if}
	{/if}
	{#if cap?.active}
		<p>Observed nozzle height <strong>{cap.z?.toFixed(3) ?? '—'} mm</strong></p>
		{#if session}<p>{session.ownerName} owns this session. {session.message ?? ''}</p>{:else}<p>
				A manual helper is active outside this session. Finish it using its original client before
				beginning here.
			</p>{/if}
		{#if active && owns}
			<fieldset>
				<legend>Fine adjustment (mm)</legend>
				<div class="segments">
					{#each calibrationSteps as value}<label class:selected={step === value}
							><input type="radio" name="live-z-step" bind:group={step} {value} />{value}</label
						>{/each}
				</div>
			</fieldset>
			<div class="movement">
				<button
					class="button secondary"
					disabled={!!reason || pending || cap.z === null}
					onclick={() =>
						send({
							type: 'zProbeAdjust',
							run: session!.id,
							version: session!.version,
							expectedZ: cap!.z!,
							delta: step as 0.005 | 0.01 | 0.05 | 0.1
						})}>Z +</button
				><button
					class="button secondary"
					disabled={!!reason || pending || cap.z === null}
					onclick={() =>
						send({
							type: 'zProbeAdjust',
							run: session!.id,
							version: session!.version,
							expectedZ: cap!.z!,
							delta: -step as -0.005 | -0.01 | -0.05 | -0.1
						})}>Z −</button
				>
			</div>
			<p class="muted">
				Z + raises the nozzle; Z − lowers it. Each command waits for acknowledgement and fresh
				position before another step.
			</p>
			<div class="accept">
				<label
					><input type="checkbox" bind:checked={accepted} /> I checked the paper drag in person and want
					to accept this height</label
				><button
					class="button primary"
					disabled={!!reason || pending || !accepted || cap.z === null}
					onclick={() =>
						send({
							type: 'zProbeAccept',
							run: session!.id,
							version: session!.version,
							expectedZ: cap!.z!,
							confirmed: true
						})}>Accept height · stage result</button
				>
			</div>
		{/if}
		{#if abortable}<Dialog.Root bind:open={abortOpen}
				><Dialog.Trigger class="button secondary" disabled={pending}
					>Abort paper test…</Dialog.Trigger
				><Dialog.Portal
					><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
						><Dialog.Title class="dialog-title">Abort the paper test?</Dialog.Title
						><Dialog.Description
							>Ends the current helper without accepting its height. No calibration setting will be
							saved.</Dialog.Description
						>
						<div class="movement">
							<Dialog.Close class="button secondary">Keep calibrating</Dialog.Close><button
								class="button danger"
								disabled={pending}
								onclick={async () => {
									if (
										await send({
											type: 'zProbeAbort',
											run: session!.id,
											version: session!.version,
											confirmed: true
										})
									)
										abortOpen = false;
								}}>Abort paper test</button
							>
						</div></Dialog.Content
					></Dialog.Portal
				></Dialog.Root
			>{/if}
	{/if}
	{#if receipt}<p role="status">{receipt.label}: {receipt.status}</p>{/if}
	{#if session?.stage === 'aborted' || session?.stage === 'interrupted'}<p
			role="status"
			class="notice"
		>
			{session.message}
		</p>{/if}
</section>

<style>
	.panel {
		padding: clamp(1rem, 3vw, 2rem);
		max-width: 52rem;
	}
	h2,
	h3 {
		margin: 0.5rem 0;
	}
	p {
		margin: 0.8rem 0;
		line-height: 1.6;
	}
	label {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		margin: 0.8rem 0;
	}
	button {
		min-height: 44px;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 1rem 0;
	}
	.segments {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.segments label {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.5rem 0.8rem;
		margin: 0;
		cursor: pointer;
	}
	.selected {
		background: var(--accent-soft);
	}
	.movement {
		display: flex;
		gap: 1rem;
		margin: 1rem 0;
	}
	.movement button {
		flex: 1;
	}
	.accept {
		margin: 1.5rem 0;
		padding: 1rem 0;
		border-top: 1px solid var(--border);
	}
	.notice {
		border-left: 3px solid var(--accent);
		padding: 0.5rem 1rem;
		background: var(--surface);
	}
	.muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
