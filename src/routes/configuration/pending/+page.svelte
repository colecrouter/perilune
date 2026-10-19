<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
	import PendingConfiguration from '#lib/components/PendingConfiguration.svelte';
	import ConfigurationRecovery from '#lib/components/ConfigurationRecovery.svelte';
	let saveEnabled = $state(false);
</script>

<svelte:head><title>Review pending settings · Perilune</title></svelte:head>
<AppShell active="Configuration">
	<div class="review-page serif">
		<header>
			<a href="/calibration">← Calibration helpers</a>
			<h1>Review pending settings</h1>
			<p>Check the changes, then decide whether to save and restart the printer.</p>
		</header>
		<PendingConfiguration autoInspect {saveEnabled} />
		<ConfigurationRecovery onEnabled={(value) => (saveEnabled = value)} />
		<a href="/configuration">Open configuration files →</a>
	</div>
</AppShell>

<style>
	.review-page {
		max-width: 56rem;
		padding: clamp(1rem, 3vw, 2.5rem);
		margin: 0 auto;
	}
	header {
		margin-bottom: 1.5rem;
	}
	h1 {
		margin: 0.75rem 0;
		font-size: clamp(2.2rem, 5vw, 3rem);
	}
</style>
