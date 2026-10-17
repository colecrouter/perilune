<script lang="ts">
	import BrowserPairing from '#lib/components/BrowserPairing.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Approve a browser · Perilune</title></svelte:head>
<BrowserPairing approve signedIn={Boolean(data.user)} />
