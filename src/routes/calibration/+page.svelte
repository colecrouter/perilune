<script lang="ts">
	import { onMount } from 'svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import { resolve } from '$app/paths';
	import LiveZCalibration from '#lib/components/LiveZCalibration.svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import CancelDialog from '#lib/components/CancelDialog.svelte';
	import {
		calibrationActive,
		calibrationReason,
		calibrationSteps,
		type CalibrationCommand
	} from '#lib/domain/calibration.js';
	import { allAxesHomed } from '#lib/domain/motion.js';
	import { heaterTargetsOff } from '#lib/domain/temperature.js';
	import type { PrinterCommand } from '#lib/domain/printer.js';
	import { submitTrackedPrintAction } from '#lib/client/submit-print-action.js';
	import { getPrinter, submitAction } from '../printer.remote.js';
	let { data } = $props();
	const dashboard = getPrinter();
	const initial = $derived(data.initial!.printer);
	const updates = liveConnection(() => dashboard.connected);
	onMount(() => {
		void Promise.resolve(dashboard).catch(() => {});
	});
	const snapshot = $derived(dashboard.current ?? initial);
	const calibration = $derived(snapshot.calibration);
	const session = $derived(calibration.session);
	const active = $derived(calibrationActive(calibration));
	const canOperate = $derived(data.user?.role === 'owner' || data.user?.role === 'operator');
	const owns = $derived(session?.ownerId === data.user?.id);
	const pending = $derived(
		snapshot.actions.some((action) => ['queued', 'sending'].includes(action.status))
	);
	let submitting = $state(false);
	let failure = $state('');
	let lastAction = $state('');
	let clean = $state(false);
	let clear = $state(false);
	let understand = $state(false);
	let step = $state<(typeof calibrationSteps)[number]>(0.01);
	let observation = $state<'high' | 'even' | 'low' | null>(null);
	let saveOpen = $state(false);
	let cancelOpen = $state(false);
	let stopOpen = $state(false);
	let reviewed = $state<{
		sessionId: string;
		version: number;
		candidate: number;
		force?: boolean;
	}>();
	let stopJob = $state<{ filename: string; runId: string | null }>();
	const sessionId = $derived(session?.id);
	$effect(() => {
		void sessionId;
		observation = null;
	});
	const ready = $derived(
		updates.available && snapshot.connection === 'connected' && snapshot.klippy === 'ready'
	);
	const homed = $derived(updates.available && allAxesHomed(snapshot));
	const heatersOff = $derived(ready && heaterTargetsOff(snapshot));
	const idle = $derived(ready && ['standby', 'complete', 'cancelled'].includes(snapshot.job.state));
	const currentJob = $derived(['printing', 'paused'].includes(snapshot.job.state));
	const startReason = $derived(
		!canOperate
			? 'An operator account is required.'
			: !updates.available
				? 'Reconnecting to Perilune. Your checklist is retained.'
				: calibrationReason(snapshot)
	);
	const blocked = $derived(
		!canOperate ||
			!owns ||
			!updates.available ||
			snapshot.connection !== 'connected' ||
			snapshot.klippy !== 'ready' ||
			snapshot.storage !== 'healthy' ||
			snapshot.motion.busy !== false ||
			pending ||
			submitting
	);
	const candidate = $derived(session?.candidate ?? calibration.appliedOffset);
	const change = $derived(candidate - (session?.baseline ?? calibration.appliedOffset));
	const offsetLabel = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(3)} mm`;
	const receipt = $derived(snapshot.actions.find((action) => action.id === lastAction));
	const samples = [
		{
			id: 'high' as const,
			title: 'Too high',
			description: 'Round strands with gaps. Move closer in small steps.'
		},
		{
			id: 'even' as const,
			title: 'Even and joined',
			description: 'Flat, joined lines without raised ridges. This is the example to aim for.'
		},
		{
			id: 'low' as const,
			title: 'Too low',
			description: 'Rough ridges or scraped material. Raise the nozzle.'
		}
	];
	async function send(command: PrinterCommand) {
		submitting = true;
		failure = '';
		try {
			const result = await submitTrackedPrintAction(
				data.user?.id ?? '',
				{ id: crypto.randomUUID(), command },
				submitAction
			);
			lastAction = result.id;
		} catch (cause) {
			failure = isHttpError(cause)
				? cause.body.message
				: cause instanceof Error
					? cause.message
					: 'The action could not be submitted.';
			throw cause;
		} finally {
			submitting = false;
		}
	}
	function sessionCommand(
		command:
			| Omit<Extract<CalibrationCommand, { type: 'calibrationAdjust' }>, 'sessionId' | 'version'>
			| Omit<Extract<CalibrationCommand, { type: 'calibrationStage' }>, 'sessionId' | 'version'>
			| Omit<Extract<CalibrationCommand, { type: 'calibrationFinish' }>, 'sessionId' | 'version'>
	) {
		if (!session) return;
		void send({ ...command, sessionId: session.id, version: session.version }).catch(() => {});
	}
	function review(force = false) {
		if (!session) return;
		reviewed = {
			sessionId: session.id,
			version: session.version,
			candidate: session.candidate,
			force
		};
		failure = '';
	}
	async function save() {
		if (!reviewed) return;
		try {
			await send({
				type: 'calibrationFinish',
				sessionId: reviewed.sessionId,
				version: reviewed.version,
				outcome: 'save'
			});
			saveOpen = false;
		} catch {
			/* failure stays visible in dialog */
		}
	}
	async function cancel() {
		if (!reviewed) return;
		try {
			await send({
				type: 'calibrationCancel',
				sessionId: reviewed.sessionId,
				version: reviewed.version,
				confirmed: true,
				force: reviewed.force
			});
			cancelOpen = false;
		} catch {
			/* failure stays visible in dialog */
		}
	}
</script>

<svelte:head><title>Calibration · Perilune</title></svelte:head>
<AppShell {snapshot} active="Calibration"
	>{#if snapshot.mode === 'moonraker'}<div class="calibration-page page-frame serif">
			<h1>Z calibration</h1>
			<LiveZCalibration
				{snapshot}
				userId={data.user?.id ?? ''}
				role={data.user?.role ?? 'viewer'}
				connected={updates.available}
				onSubmit={(command, id) => submitAction({ id, command })}
			/>
		</div>{:else}
		<div class="calibration-page page-frame serif">
			<header>
				<div>
					<h1>Z-offset workshop</h1>
					<p class="muted">
						Understand the gap, make small changes, and know exactly what you’ve kept.
					</p>
				</div>
				<span class="mode-badge"
					>{snapshot.mode === 'simulator'
						? 'Simulator workshop'
						: 'Live calibration unavailable'}</span
				>
			</header>
			<p class="scope-note">
				This workshop changes simulator offsets only. The diagrams are illustrations; no probe, test
				print, motor movement or printer configuration write is performed.
			</p>
			{#if !updates.available || snapshot.connection !== 'connected'}<p
					role="status"
					class="notice"
				>
					Reconnecting. Your checklist and adjustment choices are retained.
				</p>{/if}
			{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
			{#if receipt}<p role="status" class="action-status">
					{receipt.label}: {receipt.status}{receipt.message ? ` — ${receipt.message}` : ''}
				</p>{/if}
			{#if snapshot.mode === 'simulator'}
				<div class="offset-summary panel">
					<div>
						<span>Applied in this process</span><strong
							>{offsetLabel(calibration.appliedOffset)}</strong
						>
					</div>
					<div>
						<span>Saved simulator default</span><strong
							>{offsetLabel(calibration.savedOffset)}</strong
						>
					</div>
					<p class="muted">
						Positive adjustment increases clearance. Negative adjustment brings the nozzle closer.
						This is a relative adjustment, not a measured probe offset.
					</p>
				</div>{/if}
			{#if active && session}
				<div class="session-notice">
					<span
						>{owns
							? 'You own this session.'
							: `${session.ownerName} owns this session. You can follow along.`}</span
					><small>Expires after 10 minutes without a step change or adjustment.</small>
				</div>
				<ol class="workflow" aria-label="Calibration steps">
					<li
						class:current={session.stage === 'adjusting'}
						aria-current={session.stage === 'adjusting' ? 'step' : undefined}
					>
						1 · Adjust
					</li>
					<li
						class:current={session.stage === 'first-layer'}
						aria-current={session.stage === 'first-layer' ? 'step' : undefined}
					>
						2 · First layer
					</li>
					<li
						class:current={session.stage === 'review'}
						aria-current={session.stage === 'review' ? 'step' : undefined}
					>
						3 · Finish
					</li>
				</ol>
				{#if session.stage === 'adjusting'}
					<section class="panel adjustment">
						<div>
							<h2>Find your clearance</h2>
							<p class="muted">
								Try the controls to see how a relative offset changes clearance. On a real printer,
								paper-test probing and print-time fine tuning are separate operations.
							</p>
							<fieldset class="increments" disabled={blocked}>
								<legend>Adjustment per click (mm)</legend>
								<div role="group" aria-label="Fine adjustment">
									{#each calibrationSteps as value}<button
											class:chosen={step === value}
											aria-label={`${value} mm`}
											aria-pressed={step === value}
											onclick={() => (step = value)}>{value}</button
										>{/each}
								</div>
							</fieldset>
							<div class="adjust-buttons">
								<button
									class="button secondary"
									disabled={blocked || candidate + step > 2}
									onclick={() => sessionCommand({ type: 'calibrationAdjust', delta: step })}
									>Z + · farther</button
								><button
									class="button primary"
									disabled={blocked || candidate - step < -2}
									onclick={() =>
										sessionCommand({
											type: 'calibrationAdjust',
											delta: -step as Extract<
												CalibrationCommand,
												{ type: 'calibrationAdjust' }
											>['delta']
										})}>Z − · closer</button
								>
							</div>
							<p class="fine-hint">
								Range: −2 to +2 mm in the simulator. Each click waits for acknowledgement.
							</p>
						</div>
						<div class="clearance">
							<svg
								viewBox="0 0 320 210"
								role="img"
								aria-label="Illustration of relative nozzle clearance"
								><defs
									><pattern
										id="calibration-stars"
										width="47"
										height="43"
										patternUnits="userSpaceOnUse"
										><circle cx="19" cy="14" r=".7" fill="currentColor" opacity=".18" /></pattern
									></defs
								><rect width="320" height="210" rx="16" fill="url(#calibration-stars)" /><g
									style={`transform: translateY(${Math.max(-28, Math.min(28, -change * 80))}px)`}
									><path d="M123 36h74v45l-25 31h-24l-25-31z" fill="var(--accent)" /><path
										d="M148 112h24l-12 13z"
										fill="var(--text)"
									/></g
								><path
									d="M38 167h244"
									stroke="var(--muted)"
									stroke-width="6"
									stroke-linecap="round"
								/><path d="M38 181h244" stroke="var(--border)" stroke-width="2" /><text
									x="160"
									y="202"
									text-anchor="middle">Build surface · schematic</text
								></svg
							><strong>{offsetLabel(candidate)}</strong><span>Candidate offset</span><small
								>{offsetLabel(change)} from this session’s starting value</small
							>
						</div>
						<div class="step-actions">
							<button
								class="button primary"
								disabled={blocked}
								onclick={() => {
									observation = null;
									sessionCommand({ type: 'calibrationStage', stage: 'first-layer' });
								}}>Explore first-layer examples →</button
							>
						</div>
					</section>
				{:else if session.stage === 'first-layer'}
					<section class="panel">
						<h2>Read the first layer</h2>
						<p class="muted">
							These examples explain the effect of clearance. Choose the example you would aim for
							on a real test print. Perilune has not printed or inspected a layer.
						</p>
						<div class="layer-samples">
							{#each samples as sample}<button
									class="sample"
									class:chosen={observation === sample.id}
									disabled={blocked}
									aria-pressed={observation === sample.id}
									onclick={() => (observation = sample.id)}
									><svg viewBox="0 0 220 130" aria-hidden="true"
										><rect
											width="220"
											height="130"
											rx="12"
											fill="var(--surface)"
										/>{#each Array.from({ length: 6 }) as _, index}<rect
												x="20"
												y={18 + index * (sample.id === 'high' ? 18 : 15)}
												width="180"
												height={sample.id === 'high' ? 10 : 16}
												rx={sample.id === 'high' ? 5 : 2}
												fill={sample.id === 'low' && index % 2 ? 'var(--muted)' : 'var(--accent)'}
											/>{/each}</svg
									><strong>{sample.title}</strong><span>{sample.description}</span></button
								>{/each}
						</div>
						{#if observation && observation !== 'even'}<p class="notice">
								{observation === 'high'
									? 'Gaps suggest the nozzle is too far away. Return to adjustment and try Z −.'
									: 'Ridges suggest the nozzle is too close. Return to adjustment and try Z +.'}
							</p>{/if}
						<div class="step-actions">
							<button
								class="button secondary"
								disabled={blocked}
								onclick={() => sessionCommand({ type: 'calibrationStage', stage: 'adjusting' })}
								>← Back to adjustment</button
							><button
								class="button primary"
								disabled={blocked || observation !== 'even'}
								onclick={() =>
									sessionCommand({ type: 'calibrationStage', stage: 'review', confirmed: true })}
								>Review this offset →</button
							>
						</div>
					</section>
				{:else}<section class="panel finish">
						<h2>Keep this adjustment?</h2>
						<div class="candidate-value">{offsetLabel(candidate)}</div>
						<p class="muted">
							Your starting value was {offsetLabel(session.baseline)}. Choose whether this candidate
							lasts until restart or becomes the saved simulator default. Neither choice writes your
							printer’s configuration.
						</p>
						<div class="finish-options">
							<div>
								<h3>Try it temporarily</h3>
								<p>Apply it in this simulator process. Restarting restores the saved default.</p>
								<button
									class="button secondary"
									disabled={blocked}
									onclick={() => sessionCommand({ type: 'calibrationFinish', outcome: 'apply' })}
									>Apply until restart</button
								>
							</div>
							<div>
								<h3>Keep it for next time</h3>
								<p>Save it to Perilune’s database as the simulator default.</p>
								<button
									class="button primary"
									disabled={blocked}
									onclick={() => {
										review();
										saveOpen = true;
									}}>Save simulator default…</button
								>
							</div>
						</div>
						<button
							class="button secondary"
							disabled={blocked}
							onclick={() => sessionCommand({ type: 'calibrationStage', stage: 'adjusting' })}
							>← Adjust again</button
						>
					</section>{/if}
				<section class="session-exit">
					<p class="muted">
						Cancel discards this session’s candidate and releases the printer controls.
					</p>
					{#if owns}<button
							class="button danger"
							disabled={blocked}
							onclick={() => {
								review();
								cancelOpen = true;
							}}>Cancel calibration…</button
						>{:else if data.user?.role === 'owner'}<button
							class="button secondary"
							disabled={pending ||
								submitting ||
								!updates.available ||
								snapshot.connection !== 'connected'}
							onclick={() => {
								review(true);
								cancelOpen = true;
							}}>End abandoned session…</button
						>{/if}
				</section>
			{:else}
				{#if session}<section class="panel outcome" role="status">
						<h2>
							{session.stage === 'saved'
								? 'Saved for your next session.'
								: session.stage === 'applied'
									? 'Applied until restart.'
									: session.stage === 'cancelled'
										? 'Adjustments discarded.'
										: 'Session interrupted.'}
						</h2>
						<p>{session.message}</p>
					</section>{/if}
				<section class="panel preparation">
					<h2>Prepare your workspace</h2>
					<p class="muted">
						A real paper test needs a clean nozzle and bed at room temperature. Here, the checklist
						rehearses that preparation while the simulator is idle and homed.
					</p>
					<ul class="prerequisites" aria-label="Automatic printer checks">
						<li>
							<label
								><input type="checkbox" checked={ready} disabled /> Printer connected and ready</label
							>
						</li>
						<li>
							<label
								><input type="checkbox" checked={idle} disabled /> No running or paused job</label
							>
						</li>
						<li>
							<label><input type="checkbox" checked={homed} disabled /> All axes homed</label>
						</li>
						<li>
							<label
								><input type="checkbox" checked={heatersOff} disabled /> Heater targets off for this exercise</label
							>
						</li>
					</ul>
					<p class="fine-hint">
						Printer conditions check automatically. Cleanliness and physical clearance still need
						your review.
					</p>
					<div class="preparation-controls">
						{#if currentJob}<button
								class="button secondary"
								disabled={!canOperate ||
									pending ||
									submitting ||
									snapshot.mode !== 'simulator' ||
									!updates.available}
								onclick={() => {
									stopJob = { filename: snapshot.job.filename, runId: snapshot.job.runId ?? null };
									stopOpen = true;
								}}>Stop current simulation…</button
							>{/if}<button
							class="button secondary"
							disabled={!canOperate ||
								currentJob ||
								homed ||
								pending ||
								submitting ||
								snapshot.mode !== 'simulator' ||
								!updates.available}
							title={homed ? 'All axes are already homed.' : undefined}
							onclick={() => void send({ type: 'home', axes: 'all' }).catch(() => {})}
							>Home all axes</button
						><button
							class="button secondary"
							disabled={!canOperate ||
								pending ||
								submitting ||
								snapshot.mode !== 'simulator' ||
								!updates.available ||
								heatersOff}
							title={heatersOff ? 'Both heater targets are already off.' : undefined}
							onclick={() => void send({ type: 'cooldown' }).catch(() => {})}
							>Turn heater targets off</button
						>
					</div>
					{#if homed || heatersOff}<p class="fine-hint">
							{homed ? 'All axes are already homed.' : ''}
							{heatersOff ? 'Heater targets are already off; surfaces may still be cooling.' : ''}
						</p>{/if}
					<div class="checklist">
						<label
							><input type="checkbox" bind:checked={clean} disabled={!canOperate} /> I’ve reviewed clean-nozzle
							and clean-bed preparation.</label
						><label
							><input type="checkbox" bind:checked={clear} disabled={!canOperate} /> I’ve reviewed physical
							bed clearance.</label
						><label
							><input type="checkbox" bind:checked={understand} disabled={!canOperate} /> I understand
							this is a simulator exercise, not a probe measurement.</label
						>
					</div>
					{#if startReason}<p class="notice">{startReason}</p>{/if}<button
						class="button primary begin"
						disabled={Boolean(startReason) || !clean || !clear || !understand || submitting}
						onclick={() =>
							void send({
								type: 'calibrationBegin',
								sessionId: crypto.randomUUID(),
								expectedOffset: calibration.appliedOffset,
								confirmed: true
							}).catch(() => {})}>Begin simulator calibration</button
					>
				</section>
			{/if}
			<aside class="panel resources">
				<h2>Understand the next step</h2>
				<p>
					Probe calibration establishes a reference. First-layer tuning adjusts printing clearance.
					They need different validation before Perilune can safely drive them on your printer.
				</p>
				<a
					href="https://www.klipper3d.org/Bed_Level.html#the-paper-test"
					target="_blank"
					rel="noreferrer">Klipper: the paper test ↗</a
				><a href="https://www.klipper3d.org/Probe_Calibrate.html" target="_blank" rel="noreferrer"
					>Klipper: calibrating a probe ↗</a
				><a href={resolve('/controls')}>Open motion controls →</a>
			</aside>
		</div>
	{/if}</AppShell
>
<CancelDialog
	available={ready}
	bind:open={stopOpen}
	bedTarget={snapshot.heaters.bed.target}
	nozzleTarget={snapshot.heaters.nozzle.target}
	onConfirm={(coolBed, coolNozzle) =>
		send({ type: 'cancel', coolBed, coolNozzle, expectedJob: stopJob })}
/>
<Dialog.Root bind:open={saveOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title">Save simulator default?</Dialog.Title><Dialog.Description
				class="muted"
				>Save {offsetLabel(reviewed?.candidate ?? candidate)} in Perilune’s database. It will survive
				backend restarts. Your printer configuration will not change.</Dialog.Description
			>{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep reviewing</Dialog.Close
				><button class="button primary" disabled={submitting || pending} onclick={() => void save()}
					>Save simulator default</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root bind:open={cancelOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title"
				>{reviewed?.force ? 'End this operator’s session?' : 'Cancel calibration?'}</Dialog.Title
			><Dialog.Description class="muted"
				>Discard the candidate adjustment and restore the previous applied offset. No heater targets
				or saved defaults change.</Dialog.Description
			>{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep calibrating</Dialog.Close
				><button
					class="button danger"
					disabled={submitting || pending}
					onclick={() => void cancel()}>Discard adjustments</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
	.calibration-page {
		--page-content-max: 75rem;
		display: grid;
		gap: 1.2rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	header p {
		max-width: 600px;
	}
	.mode-badge {
		color: var(--accent);
		background: var(--accent-soft);
		padding: 0.6rem 0.8rem;
		border-radius: 9px;
		font-size: 0.8rem;
	}
	.scope-note,
	.fine-hint {
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.6;
	}
	.notice {
		padding: 0.8rem;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface);
		font-size: 0.85rem;
	}
	.action-status {
		font-size: 0.85rem;
		color: var(--accent);
	}
	.offset-summary {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.offset-summary span,
	.offset-summary strong {
		display: block;
	}
	.offset-summary span {
		font-size: 0.8rem;
		color: var(--muted);
		margin-bottom: 0.5rem;
	}
	.offset-summary strong {
		font-size: 1.4rem;
		font-variant-numeric: tabular-nums;
	}
	.offset-summary p {
		grid-column: 1 / -1;
		font-size: 0.8rem;
		margin: 0;
	}
	.session-notice {
		display: flex;
		justify-content: space-between;
		gap: 0.7rem;
		flex-wrap: wrap;
		font-size: 0.9rem;
	}
	.session-notice small {
		color: var(--muted);
	}
	.workflow {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		list-style: none;
		gap: 0.5rem;
		padding: 0;
		margin: 0;
	}
	.workflow li {
		padding: 0.7rem;
		border-bottom: 2px solid var(--border);
		font-size: 0.85rem;
		color: var(--muted);
	}
	.workflow .current {
		color: var(--accent);
		border-color: var(--accent);
		background: var(--accent-soft);
		border-radius: 7px 7px 0 0;
	}
	h2 {
		font-size: 1.8rem;
		margin: 0.5rem 0 0.8rem;
	}
	h3 {
		font-size: 1.3rem;
		margin: 0 0 0.6rem;
	}
	.adjustment {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		gap: 1.5rem;
	}
	.increments {
		border: 0;
		padding: 0;
		margin: 1.4rem 0;
	}
	legend {
		font-size: 0.85rem;
		margin-bottom: 0.6rem;
	}
	.increments div {
		display: flex;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.increments button {
		flex: 1;
		border: 0;
		background: transparent;
		color: var(--muted);
		padding: 0.65rem 0.3rem;
		border-radius: 7px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.increments .chosen {
		background: var(--accent);
		color: white;
	}
	.adjust-buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}
	.clearance {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--surface);
		border-radius: 15px;
	}
	.clearance svg {
		max-width: 320px;
		width: 100%;
		color: var(--muted);
	}
	svg text {
		font-size: 11px;
		fill: var(--muted);
	}
	.clearance strong {
		font-size: 2rem;
		font-variant-numeric: tabular-nums;
	}
	.clearance span {
		color: var(--accent);
		font-size: 0.85rem;
	}
	.clearance small {
		color: var(--muted);
		text-align: center;
		font-size: 0.75rem;
	}
	.step-actions {
		grid-column: 1 / -1;
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.8rem;
		margin-top: 1rem;
	}
	.layer-samples {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		margin: 1.5rem 0;
	}
	.sample {
		display: grid;
		gap: 0.6rem;
		border: 1px solid var(--border);
		padding: 0.8rem;
		border-radius: 12px;
		text-align: left;
		color: var(--text);
		background: transparent;
		cursor: pointer;
	}
	.sample svg {
		width: 100%;
	}
	.sample strong {
		font-size: 1rem;
	}
	.sample span {
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.6;
	}
	.sample.chosen {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
		background: var(--accent-soft);
	}
	.candidate-value {
		font-size: 2.5rem;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
		margin: 1.2rem 0;
	}
	.finish-options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin: 1.5rem 0;
	}
	.finish-options > div {
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.finish-options p {
		color: var(--muted);
		font-size: 0.85rem;
		line-height: 1.6;
	}
	.finish-options button {
		width: 100%;
		margin-top: 0.5rem;
	}
	.session-exit {
		border-top: 1px solid var(--border);
		padding-top: 1.3rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.session-exit p {
		font-size: 0.85rem;
		max-width: 530px;
	}
	.outcome {
		border-color: var(--accent);
	}
	.outcome p {
		font-size: 0.9rem;
		line-height: 1.6;
	}
	.prerequisites label {
		display: flex;
		gap: 0.7rem;
		align-items: start;
	}
	.prerequisites {
		list-style: none;
		display: grid;
		gap: 0.65rem;
		padding: 0;
		font-size: 0.9rem;
	}
	.preparation-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin: 1.5rem 0;
	}
	.checklist {
		display: grid;
		gap: 0.9rem;
		margin: 1.5rem 0;
	}
	.checklist label {
		display: flex;
		align-items: start;
		gap: 0.7rem;
		font-size: 0.9rem;
		line-height: 1.6;
	}
	input[type='checkbox'] {
		margin-top: 0.3rem;
		accent-color: var(--accent);
		flex-shrink: 0;
	}
	.begin {
		width: 100%;
	}
	.resources p {
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.6;
		max-width: 700px;
	}
	.resources a {
		display: inline-block;
		color: var(--accent);
		margin: 0.5rem 1.5rem 0.5rem 0;
		font-size: 0.85rem;
	}
	@media (max-width: 700px) {
		header {
			flex-direction: column;
			align-items: start;
		}
		.adjustment,
		.layer-samples,
		.finish-options {
			grid-template-columns: 1fr;
		}
		.workflow li {
			font-size: 0.75rem;
			padding: 0.6rem 0.4rem;
		}
		.offset-summary strong {
			font-size: 1.1rem;
		}
		.step-actions button,
		.session-exit button {
			width: 100%;
		}
		.adjust-buttons .button {
			font-size: 0.8rem;
			padding: 0.75rem 0.5rem;
		}
	}
</style>
