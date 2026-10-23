<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import CancelDialog from './CancelDialog.svelte';
	import {
		meshProbeActive,
		meshProbeReason,
		meshCalibrationTargetSupported
	} from '#lib/domain/mesh-probe.js';
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
		onSubmit,
		target = $bindable('default'),
		showTrigger = true
	}: {
		snapshot: PrinterSnapshot;
		connected: boolean;
		userId: string;
		role: string;
		onSubmit: (command: PrinterCommand) => Promise<string>;
		target?: string;
		showTrigger?: boolean;
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
	let expectedTarget = $state('null');

	let replacing = $state(false);
	export function prepare(nextTarget = 'default', replace = false) {
		if (
			(replace && !meshCalibrationTargetSupported(nextTarget, !live)) ||
			active ||
			pending ||
			!canOperate ||
			!connected ||
			(live && !snapshot.liveMesh.enabled)
		)
			return;
		target = nextTarget;
		replacing = replace;
		clean = false;
		clear = false;
		understand = false;
		failure = '';
		expectedTarget = JSON.stringify(
			snapshot.bedMesh.profiles.find((p) => p.name === target) ?? null
		);
		open = true;
	}
	let lastAction = $state('');
	const receipt = $derived(snapshot.actions.find((action) => action.id === lastAction));
	let reviewed = $state<{ id: string; owner: string; outcome: 'apply' | 'save'; force: boolean }>();
	let stopJob = $state<{ filename: string; runId: string | null }>();
	const session = $derived(snapshot.meshProbe.session);

	const active = $derived(meshProbeActive(snapshot.meshProbe));
	const targetLabel = $derived(
		(active ? (session?.target ?? target) : target) === 'default'
			? 'usual mesh'
			: active
				? (session?.target ?? target)
				: target
	);
	const isNew = $derived(Boolean(session?.newProfile || !session?.usual));
	const owns = $derived(session?.ownerId === userId);
	const canOperate = $derived(['owner', 'operator'].includes(role));
	const ready = $derived(
		connected &&
			snapshot.connection === 'connected' &&
			snapshot.klippy === 'ready' &&
			snapshot.telemetryReady
	);
	const homed = $derived(ready && allAxesHomed(snapshot));
	const off = $derived(ready && heaterTargetsOff(snapshot));
	const liveIdle = $derived(
		!live ||
			(snapshot.motion.busy === false &&
				!snapshot.actions.some((a) => ['queued', 'sending'].includes(a.status)))
	);
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
				confirmed: clean && clear && understand,
				usual: role === 'owner',
				newProfile: role === 'owner' && !replacing,
				target: role === 'owner' && replacing ? target : undefined,
				expectedTarget: role === 'owner' && replacing ? expectedTarget : undefined
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
		name = '';
		finishOpen = true;
	}
	function cancel() {
		if (!session) return;
		reviewed = { id: session.id, owner: session.ownerName, outcome: 'apply', force: !owns };
		cancelOpen = true;
	}
</script>

