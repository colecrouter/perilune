<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import CancelDialog from './CancelDialog.svelte';
	import { meshProbeActive, meshProbeReason, probeSample } from '#lib/domain/mesh-probe.js';
	import { liveMeshReason } from '#lib/domain/live-mesh.js';
	import { allAxesHomed } from '#lib/domain/motion.js';
	import { heaterTargetsOff } from '#lib/domain/temperature.js';
	import { meshStats } from '#lib/domain/bed-mesh.js';
	import type { PrinterSnapshot, PrinterCommand } from '#lib/domain/printer.js';
	let {
		snapshot,
		connected,
		userId,
		role,
		onSubmit
	}: {
		snapshot: PrinterSnapshot;
		connected: boolean;
		userId: string;
		role: string;
		onSubmit: (command: PrinterCommand) => Promise<string>;
	} = $props();
	const live = $derived(snapshot.mode === 'moonraker');
	const plan = $derived(snapshot.meshProbe.session?.plan ?? snapshot.liveMesh.plan);
	const total = $derived(live && plan ? plan.columns * plan.rows : 25);
	let open = $state(false);
	let stopOpen = $state(false);
	let finishOpen = $state(false);
	let cancelOpen = $state(false);
	let clean = $state(false);
	let clear = $state(false);
	let understand = $state(false);
	let submitting = $state(false);
	let failure = $state('');
	let name = $state('');
	let lastAction = $state('');
	const receipt = $derived(snapshot.actions.find((action) => action.id === lastAction));
	let reviewed = $state<{ id: string; owner: string; outcome: 'apply' | 'save'; force: boolean }>();
	let stopJob = $state<{ filename: string; runId: string | null }>();
	const session = $derived(snapshot.meshProbe.session);
	const active = $derived(meshProbeActive(snapshot.meshProbe));
	const owns = $derived(session?.ownerId === userId);
	const canOperate = $derived(['owner', 'operator'].includes(role));
	const ready = $derived(
		connected && snapshot.connection === 'connected' && snapshot.klippy === 'ready'
	);
	const homed = $derived(ready && allAxesHomed(snapshot));
	const off = $derived(ready && heaterTargetsOff(snapshot));
	const idle = $derived(ready && ['standby', 'complete', 'cancelled'].includes(snapshot.job.state));
	const pending = $derived(
		submitting || snapshot.actions.some((action) => ['queued', 'sending'].includes(action.status))
	);
	const reason = $derived(
		!canOperate
			? 'An operator account is required.'
			: !connected
				? 'Reconnecting to Perilune.'
				: live
					? liveMeshReason(snapshot)
					: meshProbeReason(snapshot)
	);
	const currentSample = $derived(
		!live && session?.stage === 'probing'
			? probeSample(Math.min(24, session.completedSamples))
			: null
	);
	const stats = $derived(session?.result ? meshStats(session.result) : null);
	const sessionId = $derived(session?.id);
	$effect(() => {
		void sessionId;
		clean = false;
		clear = false;
		understand = false;
	});
	async function send(command: PrinterCommand) {
		submitting = true;
		failure = '';
		try {
			lastAction = await onSubmit(command);
		} catch (cause) {
			failure = isHttpError(cause)
				? cause.body.message
				: cause instanceof Error
					? cause.message
					: 'Could not submit the action.';
			throw cause;
		} finally {
			submitting = false;
		}
	}
	async function begin() {
		try {
			await send({
				type: 'meshProbeBegin',
				probeId: crypto.randomUUID(),
				confirmed: clean && clear && understand
			});
			open = false;
		} catch {
			/* visible failure retained */
		}
	}
	async function basic(command: PrinterCommand) {
		try {
			await send(command);
		} catch {
			/* visible failure retained */
		}
	}
	function review(outcome: 'apply' | 'save') {
		if (!session) return;
		reviewed = { id: session.id, owner: session.ownerName, outcome, force: false };
		finishOpen = true;
	}
	function cancel() {
		if (!session) return;
		reviewed = { id: session.id, owner: session.ownerName, outcome: 'apply', force: !owns };
		cancelOpen = true;
	}
</script>

