<script lang="ts">
	import { onMount } from 'svelte';
	import type { ConfigRecovery } from '#lib/domain/config-application.js';
	let {
		compact = false,
		onEnabled,
		onDiscardEnabled
	}: {
		compact?: boolean;
		onEnabled?: (value: boolean) => void;
		onDiscardEnabled?: (value: boolean) => void;
	} = $props();
	let recovery = $state<ConfigRecovery | null>(null),
		failure = $state(''),
		networkFailure = $state(''),
		busy = $state(false),
		confirmed = $state(false);
	let controller: AbortController | undefined;
	let active = false;
	const application = $derived(recovery?.application);
	const pending = $derived(
		application && ['queued', 'writing', 'restarting'].includes(application.phase)
	);
	async function refresh() {
		if (!active) return;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		try {
			const response = await fetch('/api/configuration/application', {
				cache: 'no-store',
				signal: request.signal
			});
			if (!response.ok)
				throw new Error(
					'Recovery status unavailable. Keep your draft and check again before sending another operation.'
				);
			const result = await response.json();
			if (request.signal.aborted) return;
			recovery = result;
			onEnabled?.(
				Boolean(
					result.enabled &&
					!['queued', 'writing', 'restarting', 'unknown'].includes(result.application?.phase)
				)
			);
			onDiscardEnabled?.(
				Boolean(
					(result.discardEnabled ?? result.enabled) &&
					!['queued', 'writing', 'restarting', 'unknown'].includes(result.application?.phase)
				)
			);
			networkFailure = '';
		} catch (cause) {
			onEnabled?.(false);
			onDiscardEnabled?.(false);
			if (!request.signal.aborted)
				networkFailure = cause instanceof Error ? cause.message : 'Recovery status unavailable.';
		}
	}
	onMount(() => {
		active = true;
		void refresh();
		const timer = setInterval(() => {
			if (!busy) void refresh();
		}, 3000);
		return () => {
			active = false;
			clearInterval(timer);
			controller?.abort();
		};
	});
	async function action(kind: 'check' | 'revert') {
		if (!application || busy || (kind === 'revert' && !confirmed)) return;
		busy = true;
		failure = '';
		try {
			const response = await fetch('/api/configuration/application', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					kind === 'check'
						? { action: kind, id: application.id }
						: {
								action: kind,
								id: crypto.randomUUID(),
								revertOf: application.id,
								confirmedRestart: true
							}
				)
			});
			const body = await response.json();
			if (!active) return;
			if (!response.ok) throw new Error(body.message ?? 'Recovery request failed.');
			confirmed = false;
			await refresh();
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Recovery request failed.';
		} finally {
			busy = false;
		}
	}
</script>

{#if (application && (!compact || application.phase !== 'ready')) || failure || networkFailure}
	<section
		id={compact ? undefined : 'configuration-recovery'}
		class:compact
		class="recovery"
		aria-label="Configuration recovery"
	>
		<h2>
			{pending
				? application?.mode === 'discard'
					? 'Discarding pending settings'
					: 'Applying configuration'
				: application?.phase === 'ready'
					? 'Configuration startup verified'
					: 'Configuration needs attention'}
		</h2>
		{#if application}<p>{application.message}</p>
			{#if compact}<a href="/configuration#configuration-recovery">Open configuration recovery →</a
				>{:else}
				<p class="muted">
					{application.path} · Updated {new Date(application.updatedAt).toLocaleString()}
				</p>
				<p class="snapshot-links">
					<a href={`/api/configuration/application?snapshot=${application.id}&side=before`}
						>Export previous file</a
					>
					·
					<a href={`/api/configuration/application?snapshot=${application.id}&side=after`}
						>Export proposed file</a
					>
				</p>
				{#if application.diagnostic}<pre
						aria-label="Klipper startup diagnostic">{application.diagnostic}</pre>{/if}
				{#if !pending}<button disabled={busy} onclick={() => action('check')}
						>Check printer and saved settings</button
					>
					{#if recovery?.enabled && (application.mode !== 'revert' ? application.writeVerified : application.phase === 'error')}<label
							><input type="checkbox" bind:checked={confirmed} />Restore the snapshot and restart
							Klipper. Unsaved runtime calibration changes may be lost.</label
						>
						<button class="restore" disabled={busy || !confirmed} onclick={() => action('revert')}
							>{application.mode === 'revert'
								? 'Retry restore and restart'
								: 'Revert changes and restart'}</button
						>{/if}{/if}
			{/if}
		{/if}
		{#if failure || networkFailure}<p role="alert">{failure || networkFailure}</p>
			<button disabled={busy} onclick={refresh}>Refresh recovery status</button>{/if}
	</section>
{/if}

<style>
	.recovery {
		padding: 1.25rem;
		margin: 0 0 1.5rem;
		border: 1px solid var(--border-strong);
		border-left: 4px solid var(--accent);
		border-radius: 0.8rem;
		background: var(--surface);
	}
	h2 {
		margin: 0 0 0.6rem;
		font-family: 'Newsreader Variable', Georgia, serif;
		font-size: 1.4rem;
	}
	p {
		line-height: 1.6;
		margin: 0.6rem 0;
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--muted);
		font-size: 0.8rem;
	}
	pre {
		max-height: 24rem;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		padding: 1rem;
		background: var(--canvas);
		border-radius: 0.5rem;
		font-size: 0.8rem;
	}
	button {
		font: inherit;
		color: var(--text);
		background: var(--canvas);
		border: 1px solid var(--border-strong);
		padding: 0.7rem 1rem;
		border-radius: 0.5rem;
		margin: 0.5rem 0;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	label {
		display: flex;
		align-items: start;
		gap: 0.6rem;
		line-height: 1.6;
		margin: 1rem 0;
	}
	.restore {
		border-color: var(--danger-border);
		color: var(--danger);
	}
	a {
		color: var(--accent);
	}
	.compact {
		margin: 1rem;
	}
</style>
