<script lang="ts">
	import { actionNotices } from '#lib/client/action-notices.svelte.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	let { snapshot, userId }: { snapshot?: PrinterSnapshot; userId?: string } = $props();
	$effect(() => {
		if (actionNotices.user !== (userId ?? null)) {
			actionNotices.user = userId ?? null;
			actionNotices.dismissed = [];
		}
	});
	const failures = $derived(
		[
			...(snapshot?.actions ?? []).map((action) => ({ ...action, path: '/actions' })),
			...(snapshot?.safety?.actions ?? []).map((action) => ({ ...action, path: '/safety' }))
		]
			.filter(
				(action) => action.status === 'failed' && !actionNotices.dismissed.includes(action.id)
			)
			.sort((a, b) => b.createdAt - a.createdAt)
	);
	function dismiss() {
		actionNotices.dismissed = [...actionNotices.dismissed, ...failures.map((a) => a.id)].slice(
			-100
		);
	}
</script>

{#if failures[0]}{@const latest = failures[0]}
	<aside class="failure-notice" role="alert" aria-label="Action failed">
		<div>
			<strong>{latest.label} failed</strong>
			<p>
				{latest.message ??
					'The action could not be completed. Review its details before trying again.'}
			</p>
			<a href={`${latest.path}/${latest.id}`}>Review action</a>
			{#if failures.length > 1}<a href="/activity">{failures.length} recent failures · Activity</a
				>{/if}
		</div>
		<button type="button" aria-label="Dismiss failure notice" onclick={dismiss}>×</button>
	</aside>
{/if}

<style>
	.failure-notice {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		z-index: 70;
		width: min(26rem, calc(100vw - 2rem));
		box-sizing: border-box;
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--danger, #bf4343);
		border-radius: 0.75rem;
		background: var(--surface);
		box-shadow: 0 8px 28px #0002;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
		max-height: min(18rem, 45dvh);
		overflow: auto;
	}
	p {
		margin: 0.4rem 0;
		line-height: 1.5;
	}
	a {
		color: var(--accent);
		display: block;
		margin-top: 0.4rem;
	}
	button {
		margin-left: auto;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: 1.3rem;
		cursor: pointer;
		padding: 0.2rem 0.5rem;
	}
</style>
