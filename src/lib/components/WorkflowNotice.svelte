<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		kind = 'progress',
		title,
		children,
		actions
	}: {
		kind?: 'progress' | 'attention';
		title: Snippet;
		children?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div
	class="workflow-notice"
	class:attention={kind === 'attention'}
	role={kind === 'attention' ? 'alert' : 'status'}
>
	<div class="content">
		<strong>{@render title()}</strong>{#if children}{@render children()}{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.workflow-notice {
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: 0.65rem;
		padding: 1rem;
		overflow-wrap: anywhere;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.attention {
		border-left-color: var(--danger, #bf4343);
	}
	.content {
		min-width: 0;
		flex: 1;
	}
	.actions {
		flex-shrink: 0;
	}
	@media (max-width: 600px) {
		.workflow-notice {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
