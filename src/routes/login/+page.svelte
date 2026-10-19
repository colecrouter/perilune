<script lang="ts">
	import AccountEntry from '#lib/components/AccountEntry.svelte';
	let { data } = $props();
</script>

<AccountEntry mode="login" signedIn={Boolean(data.user)} />
