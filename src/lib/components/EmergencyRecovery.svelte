<script lang="ts">
	import { enhance, applyAction, type SubmitFunction } from '$app/forms';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import ActionForm from './ActionForm.svelte';
	let { snapshot }: { snapshot: PrinterSnapshot } = $props();
	let pending = $state(false),
		failure = $state('');
	const recovery = $derived(snapshot.safety?.recovery);
	const restart = $derived(snapshot.safety?.actions.find((a) => a.id === recovery?.restartId));
	const working = $derived(
		pending || snapshot.safety?.actions.some((a) => ['queued', 'sending'].includes(a.status))
	);
	const ready = $derived(
		snapshot.connection === 'connected' && snapshot.klippy === 'ready' && snapshot.telemetryReady
	);
	const canRestart = $derived(
		snapshot.connection === 'connected' &&
			['shutdown', 'error'].includes(snapshot.klippy) &&
			(!recovery?.restartId || restart?.status === 'failed')
	);
	const update: SubmitFunction = ({ cancel }) => {
		if (working) {
			cancel();
			return;
		}
		pending = true;
		failure = '';
		return async ({ result }) => {
			pending = false;
			if (result.type === 'redirect') await applyAction(result);
			else if (result.type !== 'success')
				failure =
					result.type === 'failure' && typeof result.data?.message === 'string'
						? result.data.message
						: 'Could not confirm this update. Check the recovery state before continuing. No firmware restart was submitted by this form.';
		};
	};
</script>

{#if recovery}<section class="recovery" aria-label="Emergency recovery">
		<h2>Recover from emergency stop</h2>
		<p>
			Ordinary controls stay locked until the hazard is reviewed and fresh printer status confirms
			that it is ready, idle, and has every heater target off. This does not resume a print.
		</p>
		<ol>
			<li>
				<h3>Inspect the printer</h3>
				{#if recovery.reviewedAt}<p>
						Hazard review saved. Firmware restart still requires a separate action.
					</p>{:else}<form method="POST" action="/safety" use:enhance={update}>
						<input type="hidden" name="intent" value="acknowledge" /><input
							type="hidden"
							name="actionId"
							value={recovery.token}
						/>
						<label
							><input type="checkbox" name="confirmed" value="true" required disabled={working} /> I have
							inspected the printer and resolved the hazard</label
						>
						<p class="muted">
							You can save this review while Klipper is shut down or the printer is offline. Saving
							it does not unlock controls or restart firmware.
						</p>
						<button class="button secondary" disabled={working}
							>{pending ? 'Saving…' : 'Save hazard review'}</button
						>
					</form>{/if}
			</li>
			<li>
				<h3>Restart firmware</h3>
				{#if recovery.reviewedAt}<ActionForm
						action="/safety"
						receiptBase="/safety"
						receipts={snapshot.safety?.actions}
						fields={{ intent: 'restart', recoveryOf: recovery.token, confirmed: 'true' }}
						>{#snippet children({ pending, uncertain })}<button
								class="button primary"
								disabled={!canRestart || working || pending || uncertain}
								>{pending ? 'Restarting firmware…' : 'Restart firmware'}</button
							>{/snippet}</ActionForm
					>
					{#if !canRestart}<p class="muted">
							{recovery.restartId && restart?.status !== 'failed'
								? 'A restart was already submitted. Check its receipt, then verify readiness; it will not be resent automatically.'
								: ready
									? 'Firmware already reports ready. Verify readiness below.'
									: 'Reconnect Moonraker and wait for Klipper to report shutdown or error before restarting.'}
						</p>{/if}
					{#if restart}<a href={`/safety/${restart.id}`}>Firmware restart receipt</a>{/if}
				{:else}<p class="muted">Save the hazard review first.</p>{/if}
			</li>
			<li>
				<h3>Verify readiness &amp; unlock</h3>
				<p class="muted">
					An acknowledged restart unlocks controls after fresh readiness checks pass. If the
					acknowledgement was lost or firmware was restarted elsewhere, verify here without sending
					another restart.
				</p>
				<form method="POST" action="/safety" use:enhance={update}>
					<input type="hidden" name="intent" value="verify" /><input
						type="hidden"
						name="actionId"
						value={recovery.token}
					/><input type="hidden" name="confirmed" value="true" /><button
						class="button secondary"
						disabled={!recovery.reviewedAt || !ready || working}
						>{pending ? 'Checking…' : 'Verify readiness & unlock'}</button
					>
				</form>
				{#if !ready}<p class="muted">
						Waiting for a connected printer with fresh ready telemetry. If the printer is powered
						off, turn it on before continuing.
					</p>{/if}
			</li>
		</ol>
		{#if failure}<p role="alert">{failure}</p>{/if}
	</section>{/if}

<style>
	.recovery {
		padding: 1rem 0 0.3rem;
		max-width: 55rem;
	}
	h2 {
		font-family: 'Newsreader Variable', Georgia, serif;
		font-size: 1.6rem;
		margin: 0;
	}
	h3 {
		font-size: 1rem;
		margin: 0 0 0.65rem;
	}
	p {
		font-size: 0.85rem;
		line-height: 1.6;
	}
	ol {
		padding-left: 1.4rem;
	}
	li {
		padding: 0.6rem 0;
	}
	label {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		font-size: 0.85rem;
	}
	a {
		color: var(--accent);
		font-size: 0.85rem;
	}
</style>
