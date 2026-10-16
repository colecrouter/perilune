<script lang="ts">
	import type { PendingConfigurationReview } from '#lib/domain/config-application.js';
	let review = $state<PendingConfigurationReview | null>(null);
	let busy = $state(false),
		confirmed = $state(false),
		submitted = $state(false),
		message = $state('');
	async function request(body?: unknown) {
		const response = await fetch('/api/configuration/application' + (body ? '' : '?pending'), {
			cache: 'no-store',
			...(body
				? {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body)
					}
				: {})
		});
		const value = await response.json();
		if (!response.ok) throw Error(value.message ?? 'Configuration request failed.');
		return value;
	}
	async function inspect() {
		busy = true;
		message = '';
		confirmed = false;
		review = null;
		try {
			review = await request();
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Could not review pending settings.';
		} finally {
			busy = false;
		}
	}
	async function save() {
		if (!review || !confirmed || busy || submitted) return;
		busy = true;
		submitted = true;
		const id = crypto.randomUUID();
		try {
			await request({
				action: 'savePending',
				id,
				pending: review.fingerprint,
				sources: review.sources,
				confirmedRestart: true
			});
			message =
				'Submitted. Follow configuration recovery above for the saved bytes and startup result.';
		} catch (cause) {
			message =
				(cause instanceof Error ? cause.message : 'Submission is unconfirmed.') +
				' Check configuration recovery before another request; this action will not be resent.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="panel pending-settings">
	<p class="eyebrow">Calibration → configuration</p>
	<h2>Pending printer settings</h2>
	<p>
		Review everything Klipper has staged before saving. Saving updates the main configuration and
		restarts Klipper. Your previous file is kept for recovery.
	</p>
	<button type="button" onclick={inspect} disabled={busy || submitted}
		>Review pending settings</button
	>
	{#if review}
		<p>
			Saving to <strong>{review.path}</strong>. Includes and the pending values will be checked
			again before dispatch.
		</p>
		<dl>
			{#each Object.entries(review.manifest) as [section, options]}{#each Object.entries(options) as [key, value]}<div
					>
						<dt>[{section}] {key}</dt>
						<dd><code>{value}</code></dd>
					</div>{/each}{/each}
		</dl>
		<label
			><input type="checkbox" bind:checked={confirmed} disabled={busy || submitted} />I reviewed
			every pending setting and am ready to restart the printer.</label
		>
		<button class="primary" type="button" onclick={save} disabled={!confirmed || busy || submitted}
			>Save settings & restart</button
		>
	{/if}
	{#if message}<p role="status">{message}</p>{/if}
</section>

<style>
	.pending-settings {
		margin-bottom: 1.25rem;
	}
	h2 {
		margin: 0.4rem 0;
	}
	dl div {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		border-bottom: 1px solid var(--border);
		padding: 0.6rem 0;
	}
	dd {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		margin: 1rem 0;
	}
</style>
