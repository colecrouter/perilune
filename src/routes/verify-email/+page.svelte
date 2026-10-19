<script lang="ts">
	import RecoveryEntry from '#lib/components/RecoveryEntry.svelte';
	let { data } = $props();
</script>

<RecoveryEntry mode="verify" enabled={data.mailEnabled} />
