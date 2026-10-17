<script lang="ts">
	import { onMount } from 'svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import { getPrinter } from '../../printer.remote.js';
	let { data } = $props();
	const printer = getPrinter();
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
	});
	const snapshot = $derived(printer.current ?? data.snapshot);
</script>

<svelte:head><title>Safety activity · Perilune</title></svelte:head>
<AppShell {snapshot}
	><div class="safety-history serif">
		<p class="eyebrow">Printer activity</p>
		<h1>Safety activity</h1>
		<p class="muted">
			Recent emergency and recovery actions. Open an action for its acknowledgement, observed
			outcome, and review details.
		</p>
		<section class="panel">
			{#each snapshot.safety?.actions ?? [] as action (action.id)}<article>
					<div>
						<a href={`/safety/${action.id}`}>{action.label}</a><small
							>{new Date(action.createdAt).toLocaleString()}</small
						>{#if action.message}<p>{action.message}</p>{/if}
					</div>
					<span>{action.status}{action.reviewedAt ? ' · reviewed' : ''}</span>
				</article>{:else}<p>No recent safety actions.</p>{/each}
		</section>
		<a href="/">← Return to overview</a>
	</div></AppShell
>

<style>
	.safety-history {
		max-width: 65rem;
		margin: auto;
		padding: clamp(1rem, 3vw, 2.5rem);
	}
	.panel {
		padding: 1rem;
		margin: 1.5rem 0;
	}
	article {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
	}
	article:last-child {
		border: 0;
	}
	article > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	article > span {
		font-size: 0.8rem;
		flex-shrink: 0;
	}
	small {
		display: block;
		color: var(--muted);
		margin-top: 0.4rem;
	}
	p {
		line-height: 1.6;
	}
	a {
		color: var(--accent);
	}
	@media (max-width: 600px) {
		article {
			flex-direction: column;
			gap: 0.5rem;
		}
	}
</style>
