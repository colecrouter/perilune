<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
	import ActionForm from '#lib/components/ActionForm.svelte';
	let { data, form } = $props();
	let coolBed = $state('true'),
		coolNozzle = $state('true'),
		confirmed = $state(false);
</script>

<svelte:head><title>Review printer action · Perilune</title></svelte:head>
<AppShell active="Controls"
	><main class="result serif">
		{#if form?.message}<h1>Action not submitted</h1>
			<p role="alert">{form.message}</p>{/if}
		{#if data.review}<h1>
				{data.review.intent === 'cancel' ? 'Stop this print?' : 'Start this print?'}
			</h1>
			<p>{data.review.intent === 'cancel' ? data.review.filename : data.review.name}</p>
			<ActionForm
				fields={data.review.intent === 'cancel'
					? { intent: 'cancel', filename: data.review.filename, runId: data.review.runId }
					: { intent: 'start', fileId: data.review.fileId }}
				>{#snippet children({ pending, uncertain })}
					{#if data.review.intent === 'cancel'}<label
							>Nozzle after stopping<select name="coolNozzle" bind:value={coolNozzle}
								><option value="true">Cool down</option><option value="false">Keep heated</option
								></select
							></label
						><label
							>Bed after stopping<select name="coolBed" bind:value={coolBed}
								><option value="true">Cool down</option><option value="false">Keep heated</option
								></select
							></label
						><label
							><input
								type="checkbox"
								name="confirmed"
								value="true"
								bind:checked={confirmed}
								required
							/> Stop the displayed print</label
						>{:else}<p>
							Check that the bed is clear and the correct filament is loaded before starting. The
							backend checks printer readiness again before execution.
						</p>{/if}
					<button class="button primary" disabled={pending || uncertain}
						>{pending
							? 'Submitting…'
							: data.review.intent === 'cancel'
								? 'Stop print'
								: 'Start print'}</button
					>
				{/snippet}</ActionForm
			>{:else}<p>Choose an action from the printer controls.</p>{/if}
		<p><a href="/">Return to overview</a></p>
		<p>Use your browser’s Back button to return to the previous form.</p>
	</main></AppShell
>

<style>
	.result {
		padding: 2rem;
		max-width: 50rem;
	}
	p {
		margin: 1rem 0;
	}
	label {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin: 1rem 0;
	}
	select {
		padding: 0.6rem;
		font: inherit;
	}
</style>
