<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
	import SafetyConfirmation from '#lib/components/SafetyConfirmation.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Printer safety · Perilune</title></svelte:head>
<AppShell
	><main>
		{#if form?.message}<p role="alert">{form.message}</p>{/if}<SafetyConfirmation
			intent={data.intent}
			snapshot={data.snapshot}
		/>
		<p><a href="/">Return to overview</a></p>
	</main></AppShell
>

<style>
	main {
		padding: 2rem;
		max-width: 42rem;
	}
</style>
