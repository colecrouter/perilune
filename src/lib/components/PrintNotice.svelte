<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { printActionJournal } from '#lib/client/print-action-journal.svelte.js';
	import { isHttpError } from '@sveltejs/kit';
	import type { ActionRequest, ActionRecord, PrinterSnapshot } from '#lib/domain/printer.js';
	import { jobControlReason } from '#lib/domain/current-job.js';
	import { filamentChangeActive } from '#lib/domain/filament-change.js';
	import WorkflowNotice from './WorkflowNotice.svelte';
	import PrintJobActions from './PrintJobActions.svelte';
	import CancelDialog from './CancelDialog.svelte';
	import ActionFeedback from './ActionFeedback.svelte';
	let {
		snapshot,
		available = true,
		role,
		userId,
		submitStop,
		reconcile,
		reviewingStop = false
	}: {
		snapshot: PrinterSnapshot;
		available?: boolean;
		role?: string;
		userId: string;
		submitStop: (request: ActionRequest) => Promise<unknown>;
		reconcile?: (id: string, accountId: string) => Promise<ActionRecord>;
		reviewingStop?: boolean;
	} = $props();
	const job = $derived(snapshot.job);
	const active = $derived(job.state === 'printing' || job.state === 'paused');
	const operator = $derived(role === 'owner' || role === 'operator');
	const reason = $derived(jobControlReason(snapshot, true, operator));
	const filament = $derived(filamentChangeActive(snapshot.filamentChange));
	const priority = $derived(Boolean(snapshot.safety?.halted || snapshot.liveRecovery));
	const receipt = $derived(
		snapshot.actions
			.filter(
				(a) =>
					['Start print', 'Pause print', 'Resume print', 'Stop print'].includes(a.label) &&
					['queued', 'sending', 'unknown'].includes(a.status) &&
					!a.reviewedAt
			)
			.sort((a, b) => b.createdAt - a.createdAt)[0]
	);
	const fresh = $derived(
		snapshot.connection === 'connected' && snapshot.telemetryReady && snapshot.klippy === 'ready'
	);
	let open = $state(false);
	let reviewed = $state<{ id: string; owner: string; filename: string; runId: string | null }>();
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
		const changed = () => printActionJournal.refresh();
		window.addEventListener('storage', changed);
		return () => window.removeEventListener('storage', changed);
	});
	$effect(() => {
		const account = userId;
		untrack(() => printActionJournal.activate(account));
	});
	$effect(() => {
		const account = userId,
			receipts = snapshot.actions;
		untrack(() => printActionJournal.observe(account, receipts));
	});
	const journalReady = $derived(
		!mounted || (printActionJournal.account === userId && printActionJournal.ready)
	);
	const journalEntry = $derived(
		printActionJournal.account === userId ? printActionJournal.entries[0] : undefined
	);
	const unresolved = $derived(Boolean(journalEntry));
	const uncertainId = $derived(journalEntry?.id ?? '');

	const sameJob = $derived(
		Boolean(
			reviewed &&
			reviewed.owner === userId &&
			reviewed.filename === job.filename &&
			reviewed.runId === (job.runId ?? null)
		)
	);
	let checking = $state(false),
		checkFailure = $state('');
	async function checkReceipt() {
		const owner = userId,
			id = uncertainId;
		if (!id || !reconcile || checking) return;
		checking = true;
		checkFailure = '';
		try {
			const result = await reconcile(id, owner);
			printActionJournal.observe(owner, [result]);
		} catch {
			if (owner === userId)
				checkFailure =
					'Could not verify this receipt. Nothing was resent; try checking again when connected.';
		} finally {
			checking = false;
		}
	}

	function stop() {
		if (!available || reason || unresolved || !journalReady) return;
		reviewed = {
			id: crypto.randomUUID(),
			owner: userId,
			filename: job.filename,
			runId: job.runId ?? null
		};
		open = true;
	}
	async function confirm(coolBed: boolean, coolNozzle: boolean) {
		if (!available || !reviewed || reason || !sameJob || unresolved || !journalReady)
			throw Error('The print changed or controls are unavailable. Review its current state.');
		const owner = userId;
		const request: ActionRequest = {
			id: reviewed.id,
			command: {
				type: 'cancel',
				expectedJob: { filename: reviewed.filename, runId: reviewed.runId },
				coolBed,
				coolNozzle
			}
		};
		printActionJournal.begin(owner, request.id, 'Stop print');
		try {
			const receipt = await submitStop(request);
			if (receipt && typeof receipt === 'object' && 'status' in receipt)
				printActionJournal.observe(owner, [
					receipt as import('#lib/domain/printer.js').ActionRecord
				]);
		} catch (error) {
			if (!isHttpError(error) || error.status >= 500) printActionJournal.unknown(owner, request.id);
			else printActionJournal.reject(owner, request.id);
			throw error;
		}
	}
