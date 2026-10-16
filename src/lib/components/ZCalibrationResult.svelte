<script lang="ts">
	import { onMount } from 'svelte';
	import type { LiveZSession, ZProbeCapability } from '#lib/domain/live-z.js';
	import type { ConfigRecovery } from '#lib/domain/config-application.js';
	let {
		session,
		capability,
		role,
		readRecovery = async (signal: AbortSignal) => {
			const response = await fetch('/api/configuration/application', { cache: 'no-store', signal });
			if (!response.ok) throw Error('Recovery status is unavailable.');
			return response.json() as Promise<ConfigRecovery>;
		}
	}: {
		session: LiveZSession;
		capability?: ZProbeCapability;
		role: string;
		readRecovery?: (signal: AbortSignal) => Promise<ConfigRecovery>;
	} = $props();
	let recovery = $state<ConfigRecovery | null>(null),
		unavailable = $state(false);
	const application = $derived(
		recovery?.application?.calibrationRun === session.id ? recovery.application : null
	);
	const saved = $derived(
		application?.mode === 'calibration' &&
			application.phase === 'ready' &&
			application.writeVerified
	);
	const reverted = $derived(
		application?.mode === 'revert' && application.phase === 'ready' && application.writeVerified
	);
	const applying = $derived(
		application && ['queued', 'writing', 'restarting'].includes(application.phase)
	);
	const changed = $derived(
		session.previousOffset !== null &&
			session.previousOffset !== undefined &&
			session.candidate !== null
			? session.candidate - session.previousOffset
			: null
	);
	onMount(() => {
		if (role !== 'owner') return;
		let active = true,
			busy = false;
		let controller: AbortController | undefined;
		async function refresh() {
			if (!active || busy) return;
			busy = true;
			controller = new AbortController();
			try {
				const result = await readRecovery(controller.signal);
				if (active) {
					recovery = result;
					unavailable = false;
				}
			} catch {
				if (active) unavailable = true;
			} finally {
				busy = false;
			}
		}
		void refresh();
		const timer = setInterval(() => void refresh(), 3000);
		return () => {
			active = false;
			clearInterval(timer);
			controller?.abort();
		};
	});
</script>

<section class="result" aria-label="Z calibration result">
	<p class="eyebrow">Paper test complete</p>
	<h3>
		{reverted
			? 'Previous configuration restored'
			: saved
				? 'Saved & startup verified'
				: applying
					? 'Saving & restarting'
					: application?.phase === 'unknown'
						? 'Save outcome unknown'
						: application?.phase === 'error'
							? 'Save needs attention'
							: session.stage === 'staged'
								? 'Accepted · waiting to save'
								: 'Accepted result'}
	</h3>
	<dl>
		<div>
			<dt>Paper-test Z coordinate</dt>
			<dd>
				{session.paperZ?.toFixed(3) ?? 'Not recorded'}{session.paperZ !== undefined ? ' mm' : ''}
			</dd>
		</div>
		<div>
			<dt>
				{session.method === 'probe' ? 'Probe Z offset' : 'Z endstop position'}
				{#if session.setting}<code>{session.setting}</code>{/if}
			</dt>
			<dd>
				{session.previousOffset?.toFixed(3) ?? '—'} →
				<strong>{session.candidate?.toFixed(3) ?? '—'} mm</strong>{#if changed !== null}<span
						>Change {changed > 0 ? '+' : ''}{changed.toFixed(3)} mm</span
					>{/if}
			</dd>
		</div>
	</dl>
	<p>
		The paper-test coordinate locates the nozzle. Klipper calculates a separate {session.method ===
		'probe'
			? 'probe offset'
			: 'endstop position'} from that observation; these numbers do not represent the same measurement.
	</p>
	{#if saved}<p role="status">
			The reviewed file bytes and a fresh Klipper startup were verified. {capability?.configuredOffset ===
			session.candidate
				? 'The current configured setting matches this result.'
				: 'Review the current configured value before relying on this earlier result.'}
		</p>
	{:else if reverted}<p role="status">
			This save was reverted and the restored configuration completed startup. The accepted
			measurement is retained here for reference.
		</p>
	{:else if applying}<p role="status">
			Follow configuration recovery for the outcome. A request to save is not yet a verified
			startup.
		</p>
	{:else if application && ['error', 'unknown'].includes(application.phase)}<p role="status">
			{application.message} Review configuration recovery before another save.
		</p>
	{:else if capability?.pending}<p role="status">
			Klipper has pending settings. This result is not confirmed saved; review every pending change
			before saving and restarting.
		</p>
	{:else}<p role="status">
			There are no pending settings, but that alone does not prove this result was saved. Changes
			may have been saved or discarded outside this flow.
		</p>{/if}
	{#if unavailable}<p class="muted">
			Save status could not be refreshed. Any verification shown above is from the last successful
			check.
		</p>{/if}
	{#if role === 'owner'}<a
			class="button secondary"
			href="/configuration#configuration-recovery"
			data-sveltekit-reset="false"
			>{saved ? 'Review save or revert…' : 'Review configuration & recovery'}</a
		>{:else}<p class="muted">
			An owner can review saving and snapshot recovery in Configuration.
		</p>{/if}
</section>

<style>
	.result {
		margin: 1.25rem 0;
		padding: 1.25rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: 0.8rem;
		background: var(--surface);
	}
	h3 {
		margin: 0.4rem 0 1rem;
	}
	dl {
		margin: 0;
	}
	dl div {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		padding: 0.65rem 0;
		border-bottom: 1px solid var(--border);
	}
	dt,
	dd {
		overflow-wrap: anywhere;
	}
	dd {
		margin: 0;
	}
	dd span {
		display: block;
		font-size: 0.85rem;
		color: var(--muted);
		margin-top: 0.25rem;
	}
	dt code {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
	p {
		margin: 0.8rem 0;
		line-height: 1.6;
	}
	.button {
		max-width: 100%;
		white-space: normal;
		text-align: center;
	}
	.muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
	@media (max-width: 400px) {
		dl div {
			grid-template-columns: 1fr;
			gap: 0.3rem;
		}
	}
</style>
