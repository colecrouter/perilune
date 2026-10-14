<script lang="ts">
	import JobsWorkspace from '#lib/components/JobsWorkspace.svelte';
	let { data, children } = $props();
</script>

<JobsWorkspace {data} />
{@render children()}
