<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Action receipt · Perilune</title></svelte:head>
<AppShell active="Controls"
	><div class="receipt page-frame serif">
		<h1>{data.receipt.label}</h1>
		<p role="status">{data.receipt.status}</p>
		{#if data.receipt.message}<p>{data.receipt.message}</p>{/if}
		<p>
			Printer acknowledged: {data.receipt.acknowledged ? 'yes' : 'unconfirmed'}. Result observed: {data
				.receipt.observed
				? 'yes'
				: 'unconfirmed'}.
		</p>
		<p>Request <code>{data.receipt.id}</code></p>
		<p>
			Refreshing this receipt never resubmits the action. Unknown outcomes are never automatically
			replayed.
		</p>
		<a class="button secondary" href={`/safety/${data.receipt.id}`} data-sveltekit-reload
			>Refresh status</a
		> <a href="/">Return to overview</a>
	</div></AppShell
>

<style>
	.receipt {
		--page-content-max: 50rem;
	}
	p {
		margin: 1rem 0;
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
