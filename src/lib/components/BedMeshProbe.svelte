<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import CancelDialog from './CancelDialog.svelte';
	import { meshProbeActive, meshProbeReason, probeSample } from '#lib/domain/mesh-probe.js';
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
				: meshProbeReason(snapshot)
	);
	const currentSample = $derived(
		session?.stage === 'probing' ? probeSample(Math.min(24, session.completedSamples)) : null
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
	{#if snapshot.mode === 'moonraker'}<div class="probe-entry">
			<button
				class="button primary"
				disabled
				title="Live probing requires coordinated printer testing.">Probe bed…</button
			>
			<p class="fine-hint">
				Live probing will be enabled after coordinated printer testing. Mesh inspection is available
				now.
			</p>
		</div>
	{:else if !active}<div class="probe-entry">
			<button
				class="button primary"
				disabled={!canOperate || pending || !connected}
				onclick={() => (open = true)}>Probe bed…</button
			>
			<p class="fine-hint">
				Guided simulator run · review the plan, follow progress, then choose what to keep.
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
						<p class="eyebrow">Simulator probing · {session.ownerName}</p>
						<h2>{session.stage === 'probing' ? 'Mapping the bed' : 'Review your mesh'}</h2>
					</div>
					<span class="mode-badge">Synthetic samples</span>
				</div>
				{#if !ready}<p class="notice" role="status">
						Reconnecting. This workflow is owned by the backend; check its state when the connection
						returns.
					</p>{/if}
				{#if session.stage === 'probing'}<label class="progress-label"
						>{session.completedSamples} of 25 samples<progress
							max="25"
							value={session.completedSamples}
						></progress></label
					>
					<p role="status">
						{currentSample ? `Next sample: X ${currentSample.x} · Y ${currentSample.y} mm` : ''}
					</p>
					<p class="muted">
						No motors, heaters or probe are operated. Leaving this page does not stop the simulator
						run.
					</p>
				{:else if stats}<p>
						The candidate below contains 25 synthetic samples with a {stats.range.toFixed(3)} mm range.
						Your active mesh and saved profiles have not changed.
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
						Temporary use ends on restart. Saving creates a new simulator profile without activating
						it. Unsaved review expires after ten minutes from the start.
					</p>{/if}
				{#if !owns}<p class="notice">
						{session.ownerName} owns this workflow. You can follow progress; an account owner can cancel
						an abandoned run.
					</p>{/if}
				<div class="cancel-area">
					<button
						class="button secondary"
						disabled={!canOperate || (!owns && role !== 'owner') || !ready || pending}
						onclick={cancel}>{owns ? 'Cancel and discard…' : 'Cancel abandoned workflow…'}</button
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
				>A cold simulator exercise: 25 synthetic samples across X 20–200 and Y 20–200 mm. No
				movement, heating, actual probing or printer configuration write occurs.</Dialog.Description
			>
			<div class="automatic-checks" aria-label="Automatic probing checks">
				<label><input type="checkbox" checked={ready} disabled />Printer connected and ready</label
				><label><input type="checkbox" checked={idle} disabled />No running or paused job</label
				><label><input type="checkbox" checked={homed} disabled />All axes homed</label><label
					><input type="checkbox" checked={off} disabled />Heater targets off</label
				>
			</div>
			<div class="prepare-actions">
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
			</div>
			<p class="fine-hint">
				The automatic checks follow printer state. An off target does not mean the heater has
				cooled. Live probing will need a reviewed heating and probing plan for the printer.
			</p>
			<p class="fine-hint">
				For a real run: inspect the bed and probe for debris, clear prints and obstructions from the
				area, and verify clearance along the probing path.
			</p>
			<div class="manual-checks">
				<label
					><input type="checkbox" bind:checked={clean} />I reviewed the clean-bed and clean-probe
					checklist.</label
				><label
					><input type="checkbox" bind:checked={clear} />I reviewed physical clearance across the
					probing area.</label
				><label
					><input type="checkbox" bind:checked={understand} />I understand this run uses synthetic
					simulator samples.</label
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
					onclick={begin}>{submitting ? 'Submitting…' : 'Begin simulator probing'}</button
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
					? 'Save a simulator profile?'
					: 'Use this mesh temporarily?'}</Dialog.Title
			><Dialog.Description class="muted"
				>{reviewed?.outcome === 'save'
					? 'Create a new saved profile from the reviewed result. This survives restart and does not change the active mesh.'
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
					1–40 letters, numbers, spaces, underscores or hyphens. Existing profiles are never
					overwritten.
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
					}}>{reviewed?.outcome === 'save' ? 'Save profile' : 'Use temporarily'}</button
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
				>Discard the unfinished run or unsaved result belonging to {reviewed?.owner}. The previous
				active mesh and saved profiles are retained.</Dialog.Description
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
					}}>Cancel and discard</button
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