</script>

{#if active || receipt || unresolved || (operator && printActionJournal.error)}
	<section class="print-notice" aria-label="Print status">
		<WorkflowNotice
			kind={filament && snapshot.filamentChange?.stage === 'review' ? 'attention' : 'progress'}
		>
			{#snippet title()}{active
					? job.state === 'paused'
						? filament
							? 'Print paused · filament change'
							: 'Print paused'
						: 'Printing'
					: (receipt?.label ??
						(printActionJournal.error
							? 'Print controls unavailable'
							: 'Print action needs review'))}{/snippet}
			{#snippet children()}
				{#if active && job.filename}<p class="filename">{job.filename}</p>{/if}
				{#if active}<div class="progress-row">
						<progress
							aria-label="Print progress"
							max="100"
							value={job.progress === null ? undefined : Math.max(0, Math.min(100, job.progress))}
						></progress><span
							>{job.progress === null
								? 'Progress unavailable'
								: `${Math.round(job.progress)}%`}</span
						>{#if job.remainingMinutes !== null}<span
								>About {job.remainingMinutes} min remaining</span
							>{/if}
					</div>{/if}
				{#if snapshot.connection !== 'connected' || !snapshot.telemetryReady || snapshot.klippy !== 'ready'}<p
						class="muted"
					>
						{snapshot.connection === 'connected' && snapshot.klippy !== 'ready'
							? `Klipper is ${snapshot.klippy}. Print controls are unavailable.`
							: jobControlReason(snapshot, true, true)}
					</p>{/if}
				{#if filament}<p>
						{snapshot.filamentChange?.stage === 'review'
							? 'Check the printer and review filament-change guidance before continuing.'
							: 'Continue filament-change guidance before resuming.'}
					</p>{/if}
				{#if fresh && reason && operator}<p class="muted">{reason}</p>{/if}
				{#if receipt && operator}<ActionFeedback {receipt} />{/if}
				{#if checkFailure && operator}<p role="alert">{checkFailure}</p>{/if}
				{#if printActionJournal.error && operator}<p role="alert">
						{printActionJournal.error}
					</p>{/if}
				{#if unresolved && operator}<p
						role={journalEntry?.status === 'unknown' ? 'alert' : 'status'}
					>
						{journalEntry?.status === 'unknown'
							? `${journalEntry.label} could not be confirmed. It will not be resent automatically.`
							: `${journalEntry?.label} is awaiting confirmation. It will not be resent automatically.`}
						<a href={`/actions/${uncertainId}`}>View print receipt</a>
					</p>{/if}
			{/snippet}
			{#snippet actions()}
				{#if operator && active && !priority && !reviewingStop}<PrintJobActions
						{snapshot}
						available={available && journalReady && !unresolved && receipt?.status !== 'unknown'}
						{operator}
						{userId}
						onStop={stop}
					/>{/if}
				{#if operator && unresolved}<a href={`/actions/${uncertainId}`}>Review print submission →</a
					>
					{#if reconcile}<button
							class="button secondary"
							disabled={checking || !available}
							onclick={checkReceipt}>{checking ? 'Checking…' : 'Check receipt'}</button
						>{/if}
				{:else if operator && receipt?.status === 'unknown'}<a href={`/actions/${receipt.id}`}
						>Review uncertain print action →</a
					>{/if}
				{#if !active}<a href="/jobs">Job library →</a>{/if}
			{/snippet}
		</WorkflowNotice>
	</section>
{/if}
<CancelDialog
	jobName={reviewed?.filename}
	unavailableReason={!sameJob || !active
		? 'The displayed print changed or ended. Close this dialog and review the current job.'
		: (reason ?? (unresolved ? 'Review the stop receipt before another submission.' : undefined))}
	bind:open
	available={available && fresh && !reason && sameJob && !unresolved && journalReady && active}
	targetsAvailable={fresh}
	bedTarget={snapshot.heaters.bed.target}
	nozzleTarget={snapshot.heaters.nozzle.target}
	onConfirm={confirm}
/>

<style>
	.print-notice {
		padding: 0.75rem clamp(1rem, 3vw, 2.5rem);
	}
	p {
		margin: 0.4rem 0;
		line-height: 1.5;
	}
	.filename {
		overflow-wrap: anywhere;
		font-size: 0.9rem;
	}
	.progress-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 0.8rem;
		font-size: 0.85rem;
	}
	progress {
		accent-color: var(--accent);
		height: 0.5rem;
		flex: 1 1 12rem;
		max-width: 24rem;
	}
	a {
		color: var(--accent);
	}
</style>
