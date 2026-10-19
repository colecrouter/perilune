<script lang="ts">
	import { actionStatusLabel } from '#lib/client/action-label.js';
	import AppShell from '#lib/components/AppShell.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Action receipt · Perilune</title></svelte:head>
<AppShell active="Controls"
	><div class="receipt serif">
		<h1>{data.receipt.label}</h1>
		<p role="status">{actionStatusLabel[data.receipt.status]}</p>
		{#if data.receipt.message}<p>{data.receipt.message}</p>{/if}
		<details>
			<summary>Request details</summary>
			<p><code>{data.receipt.id}</code></p>
		</details>
		<p>
			Refreshing this receipt never resubmits the action. Unknown outcomes are never automatically
			replayed.
		</p>
		<a class="button secondary" href={`/actions/${data.receipt.id}`} data-sveltekit-reload
			>Refresh status</a
		> <a href="/">Return to overview</a>
	</div></AppShell
>

<style>
	.receipt {
		padding: 2rem;
		max-width: 50rem;
	}
	p {
		margin: 1rem 0;
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
