<script lang="ts">
	import { temperatureReason } from '#lib/domain/temperature.js';
	import { isHttpError } from '@sveltejs/kit';
	import {
		calculateExtrusion,
		extrusionActive,
		extrusionReason,
		type ExtrusionProposal
	} from '#lib/domain/extrusion.js';
	import type { PrinterCommand, PrinterSnapshot } from '#lib/domain/printer.js';
	let {
		snapshot,
		connected,
		userId,
		role,
		onSubmit,
		onReviewProposal
	}: {
		snapshot: PrinterSnapshot;
		connected: boolean;
		userId: string;
		role: string;
		onSubmit: (command: PrinterCommand) => Promise<string>;
		onReviewProposal?: (proposal: ExtrusionProposal) => void;
	} = $props();
	let rotationDistance = $state<number | undefined>();
	let before = $state<number | undefined>(70);
	let after = $state<number | undefined>();
	let temperature = $state<number | undefined>(210);
	let loaded = $state(false);
	let clear = $state(false);
	let coolNozzle = $state(true);
	let submitting = $state(false);
	let failure = $state('');
	let lastAction = $state('');
	let manualResult = $state<ExtrusionProposal | null>(null);
	const live = $derived(snapshot.mode === 'moonraker');
	const interactive = $derived(!live || snapshot.liveFilament === true);
	const session = $derived(snapshot.extrusion.session);
	const active = $derived(extrusionActive(snapshot.extrusion));
	const owns = $derived(session?.ownerId === userId);
	const operator = $derived(['owner', 'operator'].includes(role));
	const pending = $derived(
		submitting || snapshot.actions.some((a) => ['queued', 'sending'].includes(a.status))
	);
	const ready = $derived(
		connected &&
			snapshot.connection === 'connected' &&
			snapshot.klippy === 'ready' &&
			snapshot.telemetryReady &&
			snapshot.storage === 'healthy'
	);
	const idle = $derived(['standby', 'complete', 'cancelled'].includes(snapshot.job.state));
	const reason = $derived(
		!operator
			? 'An operator account is required.'
			: !connected
				? 'Reconnecting to Perilune.'
				: extrusionReason(snapshot)
	);
	const thermalReason = $derived(temperatureReason(snapshot, 'nozzle'));
	let previousRun: string | undefined;
	let previousTerminal = false;
	$effect(() => {
		const id = session?.id;
		const terminal = Boolean(session && !active);
		if (id !== previousRun || terminal !== previousTerminal) {
			loaded = false;
			clear = false;
		}
		previousRun = id;
		previousTerminal = terminal;
	});
	$effect(() => {
		void rotationDistance;
		void before;
		void after;
		manualResult = null;
	});
	const receipt = $derived(snapshot.actions.find((a) => a.id === lastAction));
	const proposal = $derived(interactive ? (session?.proposal ?? null) : manualResult);
	const running = $derived(session?.stage === 'extruding' || session?.stage === 'feeding');
	const validStart = $derived(
		rotationDistance !== undefined &&
			Number.isFinite(rotationDistance) &&
			rotationDistance >= 0.001 &&
			rotationDistance <= 1000 &&
			before !== undefined &&
			before >= 50 &&
			before <= 200
	);
	async function send(command: PrinterCommand) {
		failure = '';
		submitting = true;
		try {
			lastAction = await onSubmit(command);
		} catch (cause) {
			failure = isHttpError(cause)
				? cause.body.message
				: cause instanceof Error
					? cause.message
					: 'Could not submit the action.';
		} finally {
			submitting = false;
		}
	}
	function calculate() {
		failure = '';
		try {
			manualResult = calculateExtrusion(rotationDistance ?? NaN, before ?? NaN, after ?? NaN);
		} catch (cause) {
			manualResult = null;
			failure = cause instanceof Error ? cause.message : 'Check your measurements.';
		}
	}
	function exportProposal() {
		if (!proposal) return;
		const text = `# Extrusion-distance proposal — NOT APPLIED\n# Source: ${live ? 'manual measurements' : 'SIMULATOR EXAMPLE — do not apply to a real printer'}\n# Requested travel: 50 mm at 1 mm/s\n# Initial mark: ${proposal.before} mm; remaining: ${proposal.after} mm\n# Measured travel: ${proposal.actual} mm; previous rotation_distance: ${proposal.rotationDistance}\n# ${proposal.repeat ? 'Repeat this measurement before applying a change.' : 'Review against your current extruder configuration before applying.'}\n# Preserve gear_ratio and other existing settings.\n[extruder]\nrotation_distance: ${proposal.proposed.toFixed(3)}\n`;
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'extrusion-proposal.cfg';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="workshop">
	<section class="intro panel">
		<div>
			<p class="eyebrow">A measured approach</p>
			<h2>Does 50 mm really mean 50 mm?</h2>
			<p>
				Mark the filament at the intake, feed a known distance slowly, then measure what remains.
				This checks extruder travel; slicer flow and pressure advance are separate tuning steps.
			</p>
		</div>
		<svg
			class="filament-diagram"
			viewBox="0 0 280 150"
			role="img"
			aria-label="Measure from the filament mark to a fixed point at the extruder intake, before and after feeding."
		>
			<path d="M30 62H198" class="filament" /><path d="M92 47V77" class="mark" /><path
				d="M92 102H198M92 95v14m106-14v14"
				class="ruler"
			/><rect x="198" y="35" width="55" height="65" rx="10" class="intake" /><circle
				cx="225"
				cy="67"
				r="13"
				class="ruler"
			/><text x="60" y="30">Your mark</text><text x="113" y="133">Measure here</text><text
				x="199"
				y="119">Intake</text
			>
		</svg>
	</section>
	{#if failure || receipt?.status === 'failed' || receipt?.status === 'unknown'}<p
			class="notice error"
			role="alert"
		>
			{failure || receipt?.message || 'The action outcome is unknown. It will not be retried.'}
		</p>{/if}
	{#if !interactive}<p class="notice">
			Live filament movement is not enabled yet. You can calculate a proposal from a manually
			performed 50 mm test below. No heating, movement, or configuration changes are sent to your
			printer.
		</p>{/if}
	{#if interactive}
		<section class="panel">
			<p class="eyebrow">01 · Prepare</p>
			<h2>Ready the filament</h2>
			<div class="preparation">
				<div>
					<strong>{idle ? 'Printer idle' : 'Printer has an active or uncertain job'}</strong>
					<p>Extrusion needs an idle printer. XYZ homing is unnecessary.</p>
					<a href="/">Review current job →</a>
				</div>
				<div>
					<strong
						>Nozzle {snapshot.heaters.nozzle.current?.toFixed(1) ?? '—'}°C
						<span class="muted">/ {snapshot.heaters.nozzle.target ?? '—'}°C</span></strong
					>
					<p>Choose the printing temperature recommended for your filament.</p>
					{#if thermalReason && !active}<p class="muted">{thermalReason}</p>{/if}
					<div class="temperature">
						<label
							>Target (°C)<input
								type="number"
								min="170"
								max="280"
								step="1"
								bind:value={temperature}
							/></label
						><button
							disabled={!operator ||
								!ready ||
								pending ||
								active ||
								!idle ||
								temperature === undefined ||
								temperature < 170 ||
								temperature > 280 ||
								temperature === snapshot.heaters.nozzle.target ||
								Boolean(thermalReason)}
							onclick={() => send({ type: 'temperature', heater: 'nozzle', target: temperature! })}
							>{temperature === snapshot.heaters.nozzle.target
								? 'Target already set'
								: 'Set target'}</button
						>
					</div>
				</div>
			</div>
			<label class="check"
				><input type="checkbox" bind:checked={loaded} disabled={active} />Filament is loaded,
				gripped, and can feed freely.</label
			>
			<label class="check"
				><input type="checkbox" bind:checked={clear} disabled={active} />The nozzle has clearance
				and extruded filament has somewhere to go.</label
			>
			<div class="handling">
				<strong>Filament handling</strong><span>Feed or retract slowly · 1 mm/s</span>
				<div class="button-row">
					{#each [-25, -10, -5, 5, 10, 25] as distance}<button
							disabled={Boolean(reason) || active || pending || !loaded || !clear}
							onclick={() =>
								send({
									type: 'extrusionFeed',
									runId: crypto.randomUUID(),
									distance: distance as -25 | -10 | -5 | 5 | 10 | 25,
									confirmed: loaded && clear
								})}>{distance < 0 ? 'Retract' : 'Feed'} {Math.abs(distance)} mm</button
						>{/each}
				</div>
			</div>
			{#if !active && reason}<p class="muted" role="status">{reason}</p>{/if}
		</section>
	{/if}
	<section class="panel">
		<p class="eyebrow">02 · Measure</p>
		<h2>
			{!interactive
				? 'Enter your test measurements'
				: active
					? 'Your filament test'
					: 'Mark, measure, then feed'}
		</h2>
		{#if interactive && active}
			<p>
				Started by <strong>{session!.ownerName}</strong>. {owns
					? 'You own this workflow.'
					: 'Its owner controls the measurements.'}
			</p>
			{#if running}<p class="run-label">
					{session!.stage === 'feeding'
						? session!.distance < 0
							? 'Retracting filament'
							: 'Feeding filament'
						: 'Feeding the measured 50 mm'} · {live ? 'live printer' : 'simulator'}
				</p>
				<progress
					max={Math.abs(session!.distance)}
					value={live && running ? undefined : session!.completed}
				></progress>
				<p class="muted">
					{live
						? 'Waiting for movement acknowledgement and commanded position verification'
						: `${session!.completed} / ${Math.abs(session!.distance)} mm`} · 1 mm/s. Closing this page
					does not stop the workflow.
				</p>
			{:else if session!.stage === 'measure'}<p>
					Measure from the same fixed intake point to your mark. The initial distance was <strong
						>{session!.before} mm</strong
					>. {live
						? 'Measure the actual filament travel; the printer has no filament-distance encoder.'
						: 'Enter an example measurement for this simulator; no real filament moved.'}
				</p>
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void send({ type: 'extrusionMeasure', runId: session!.id, after: after ?? NaN });
					}}
				>
					<label
						>Remaining distance (mm)<input
							type="number"
							min="0"
							max={session!.before!}
							step="0.1"
							bind:value={after}
							required
							disabled={!owns || pending}
						/></label
					><button class="primary" disabled={!owns || !ready || pending || after === undefined}
						>Calculate proposal</button
					>
				</form>{/if}
		{:else}
			<p>
				Use the current extruder <code>rotation_distance</code>, including any runtime override.
				Make a mark about 70 mm from a fixed point at the intake and measure it precisely. Keep the
				existing <code>gear_ratio</code> unchanged.
			</p>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					if (!interactive) calculate();
					else
						void send({
							type: 'extrusionBegin',
							runId: crypto.randomUUID(),
							rotationDistance: rotationDistance!,
							before: before!,
							confirmed: loaded && clear
						});
				}}
			>
				<div class="fields">
					<label
						>Current rotation distance (mm)<input
							type="number"
							min="0.001"
							max="1000"
							step="any"
							bind:value={rotationDistance}
							required
							placeholder="From your extruder settings"
						/></label
					><label
						>Initial mark distance (mm)<input
							type="number"
							min="50"
							max="200"
							step="0.1"
							bind:value={before}
							required
						/></label
					>{#if !interactive}<label
							>Remaining after 50 mm (mm)<input
								type="number"
								min="0"
								max="199.9"
								step="0.1"
								bind:value={after}
								required
							/></label
						>{/if}
				</div>
				{#if !interactive}<p>
						Perform your manual test slowly at 1 mm/s using a suitable filament temperature, then
						enter the remaining distance. These inputs stay editable while disconnected.
					</p>{/if}
				<button
					class="primary"
					disabled={!validStart ||
						(interactive && (Boolean(reason) || pending || !loaded || !clear))}
					>{!interactive
						? 'Calculate proposal'
						: pending
							? 'Submitting…'
							: live
								? 'Extrude 50 mm · live printer'
								: 'Extrude 50 mm · simulator'}</button
				>
			</form>
		{/if}
		{#if interactive && session?.message}<p class="notice" role="status">{session.message}</p>{/if}
		{#if proposal}
			<div class="result">
				<p class="eyebrow">
					{live ? 'Manual measurement' : 'Simulator measurement'} · proposal only
				</p>
				<h3>{proposal.proposed.toFixed(3)} <span>mm rotation distance</span></h3>
				<p>
					{proposal.before} − {proposal.after} = {proposal.actual.toFixed(2)} mm measured travel.<br
					/>{proposal.rotationDistance} × {proposal.actual.toFixed(2)} / 50 = {proposal.proposed.toFixed(
						3
					)}
				</p>
				<p class:warning={proposal.repeat}>
					{proposal.repeat
						? 'The difference exceeds 2 mm. Repeat with a fresh mark before applying a change; check for slipping or a blocked nozzle.'
						: 'Repeat the test to confirm the result before changing printer settings.'}
				</p>
				<button onclick={exportProposal}>Export proposal</button>
				{#if role === 'owner' && onReviewProposal}<button
						onclick={() => onReviewProposal?.(proposal)}>Review in configuration</button
					>{:else if role !== 'owner'}<p class="muted">
						An owner can add this result to a reviewed configuration draft. You can export the
						proposal for them.
					</p>{/if}
				<p class="muted">
					This does not apply or save a printer setting. Review the exported snippet against your
					existing [extruder] section.
				</p>
			</div>
		{/if}
		{#if interactive && active}
			<div class="finish">
				<label class="check"
					><input type="checkbox" bind:checked={coolNozzle} />Cool down the nozzle when finishing or
					cancelling</label
				>
				<div class="button-row">
					{#if session!.stage === 'review'}<button
							class="primary"
							disabled={!owns || !ready || pending}
							onclick={() => send({ type: 'extrusionFinish', runId: session!.id, coolNozzle })}
							>Finish measurement</button
						>{/if}<button
						disabled={(!owns && role !== 'owner') || !ready || pending || (live && running)}
						onclick={() =>
							send({ type: 'extrusionCancel', runId: session!.id, coolNozzle, force: !owns })}
						>{owns ? 'Cancel workflow' : 'End operator’s workflow'}</button
					>
				</div>
			</div>
		{:else if interactive && session?.stage === 'finished'}<p class="muted" role="status">
				{session.proposal
					? 'Measurement finished. The proposal remains unapplied.'
					: 'Filament movement finished.'}
			</p>{/if}
	</section>
	<section class="panel guidance">
		<h2>What comes after this?</h2>
		<p>
			Extruder travel checks the drive mechanism. Flow ratio is a slicer/material setting; pressure
			advance compensates for pressure during speed changes. Neither should be used to hide slipping
			or a partially blocked nozzle.
		</p>
		<a
			href="https://www.klipper3d.org/Rotation_Distance.html#calibrating-rotation_distance-on-extruders"
			target="_blank"
			rel="noreferrer">Klipper’s extrusion-distance guide ↗</a
		>
		<p class="muted">
			Configuration review and saving are the next milestone. Print-based tuning will get its own
			workflows.
		</p>
	</section>
</div>

<style>
	.workshop {
		display: grid;
		gap: 1.25rem;
		max-width: 1080px;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 1rem;
		padding: clamp(1.2rem, 3vw, 2rem);
	}
	h2 {
		font-family: 'Newsreader Variable', Georgia, serif;
		font-size: 1.7rem;
		margin: 0.35rem 0 1rem;
	}
	p {
		line-height: 1.65;
		max-width: 74ch;
	}
	.intro {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		align-items: center;
		gap: 1.5rem;
	}
	.filament-diagram {
		width: 100%;
		max-width: 300px;
		justify-self: center;
	}
	.filament {
		stroke: var(--accent);
		stroke-width: 9;
		stroke-linecap: round;
	}
	.mark {
		stroke: var(--text);
		stroke-width: 3;
	}
	.ruler {
		stroke: var(--muted);
		stroke-width: 1.5;
		fill: none;
	}
	.intake {
		fill: var(--canvas);
		stroke: var(--border);
		stroke-width: 2;
	}
	text {
		fill: var(--muted);
		font-size: 11px;
	}
	.preparation,
	.fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.5rem;
		margin: 1.25rem 0;
	}
	.fields:has(label:nth-child(3)) {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	label:not(.check) {
		display: grid;
		gap: 0.6rem;
		font-weight: 600;
	}
	input[type='number'] {
		width: 100%;
		min-width: 0;
		background: var(--canvas);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		padding: 0.8rem;
		font: inherit;
	}
	.check {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		margin: 1rem 0;
	}
	.check input {
		width: 1.15rem;
		height: 1.15rem;
		flex: none;
		accent-color: var(--accent);
	}
	button {
		font: inherit;
		font-weight: 600;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		padding: 0.75rem 1rem;
		border-radius: 0.6rem;
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
	form > .primary {
		width: 100%;
		margin-top: 1rem;
	}
	.button-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.temperature {
		display: flex;
		align-items: end;
		gap: 0.6rem;
	}
	.temperature label {
		max-width: 125px;
	}
	.handling,
	.finish {
		border-top: 1px solid var(--border);
		margin-top: 1.5rem;
		padding-top: 1rem;
	}
	.handling > span {
		display: block;
		color: var(--muted);
		margin: 0.5rem 0 1rem;
	}
	.notice {
		border: 1px solid var(--border);
		background: var(--surface);
		padding: 1rem;
		border-radius: 0.7rem;
		line-height: 1.6;
	}
	.error,
	.warning {
		color: var(--danger);
	}
	.result {
		margin-top: 1.5rem;
		padding: 1.25rem;
		border-radius: 0.8rem;
		background: var(--canvas);
		border: 1px solid var(--border);
	}
	h3 {
		font-family: 'Newsreader Variable', Georgia, serif;
		font-size: 2.2rem;
		margin: 0.6rem 0;
	}
	h3 span {
		font-family: inherit;
		font-size: 1.1rem;
	}
	progress {
		width: 100%;
		height: 0.7rem;
		accent-color: var(--accent);
	}
	.run-label {
		font-weight: 600;
	}
	.muted {
		color: var(--muted);
	}
	a {
		color: var(--accent);
	}
	@media (max-width: 650px) {
		.intro,
		.preparation,
		.fields,
		.fields:has(label:nth-child(3)) {
			grid-template-columns: 1fr;
		}
		.filament-diagram {
			max-width: 240px;
		}
		.button-row button {
			flex: 1 1 100px;
		}
		.temperature {
			flex-wrap: wrap;
		}
	}
</style>
