<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		active = false,
		label = 'Workflow feedback',
		roomy = false,
		children
	}: { active?: boolean; label?: string; roomy?: boolean; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll retained feedback.) -->
<div
	class="feedback-region"
	class:active
	class:roomy
	role={active ? 'region' : undefined}
	aria-label={active ? label : undefined}
	aria-hidden={!active}
	tabindex={active ? 0 : undefined}
>
	{@render children()}
</div>

<style>
	.feedback-region {
		block-size: 4.5rem;
		box-sizing: border-box;
		overflow-y: auto;
		scrollbar-gutter: stable;
		margin-block: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-inline-start: 3px solid transparent;
		overflow-wrap: anywhere;
	}
	.feedback-region.active {
		border-color: var(--accent);
		background: var(--surface);
		border-radius: 0.35rem;
	}
	.feedback-region.roomy {
		block-size: 8rem;
	}
	.feedback-region :global(p) {
		margin: 0;
	}
</style>
