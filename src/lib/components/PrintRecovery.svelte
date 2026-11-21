<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	import { printActionJournal } from '#lib/client/print-action-journal.svelte.js';
	import { reconcilePrintAction } from '../../routes/printer.remote.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';

	import EmergencyRecovery from '#lib/components/EmergencyRecovery.svelte';
	import LiveActionRecovery from '#lib/components/LiveActionRecovery.svelte';
	import SafetyButton from '#lib/components/SafetyButton.svelte';
	let { snapshot }: { snapshot: PrinterSnapshot } = $props();
	const account = $derived(page.data.user?.id ?? '');
	const owner = $derived(page.data.user?.role === 'owner');
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	const journalReady = $derived(
		mounted && printActionJournal.account === account && printActionJournal.ready
	);
	let pending = $state(false),
		message = $state('');

	$effect(() => {
		printActionJournal.activate(account);
		printActionJournal.observe(account, snapshot.actions);
	});
	const entry = $derived(
		printActionJournal.account === account ? printActionJournal.entries[0] : undefined
	);
	const safetyReview = $derived(
		snapshot.safety?.actions.some((a) => a.status === 'unknown' && !a.reviewedAt)
	);
	const operationsPending = $derived(
		snapshot.actions.some((a) => ['queued', 'sending'].includes(a.status)) ||
			snapshot.safety?.actions.some((a) => ['queued', 'sending'].includes(a.status))
	);
	const blocked = $derived(
		Boolean(
			operationsPending ||
			snapshot.safety?.halted ||
			snapshot.liveRecovery ||
			safetyReview ||
			entry ||
			printActionJournal.error
		)
	);
	async function reconcile() {
		if (!entry || pending) return;
		const id = entry.id,
			actor = account;
		pending = true;
		message = '';
		try {
			const result = await reconcilePrintAction({ id, accountId: actor });
			printActionJournal.observe(actor, [result]);
			if (actor === account)
				message =
					result.status === 'unknown' && !result.reviewedAt
						? 'The action reached the server. Complete the printer check above to restore controls.'
						: ['queued', 'sending'].includes(result.status)
							? 'The action is still running. Wait for its result here.'
							: 'Submission resolved. No command was sent again.';
		} catch {
			if (actor === account) message = 'Could not check the submission. Try again when connected.';
		} finally {
			pending = false;
		}
	}
</script>

<div class="page-frame serif recovery-page">
	<h1>Restore print controls</h1>
	<p>
		Resolve the items below to continue printing. Checking an outcome never repeats the command.
	</p>
	{#if !owner && (snapshot.safety?.halted || snapshot.liveRecovery || safetyReview)}<p>
			An owner must complete the printer checks below.
		</p>{/if}
	{#if owner && snapshot.safety?.halted}<section class="panel">
			<EmergencyRecovery {snapshot} />
		</section>{/if}
	{#if snapshot.liveRecovery}<section class="panel">
			{#if snapshot.safety?.halted}<p>
					The uncertain print action also needs a printer check after emergency recovery.
				</p>{/if}
			{#if owner && !snapshot.safety?.halted}
				{#if ['printing', 'paused'].includes(snapshot.job.state)}<SafetyButton
						{snapshot}
						intent="stop"
						label="Stop current job"
					/>{/if}
				{#if snapshot.zProbe?.active}<SafetyButton
						{snapshot}
						intent="abortProbe"
						label="Abort manual probe"
					/>{/if}
				<LiveActionRecovery {snapshot} inline />
			{/if}
		</section>{/if}
	{#if safetyReview}<section class="panel">
			<h2>Confirm the safety action outcome</h2>
			<p>
				Stop movement and turn off heater targets before confirming. This check is separate from the
				uncertain print action.
			</p>
			{#if owner}{#if ['printing', 'paused'].includes(snapshot.job.state)}<SafetyButton
						{snapshot}
						intent="stop"
						label="Stop current job"
					/>{/if}{#if snapshot.zProbe?.active}<SafetyButton
						{snapshot}
						intent="abortProbe"
						label="Abort manual probe"
					/>{/if}<SafetyButton {snapshot} intent="cooldown" label="Turn off heaters" /><SafetyButton
					{snapshot}
					intent="review"
					label="Confirm printer is safe"
				/>{/if}
		</section>{/if}
	{#if entry}<section class="panel">
			<h2>Resolve the pending print submission</h2>
			<p>{entry.label} has not been confirmed in this browser.</p>
			<button class="button primary" disabled={pending} onclick={reconcile}
				>Check submission outcome</button
			>
			<details>
				<summary>Technical details</summary><a href={`/actions/${entry.id}`}>Action record</a>
			</details>
		</section>{/if}
	{#if printActionJournal.error}<p role="alert">{printActionJournal.error}</p>{/if}
	<div class="result" role="status">
		{operationsPending
			? 'A printer action is still running. Its result will appear here.'
			: message}
	</div>
	{#if journalReady && !blocked}<section class="panel">
			<h2>Print recovery is resolved</h2>
			<p>
				No outstanding print or safety recovery remains. Other printer readiness checks still apply.
			</p>
			<a class="button primary" href="/jobs">Return to jobs</a>
		</section>{/if}
</div>

<style>
	.recovery-page {
		display: grid;
		gap: 1rem;
	}
	.panel {
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	.result {
		min-height: 3rem;
	}
	details {
		margin-top: 1rem;
	}
</style>
