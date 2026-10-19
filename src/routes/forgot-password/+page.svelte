<script lang="ts">
	import RecoveryEntry from '#lib/components/RecoveryEntry.svelte';
	let { data } = $props();
</script>

<RecoveryEntry mode="forgot" enabled={data.mailEnabled} />