<section class="probe-workflow" aria-label="Guided bed mesh probing">
	{#if live && !snapshot.liveMesh.enabled}<div class="probe-entry">
			<button
				class="button primary"
				disabled
				title="Live mesh commands are disabled on this server.">Probe bed…</button
			>
			<p class="fine-hint">
				Live mesh commands are disabled on this server. Mesh inspection is available.
			</p>
		</div>
	{:else if !active}<div class="probe-entry">
			<button
				class="button primary"
				disabled={!canOperate || pending || !connected}
				onclick={() => (open = true)}>Probe bed…</button
			>
			<p class="fine-hint">
				{live
					? 'Review the configured path, follow probing, then keep or save the result.'
					: 'Guided simulator run · review the plan, follow progress, then choose what to keep.'}
			</p>
		</div>{/if}
	{#if receipt && ['failed', 'unknown'].includes(receipt.status)}<p role="alert" class="error-text">
			{receipt.label}: {receipt.status}. {receipt.message} This action will not be retried automatically.
		</p>{/if}
	{#if failure}<p class="error-text" role="alert">{failure}</p>{/if}
	{#if session}
		{#if active}<div class="probe-panel">
				<div class="probe-heading">
					<div>
						<p class="eyebrow">
							{live ? 'Live probing' : 'Simulator probing'} · {session.ownerName}
						</p>
						<h2>
							{session.stage === 'uncertain'
								? 'Check the printer'
								: session.stage === 'saving'
									? 'Saving and restarting'
									: session.stage === 'probing'
										? 'Mapping the bed'
										: 'Review your mesh'}
						</h2>
					</div>
					<span class="mode-badge">{live ? 'Measured samples' : 'Synthetic samples'}</span>
				</div>
				{#if !ready}<p class="notice" role="status">
						Reconnecting. This workflow is owned by the backend; check its state when the connection
						returns.
					</p>{/if}
				{#if session.stage === 'probing'}<label class="progress-label"
						>{session.completedSamples} of {total} samples<progress
							max={total}
							value={session.completedSamples}
						></progress></label
					>
					<p role="status">
						{currentSample ? `Next sample: X ${currentSample.x} · Y ${currentSample.y} mm` : ''}
					</p>
					<p class="muted">
						{live
							? 'Homing runs first if needed. Leaving this page does not stop probing. Normal queued commands cannot interrupt probing; use the printer’s emergency stop if movement must stop immediately.'
							: 'No motors, heaters or probe are operated. Leaving this page does not stop the simulator run.'}
					</p>
				{:else if session.stage === 'saving' || session.stage === 'uncertain'}<p role="status">
						{session.message}
					</p>
				{:else if stats}<p>
						The result below contains {total}
						{live ? 'measured' : 'synthetic'} samples with a {stats.range.toFixed(3)} mm range. {live
							? 'Klipper has already activated this mesh. Your default profile has not been overwritten.'
							: 'Your active mesh and saved profiles have not changed.'}
					</p>
					<div class="review-actions">
						<button
							class="button primary"
							disabled={!owns || !canOperate || !ready || pending}
							onclick={() => review('apply')}>Use temporarily…</button
						><button
							class="button secondary"
							disabled={!owns || !canOperate || !ready || pending}
							onclick={() => review('save')}>Save profile…</button
						>
					</div>
					<p class="fine-hint">
						{live
							? 'Keeping this mesh is temporary. Saving writes all pending Klipper configuration and restarts it. Your start macro must load the saved profile to use it for prints.'
							: 'Temporary use ends on restart. Saving creates a new simulator profile without activating it. Unsaved review expires after ten minutes from the start.'}
					</p>{/if}
				{#if !owns}<p class="notice">
						{session.ownerName} owns this workflow. You can follow progress; an account owner can cancel
						an abandoned run.
					</p>{/if}
				<div class="cancel-area">
					<button
						class="button secondary"
						disabled={!canOperate ||
							(!owns && role !== 'owner') ||
							!ready ||
							pending ||
							(live && ['probing', 'saving'].includes(session.stage))}
						onclick={cancel}
						>{live
							? 'Restore previous mesh…'
							: owns
								? 'Cancel and discard…'
								: 'Cancel abandoned workflow…'}</button
					>
				</div>
			</div>{:else if session.message}<p class="notice" role="status">{session.message}</p>{/if}
	{/if}
</section>
<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content probe-dialog"
			><Dialog.Title class="dialog-title">Prepare to probe the bed</Dialog.Title><Dialog.Description
				class="muted"
				>{live && plan
					? `Cold probing: ${total} points across X ${plan.min[0]}–${plan.max[0]} and Y ${plan.min[1]}–${plan.max[1]} mm, with ${plan.samples} readings per point. The printer will home if needed, then probe and activate the result. Heater targets remain off.`
					: 'A cold simulator exercise: 25 synthetic samples across X 20–200 and Y 20–200 mm. No movement, heating, actual probing or printer configuration write occurs.'}</Dialog.Description
			>
			<div class="automatic-checks" aria-label="Automatic probing checks">
				<label><input type="checkbox" checked={ready} disabled />Printer connected and ready</label
				><label><input type="checkbox" checked={idle} disabled />No running or paused job</label
				><label
					><input type="checkbox" checked={homed} disabled />{live
						? 'All axes homed (automatic homing if needed)'
						: 'All axes homed'}</label
				><label><input type="checkbox" checked={off} disabled />Heater targets off</label>
			</div>
			{#if !live}<div class="prepare-actions">
					<button
						class="button secondary"
						disabled={!canOperate || !ready || pending || homed || !idle || active}
						title={homed ? 'All axes are already homed.' : undefined}
						onclick={() => basic({ type: 'home', axes: 'all' })}>Home all axes</button
					><button
						class="button secondary"
						disabled={!canOperate || !ready || pending || off || active}
						title={off ? 'Both heater targets are already off.' : undefined}
						onclick={() => basic({ type: 'cooldown' })}>Turn heater targets off</button
					>{#if ['printing', 'paused'].includes(snapshot.job.state)}<button
							class="button secondary"
							disabled={!canOperate || !ready || pending}
							onclick={() => {
								stopJob = { filename: snapshot.job.filename, runId: snapshot.job.runId ?? null };
								stopOpen = true;
							}}>Stop current simulation…</button
						>{/if}
				</div>{/if}
			<p class="fine-hint">
				The automatic checks follow printer state. An off target does not mean the heater has
				cooled. This workflow measures a cold bed; a warm-bed workflow will be a separate option.
			</p>
			<p class="fine-hint">
				For a real run: inspect the bed and probe for debris, clear prints and obstructions from the
				area, and verify clearance along the probing path.
			</p>
			<div class="manual-checks">
				<label
					><input type="checkbox" bind:checked={clean} />I reviewed bed and probe cleanliness.</label
				><label
					><input type="checkbox" bind:checked={clear} />I reviewed physical clearance across the
					probing area.</label
				><label
					><input type="checkbox" bind:checked={understand} />{live
						? 'I understand the printer will move and probe, and the result becomes active immediately.'
						: 'I understand this run uses synthetic simulator samples.'}</label
				>
			</div>
			{#if reason}<p class="notice">{reason}</p>{/if}{#if failure}<p
					class="error-text"
					role="alert"
				>
					{failure}
				</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}
					>Back to inspection</Dialog.Close
				><button
					class="button primary"
					disabled={Boolean(reason) || pending || !clean || !clear || !understand}
					onclick={begin}
					>{submitting
						? 'Submitting…'
						: live
							? 'Home and probe bed'
							: 'Begin simulator probing'}</button
				>
			</div>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
<CancelDialog
	bind:open={stopOpen}
	available={ready}
	bedTarget={snapshot.heaters.bed.target}
	nozzleTarget={snapshot.heaters.nozzle.target}
	onConfirm={(coolBed, coolNozzle) =>
		send({ type: 'cancel', coolBed, coolNozzle, expectedJob: stopJob })}
/>
<Dialog.Root bind:open={finishOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title"
				>{reviewed?.outcome === 'save'
					? live
						? 'Write configuration and restart?'
						: 'Save a simulator profile?'
					: 'Use this mesh temporarily?'}</Dialog.Title
			><Dialog.Description class="muted"
				>{reviewed?.outcome === 'save'
					? live
						? 'Save a new mesh profile, write ALL pending Klipper configuration changes, and restart Klipper. Existing profiles are never overwritten. Your start macro must load this name to use it for prints.'
						: 'Create a new saved profile from the reviewed result. This survives restart and does not change the active mesh.'
					: live
						? 'Keep the already active mesh until Klipper restarts or another mesh is loaded. The start macro may load a different mesh.'
						: 'Use the reviewed result as the active mesh for this simulator process. Restarting clears temporary application.'}</Dialog.Description
			>
			{#if reviewed?.outcome === 'save'}<label class="profile-name"
					>Profile name<input
						bind:value={name}
						maxlength="40"
						placeholder="e.g. reviewed-bed"
					/></label
				>
				<p class="fine-hint">
					{live
						? '1–40 letters, numbers, underscores or hyphens. Default and internal names are reserved.'
						: '1–40 letters, numbers, spaces, underscores or hyphens. Existing profiles are never overwritten.'}
				</p>{/if}
			{#if failure}<p class="error-text" role="alert">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep reviewing</Dialog.Close
				><button
					class="button primary"
					disabled={!canOperate ||
						!owns ||
						!ready ||
						pending ||
						!reviewed ||
						(reviewed.outcome === 'save' && !name.trim())}
					onclick={async () => {
						if (!reviewed) return;
						try {
							await send({
								type: 'meshProbeFinish',
								probeId: reviewed.id,
								outcome: reviewed.outcome,
								name: reviewed.outcome === 'save' ? name : undefined
							});
							finishOpen = false;
						} catch {
							/* retained in dialog */
						}
					}}
					>{reviewed?.outcome === 'save'
						? live
							? 'Write and restart'
							: 'Save profile'
						: 'Use temporarily'}</button
				>
			</div>
		</Dialog.Content></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root bind:open={cancelOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title">Cancel this bed mesh workflow?</Dialog.Title
			><Dialog.Description class="muted"
				>{live
					? 'Confirm the printer has stopped. Restore the previously active saved profile (or clear compensation if none was active) and remove this temporary profile. This does not undo configuration that was already written.'
					: `Discard the unfinished run or unsaved result belonging to ${reviewed?.owner}. The previous active mesh and saved profiles are retained.`}</Dialog.Description
			>{#if failure}<p class="error-text" role="alert">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep going</Dialog.Close
				><button
					class="button danger"
					disabled={!ready || pending || !reviewed}
					onclick={async () => {
						if (!reviewed) return;
						try {
							await send({
								type: 'meshProbeCancel',
								probeId: reviewed.id,
								confirmed: true,
								force: reviewed.force
							});
							cancelOpen = false;
						} catch {
							/* retained in dialog */
						}
					}}>{live ? 'Restore previous mesh' : 'Cancel and discard'}</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
	.probe-entry {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.probe-entry p {
		margin: 0;
	}
	.probe-panel {
		padding: 1.4rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
	}
	.probe-heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}
	h2 {
		margin: 0.3rem 0 1rem;
	}
	.progress-label {
		display: grid;
		gap: 0.5rem;
		font-weight: 600;
	}
	progress {
		width: 100%;
		accent-color: var(--accent);
	}
	.review-actions,
	.prepare-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.cancel-area {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.automatic-checks,
	.manual-checks {
		display: grid;
		gap: 0.8rem;
		margin: 1.3rem 0;
	}
	label {
		display: flex;
		gap: 0.65rem;
		align-items: start;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	input[type='checkbox'] {
		margin-top: 0.25rem;
		accent-color: var(--accent);
	}
	.profile-name {
		display: grid;
		margin: 1rem 0;
	}
	input:not([type='checkbox']) {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		border-radius: 0.6rem;
		padding: 0.7rem;
	}
	:global(.probe-dialog) {
		max-height: calc(100dvh - 2rem);
		overflow: auto;
	}
	@media (max-width: 600px) {
		.probe-heading {
			flex-direction: column;
		}
		.probe-panel {
			padding: 1rem;
		}
	}
</style>
