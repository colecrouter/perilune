<script lang="ts">
	import ActionForm from './ActionForm.svelte';
	import type { ActionRecord, PrinterSnapshot } from '#lib/domain/printer.js';
	let {
		intent,
		snapshot,
		receipts
	}: { intent: string; snapshot: PrinterSnapshot; receipts?: ActionRecord[] } = $props();
	const title = $derived(
		intent === 'restart'
			? 'Restart firmware after safety review?'
			: intent === 'abortProbe'
				? 'Abort the current manual probe?'
				: intent === 'emergency'
					? 'Emergency stop printer?'
					: intent === 'stop'
						? 'Stop the current job?'
						: intent === 'review'
							? 'Review safety outcome'
							: 'Turn off all heaters?'
	);
	const fields = $derived<Record<string, string>>(
		intent === 'restart'
			? { intent, recoveryOf: snapshot.safety?.recovery?.token ?? '' }
			: intent === 'stop'
				? {
						intent,
						recoveryOf: snapshot.liveRecovery?.id ?? '',
						filename: snapshot.job.filename ?? '',
						runId: snapshot.job.runId ?? ''
					}
				: intent === 'cooldown' || intent === 'abortProbe'
					? { intent, recoveryOf: snapshot.liveRecovery?.id ?? '' }
					: { intent }
	);
</script>

<h2>{title}</h2>
{#if intent === 'review'}
	<p>
		Inspect the printer. Resolve any hazard. Emergency recovery has its own hazard review and
		firmware restart steps. Review requires a connected, idle printer with all heater targets off.
		This does not clear the original uncertain action.
	</p>
	<ActionForm
		{receipts}
		action="/safety"
		receiptBase="/safety"
		fields={{
			intent: 'review',
			actionId:
				snapshot.safety?.actions.find((a) => a.status === 'unknown' && !a.reviewedAt)?.id ?? ''
		}}
	>
		{#snippet children({ pending, uncertain })}<label
				><input type="checkbox" name="confirmed" value="true" required /> I have inspected the printer
				and resolved the hazard</label
			><button class="button primary" disabled={pending || uncertain}>Review safety</button
			>{/snippet}
	</ActionForm>
{:else}
	<p>
		{intent === 'restart'
			? 'Records your confirmation that you inspected the printer and resolved the hazard, then restarts Klipper firmware once. Controls remain locked until fresh ready, idle state with heaters off is verified. This does not resume a print.'
			: intent === 'abortProbe'
				? 'Ends the currently observed manual probe helper without accepting or saving its result. The original uncertain action stays locked.'
				: intent === 'emergency'
					? 'Immediately shuts down Klipper. Movement and heating stop; motors may release. Support the gantry if needed. Resolve the hazard before restarting Klipper. This bypasses the normal command queue.'
					: intent === 'stop'
						? `Stops ${snapshot.job.filename ?? 'the displayed job'}. Your printer’s cancel macro runs; it may move the toolhead or turn heaters off. No heater targets will be restored.`
						: 'Sets every heater target to zero. This does not stop a running job or release motors.'}
	</p>
	{#if intent !== 'emergency'}<p>
			The original uncertain action stays locked and will never be replayed.
		</p>{/if}
	<ActionForm {receipts} action="/safety" receiptBase="/safety" {fields}>
		{#snippet children({ pending, uncertain })}
			<label
				><input type="checkbox" name="confirmed" value="true" required /> Confirm {intent ===
				'restart'
					? 'I have inspected the printer, resolved the hazard, and want to restart firmware'
					: intent === 'abortProbe'
						? 'aborting the current manual probe'
						: intent === 'emergency'
							? 'emergency shutdown'
							: intent === 'stop'
								? 'stopping this job'
								: 'turning off all heaters'}</label
			>
			<button
				class={intent === 'emergency' ? 'button danger' : 'button primary'}
				disabled={pending || uncertain}
				>{pending
					? 'Submitting…'
					: intent === 'restart'
						? 'Restart firmware'
						: intent === 'abortProbe'
							? 'Abort manual probe'
							: intent === 'emergency'
								? 'Emergency stop'
								: intent === 'stop'
									? 'Stop job'
									: 'Turn off heaters'}</button
			>
		{/snippet}</ActionForm
	>
{/if}

<style>
	p {
		line-height: 1.6;
		margin: 1rem 0;
	}
	label {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		margin: 1rem 0;
	}
	h2 {
		font-family: 'Newsreader Variable', Georgia, serif;
		font-size: 1.7rem;
	}
</style>
