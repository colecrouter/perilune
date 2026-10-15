<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { ReferenceCatalogue } from '#lib/domain/klipper-reference.js';
	let {
		value,
		path,
		disabled = false,
		onChange,
		reference = null
	}: {
		value: string;
		path: string;
		disabled?: boolean;
		onChange: (value: string) => void;
		reference?: ReferenceCatalogue | null;
	} = $props();
	let host: HTMLDivElement;
	let ready = $state(false),
		failed = $state(false);
	let editor:
		ReturnType<typeof import('../editor/config-editor.js').createConfigEditor> | undefined;
	onMount(() => {
		let disposed = false;
		void import('../editor/config-editor.js')
			.then(({ createConfigEditor }) => {
				if (disposed) return;
				untrack(() => {
					editor = createConfigEditor(
						host,
						value,
						path,
						disabled,
						(next) => onChange(next),
						reference
					);
				});
				ready = true;
			})
			.catch(() => {
				if (!disposed) failed = true;
			});
		return () => {
			disposed = true;
			editor?.destroy();
		};
	});
	$effect(() => {
		const next = value;
		if (ready) editor?.setValue(next);
	});
	$effect(() => {
		const locked = disabled;
		if (ready) editor?.setDisabled(locked);
	});
	$effect(() => {
		const next = reference;
		if (ready) editor?.setReference(next);
	});
</script>

<p id="config-editor-help" class="help">
	Search with Ctrl/⌘ F. Use Esc, then Tab to leave the editor. Formatting stays yours. Hover a
	property for help, or use Ctrl/⌘ Shift Space.
</p>
<div class="source" bind:this={host}></div>
{#if !ready}<textarea
		aria-label="Editable configuration source"
		spellcheck="false"
		value={value.replace(/\r\n/g, '\n')}
		disabled={disabled || !failed}
		oninput={(event) => onChange(event.currentTarget.value)}></textarea>
	<p class="help" role="status">
		{failed
			? 'Enhanced editor unavailable. Plain text editing is available.'
			: 'Loading source editor…'}
	</p>{/if}

<style>
	.source {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		--code-heading: #5966a0;
		--code-property: #176c68;
		--code-keyword: #80568d;
		--code-number: #96562b;
		--code-string: #4c703c;
		--code-comment: #72766f;
		--code-active: #7d829a0d;
		--code-selection: #a9b1e055;
	}
	:global([data-theme='dark']) .source {
		--code-heading: #c5c7f4;
		--code-property: #83c7c0;
		--code-keyword: #d5a9df;
		--code-number: #e5b68d;
		--code-string: #b4c991;
		--code-comment: #a0a9b6;
		--code-active: #c1c7eb0c;
		--code-selection: #8c95d755;
	}
	@media (prefers-color-scheme: dark) {
		.source {
			--code-heading: #c5c7f4;
			--code-property: #83c7c0;
			--code-keyword: #d5a9df;
			--code-number: #e5b68d;
			--code-string: #b4c991;
			--code-comment: #a0a9b6;
			--code-active: #c1c7eb0c;
			--code-selection: #8c95d755;
		}
	}
	.help {
		font-size: 0.75rem;
		color: var(--muted);
		line-height: 1.6;
		margin: 0.6rem 0;
	}
	textarea {
		width: 100%;
		min-height: 420px;
		background: var(--canvas);
		color: var(--text);
		font: 0.85rem/1.7 monospace;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.65rem;
	}
</style>
