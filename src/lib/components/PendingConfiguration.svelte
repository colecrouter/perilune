<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	let {
		autoInspect = false,
		saveEnabled = true
	}: { autoInspect?: boolean; saveEnabled?: boolean } = $props();
	let controller: AbortController | undefined;
	onMount(() => {
		if (autoInspect) void inspect();
	});
	onDestroy(() => controller?.abort());
	import type { PendingConfigurationReview } from '#lib/domain/config-application.js';
	let review = $state<PendingConfigurationReview | null>(null);
	let busy = $state(false),
		confirmed = $state(false),
		submitted = $state(false),
		message = $state('');
	async function request(body?: unknown) {
		const response = await fetch('/api/configuration/application' + (body ? '' : '?pending'), {
			cache: 'no-store',
			...(!body ? { signal: controller?.signal } : {}),
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
		controller?.abort();
		controller = new AbortController();
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
		if (!review || !saveEnabled || !confirmed || busy || submitted) return;
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
			message = 'Submitted. Configuration status will show the saved bytes and startup result.';
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
	<h2>Settings waiting to be saved</h2>
	<p>
		These changes are staged in Klipper and are not saved yet. Review <strong
			>every pending setting</strong
		>, including changes from other calibrations or printer apps. Saving updates the main
		configuration, keeps a recovery copy, and restarts Klipper.
	</p>
	<button class="button secondary" type="button" onclick={inspect} disabled={busy || submitted}
		>{busy && !review
			? 'Loading pending settings…'
			: review
				? 'Refresh pending settings'
				: autoInspect
					? 'Try reviewing again'
					: 'Review pending settings'}</button
	>
	{#if review}
		<p>
			These settings will be saved to <strong>{review.path}</strong>.
		</p>
		<dl>
			{#each Object.entries(review.manifest) as [section, options]}{#each Object.entries(options) as [key, value]}<div
					>
						<dt>[{section}] {key}</dt>
						<dd><code>{value}</code></dd>
					</div>{/each}{/each}
		</dl>
		{#if !saveEnabled}<p class="muted">
				Saving is currently unavailable. Check configuration status before continuing.
			</p>{/if}
		<label
			><input
				type="checkbox"
				bind:checked={confirmed}
				disabled={busy || submitted || !saveEnabled}
			/>I reviewed every pending setting and am ready to restart the printer.</label
		>
		<button
			class="button primary"
			type="button"
			onclick={save}
			disabled={!saveEnabled || !confirmed || busy || submitted}>Save settings & restart</button
		>
	{/if}
	{#if message}<p role={submitted ? 'status' : 'alert'}>{message}</p>{/if}
</section>

<style>
	.pending-settings {
		margin-bottom: 1.25rem;
	}
	.pending-settings > p {
		margin: 0.75rem 0;
	}
	input[type='checkbox'] {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		accent-color: var(--accent);
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
