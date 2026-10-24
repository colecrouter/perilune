<script lang="ts">
	import {
		reviewPendingConfiguration,
		applyConfiguration
	} from '../../routes/configuration/configuration.remote.js';
	import { untrack, onDestroy } from 'svelte';
	let {
		autoInspect = false,
		saveEnabled = true,
		mode = 'save',
		compact = false,
		onSubmitted
	}: {
		autoInspect?: boolean;
		saveEnabled?: boolean;
		mode?: 'save' | 'discard';
		compact?: boolean;
		onSubmitted?: (id: string) => void;
	} = $props();
	let controller: AbortController | undefined;

	onDestroy(() => controller?.abort());
	import type { PendingConfigurationReview } from '#lib/domain/config-application.js';
	let review = $state<PendingConfigurationReview | null>(null);
	let busy = $state(false),
		confirmed = $state(false),
		submitted = $state(false),
		empty = $state(false),
		message = $state('');
	await (async () => {
		if (untrack(() => autoInspect)) {
			try {
				review = await reviewPendingConfiguration();
			} catch (cause) {
				if (cause instanceof Error && cause.message === 'There are no pending calibration changes.')
					empty = true;
				else
					message = cause instanceof Error ? cause.message : 'Could not review pending settings.';
			}
		}
	})();

	async function request(body?: Record<string, unknown>) {
		if (body) return applyConfiguration(body);
		const query = reviewPendingConfiguration();
		await query.refresh();
		return query;
	}

	async function inspect() {
		controller?.abort();
		controller = new AbortController();
		busy = true;
		message = '';
		empty = false;
		confirmed = false;
		try {
			review = (await request()) as PendingConfigurationReview;
		} catch (cause) {
			review = null;
			if (cause instanceof Error && cause.message === 'There are no pending calibration changes.')
				empty = true;
			else message = cause instanceof Error ? cause.message : 'Could not review pending settings.';
		} finally {
			busy = false;
		}
	}
	async function save() {
		if (!review || !saveEnabled || !confirmed || busy || submitted) return;
		busy = true;
		submitted = true;
		const id = crypto.randomUUID();
		onSubmitted?.(id);
		try {
			await request({
				action: mode === 'discard' ? 'discardPending' : 'savePending',
				id,
				pending: review.fingerprint,
				sources: review.sources,
				confirmedRestart: true
			});
			message =
				mode === 'discard'
					? 'Submitted. Configuration status will show whether pending settings cleared and the saved file stayed unchanged.'
					: 'Submitted. Configuration status will show the saved bytes and startup result.';
		} catch (cause) {
			message =
				(cause instanceof Error ? cause.message : 'Submission is unconfirmed.') +
				' Check configuration recovery before another request; this action will not be resent.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="panel pending-settings" class:compact>
	{#if !compact}
		<p class="eyebrow">Calibration → configuration</p>
		<h2>Staged settings</h2>
	{/if}
	{#if message && !submitted}<p role="alert">{message}</p>{/if}
	{#if !compact}<p>
			These changes are staged in Klipper and are not saved yet. Review <strong
				>every pending setting</strong
			>, including changes from other calibrations or printer apps. Saving updates the main
			configuration, keeps a recovery copy, and restarts Klipper.
		</p>{/if}
	<button class="button secondary" type="button" onclick={inspect} disabled={busy || submitted}
		>{busy && !review
			? 'Loading pending settings…'
			: review
				? 'Refresh pending settings'
				: autoInspect
					? 'Try reviewing again'
					: 'Review pending settings'}</button
	>
	{#if empty}<p role="status">
			No pending printer settings. Edits in the configuration editor remain separate drafts.
		</p>{/if}
	{#if review}
		<p>
			{mode === 'discard' ? 'The saved file stays unchanged:' : 'These settings will be saved to'}
			<strong>{review.path}</strong>.
		</p>
		<dl aria-busy={busy} class:loading={busy}>
			{#each Object.entries(review.manifest) as [section, options]}{#each Object.entries(options) as [key, value]}<div
					>
						<dt>[{section}] {key}</dt>
						<dd><code>{value}</code></dd>
					</div>{/each}{/each}
		</dl>
		{#if !saveEnabled}<p class="muted">
				{mode === 'discard'
					? 'Discarding is currently unavailable.'
					: 'Saving is currently unavailable.'} Check configuration status before continuing.
			</p>{/if}
		<label
			><input
				type="checkbox"
				bind:checked={confirmed}
				disabled={busy || submitted || !saveEnabled}
			/>I reviewed every pending setting and {mode === 'discard'
				? 'want to discard them all'
				: 'am ready to save them all'} and restart the printer.</label
		>
		<button
			class={mode === 'discard' ? 'button danger-outline' : 'button primary'}
			type="button"
			onclick={save}
			disabled={!saveEnabled || !confirmed || busy || submitted}
			>{mode === 'discard' ? 'Discard settings & restart' : 'Save settings & restart'}</button
		>
	{/if}
	{#if message && submitted}<p role="status">{message}</p>{/if}
</section>

<style>
	.pending-settings.compact {
		padding: 0;
		margin: 0 0 1.25rem;
		border: 0;
		background: transparent;
	}
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
	.loading code {
		visibility: hidden;
	}
	.loading dd {
		background: var(--border);
		border-radius: 0.25rem;
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