{#if showTrigger || active || failure || receipt || session?.message}<section
		id="mesh-calibration"
		class="probe-workflow"
		aria-label="Guided bed mesh probing"
	>
		{#if showTrigger && !active}<button
				class="button primary"
				disabled={!canOperate || pending || !connected || (live && !snapshot.liveMesh.enabled)}
				onclick={() => prepare()}>New calibration…</button
			>{/if}
		{#if receipt && ['failed', 'unknown'].includes(receipt.status)}<p
				role="alert"
				class="error-text"
			>
				{receipt.label}: {receipt.status}. {receipt.message} This action will not be retried automatically.
			</p>{/if}
		{#if failure}<p class="error-text" role="alert">{failure}</p>{/if}
		{#if session}
			{#if active}<div class="probe-panel">
					{#if ['review', 'uncertain'].includes(session.stage)}<div class="probe-heading">
							<div>
								<p class="eyebrow">
									{live ? 'Live probing' : 'Simulator probing'} · {session.ownerName}
								</p>
								<h2>
									{session.stage === 'uncertain' ? 'Check the printer' : 'Review your mesh'}
								</h2>
							</div>
							<span class="mode-badge">{live ? 'Measured samples' : 'Synthetic samples'}</span>
						</div>{/if}
					{#if !ready}<p class="notice" role="status">
							Reconnecting. This workflow is owned by the backend; check its state when the
							connection returns.
						</p>{/if}
					{#if session.stage === 'probing'}
						<p class="muted">
							{live
								? 'Homing runs first if needed. Leaving this page does not stop probing. Normal queued commands cannot interrupt probing; use the printer’s emergency stop if movement must stop immediately.'
								: 'No motors, heaters or probe are operated. Leaving this page does not stop the simulator run.'}
						</p>
					{:else if session.stage === 'uncertain'}<p role="status">{session.message}</p>
					{:else if session.stage === 'review' && stats}<p>
							The result below contains {total}
							{live ? 'measured' : 'synthetic'} samples with a {stats.range.toFixed(3)} mm range. {live
								? session.usual
									? isNew
										? 'Klipper has activated the result. Existing saved profiles are unchanged.'
										: 'Klipper has activated the result. The previously saved mesh remains on disk until you accept.'
									: 'Klipper has already activated this mesh. Your usual saved mesh has not been overwritten.'
								: 'Your active mesh and saved profiles have not changed.'}
						</p>
						{#if live && !liveIdle}<p class="notice" role="status">
								Waiting for the printer to finish movement before keeping, restoring, or saving this
								mesh.
							</p>{/if}
						<div class="review-actions">
							{#if !session.usual}<button
									class="button primary"
									disabled={!owns || !canOperate || !ready || pending || !liveIdle}
									onclick={() => review('apply')}>Use temporarily…</button
								>{/if}<button
								class="button secondary"
								disabled={!owns || !canOperate || !ready || pending || !liveIdle}
								onclick={() => review('save')}>{isNew ? 'Save as…' : 'Save replacement…'}</button
							>
						</div>
						<p class="fine-hint">
							{live
								? session.usual
									? `${isNew ? 'Save this result under a new unique name.' : `Accepting replaces ${targetLabel}.`} Saving or discarding restarts Klipper; unrelated pending changes block either operation.`
									: 'Keeping this mesh is temporary. Saving writes all pending Klipper configuration and restarts it. Your start macro must load the saved profile to use it for prints.'
								: session.usual
									? 'Saving activates the accepted simulator result. Unsaved review expires after ten minutes from the start.'
									: 'Temporary use ends on restart. Saving creates a new simulator profile without activating it. Unsaved review expires after ten minutes from the start.'}
						</p>{/if}
					{#if !owns}<p class="notice">
							{session.ownerName} owns this workflow. You can follow progress; an account owner can cancel
							an abandoned run.
						</p>{/if}
					{#if session.stage === 'uncertain' && role === 'owner'}<button
							class="button secondary"
							disabled={!ready || pending}
							onclick={() =>
								basic({ type: 'meshProbeReconcile', probeId: session.id, confirmed: true })}
							>Check saved outcome</button
						>{/if}
					{#if !session.operation}<div class="cancel-area">
							<button
								class="button secondary"
								disabled={!canOperate ||
									(!owns && role !== 'owner') ||
									!ready ||
									pending ||
									!liveIdle ||
									(live && ['probing', 'saving'].includes(session.stage))}
								onclick={cancel}
								>{live
									? session.usual
										? session.discardStarted
											? 'Restore previous compensation…'
											: 'Discard calibration…'
										: 'Restore previous mesh…'
									: owns
										? 'Cancel and discard…'
										: 'Cancel abandoned workflow…'}</button
							>
						</div>{/if}
				</div>{:else if session.message}<p class="notice" role="status">{session.message}</p>{/if}
		{/if}
	</section>{/if}
<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content probe-dialog"
			><Dialog.Title class="dialog-title"
				>{replacing
					? `Replace ${target === 'default' ? 'Usual mesh' : target}`
					: 'New bed-mesh calibration'}</Dialog.Title
			><Dialog.Description class="muted"
				>{live && plan
					? `Cold probing: ${total} points across X ${plan.min[0]}–${plan.max[0]} and Y ${plan.min[1]}–${plan.max[1]} mm, with ${plan.samples} readings per point. The printer will home if needed, then probe and activate the result. Heater targets remain off.`
					: 'A cold simulator exercise: 25 synthetic samples across X 20–200 and Y 20–200 mm. No movement, heating, actual probing or printer configuration write occurs.'}</Dialog.Description
			>
			<p class="notice">
				{replacing
					? `This run replaces ${targetLabel} only when accepted.`
					: 'This run creates a new saved mesh. Existing saved profiles are not replaced; choose a unique name after reviewing the result.'}
				{live
					? 'Probing activates the result immediately. Save and Discard restart Klipper; resolve existing pending configuration before starting.'
					: 'No real printer settings are changed.'}
			</p>
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
					? isNew
						? 'Save mesh as…'
						: `Save replacement for ${targetLabel}?`
					: 'Use this mesh temporarily?'}</Dialog.Title
			>
			<Dialog.Description class="muted"
				>{reviewed?.outcome === 'save'
					? `${isNew ? 'Save this result with a new unique name. Existing saved meshes are unchanged.' : `Replace ${targetLabel} with the reviewed result.`} ${live ? 'Klipper will restart after saving. Your print-start configuration is unchanged.' : 'No real printer settings are changed.'}`
					: 'Use this mesh temporarily until restart.'}</Dialog.Description
			>
			{#if reviewed?.outcome === 'save' && isNew}<label class="profile-name"
					>Profile name<input bind:value={name} maxlength="40" placeholder="e.g. cold-bed" /></label
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
						!liveIdle ||
						pending ||
						!reviewed ||
						(reviewed.outcome === 'save' && isNew && !name.trim())}
					onclick={async () => {
						if (!reviewed) return;
						try {
							await send({
								type: 'meshProbeFinish',
								probeId: reviewed.id,
								outcome: reviewed.outcome,
								name: reviewed.outcome === 'save' && isNew ? name : undefined
							});
							finishOpen = false;
						} catch {
							/* retained in dialog */
						}
					}}
					>{reviewed?.outcome === 'save'
						? live
							? 'Save and restart'
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
					? session?.usual
						? session.discardStarted
							? 'Verify saved configuration and restore the previous compensation. If the restart is already verified, it will not be repeated.'
							: 'Restart Klipper WITHOUT saving this calibration, then restore the previously active saved mesh. Existing saved profiles remain unchanged. Unrelated pending settings block the restart.'
						: 'Confirm the printer has stopped. Restore the previously active saved profile (or clear compensation if none was active) and remove this temporary profile. This does not undo configuration that was already written.'
					: `Discard the unfinished run or unsaved result belonging to ${reviewed?.owner}. The previous active mesh and saved profiles are retained.`}</Dialog.Description
			>{#if failure}<p class="error-text" role="alert">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep going</Dialog.Close
				><button
					class="button danger"
					disabled={!ready || !liveIdle || pending || !reviewed}
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
					}}
					>{live
						? session?.usual
							? session.discardStarted
								? 'Restore previous compensation'
								: 'Discard and restart'
							: 'Restore previous mesh'
						: 'Cancel and discard'}</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
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
