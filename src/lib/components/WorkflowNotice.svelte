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
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll retained feedback.) -->
	<div class="content" tabindex="0" role="region" aria-label="Workflow details">
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
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 40%);
		grid-template-rows: minmax(0, 1fr);
		block-size: 9rem;
		box-sizing: border-box;
		align-items: stretch;
		gap: 1rem;
	}
	.attention {
		border-left-color: var(--danger, #bf4343);
	}
	.content {
		min-width: 0;
		min-block-size: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}
	.actions {
		align-self: center;
		max-width: 100%;
		max-block-size: 7.5rem;
		overflow-y: auto;
	}
	@media (max-width: 900px) {
		.content {
			align-self: stretch;
		}
		.workflow-notice {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) auto;
			block-size: 14rem;
		}
	}
</style>
