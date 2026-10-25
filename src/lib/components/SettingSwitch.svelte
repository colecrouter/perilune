<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	let {
		checked = $bindable(false),
		...attributes
	}: Omit<HTMLInputAttributes, 'type' | 'role' | 'checked'> & { checked?: boolean } = $props();
</script>

<span class="setting-switch">
	<input {...attributes} type="checkbox" role="switch" bind:checked />
	<span class="track" aria-hidden="true"><span class="moon"><span></span></span></span>
</span>

<style>
	.setting-switch {
		display: inline-flex;
		position: relative;
		flex: none;
		width: 56px;
		min-height: 44px;
		align-items: center;
		vertical-align: middle;
	}
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		margin: 0;
		cursor: pointer;
		z-index: 1;
	}
	.track {
		width: 56px;
		height: 32px;
		border-radius: 18px;
		border: 1px solid var(--muted);
		background: var(--rail);
		pointer-events: none;
		position: relative;
	}
	.moon {
		position: absolute;
		left: 4px;
		top: 4px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #edece8;
		border: 1px solid #34365c;
		box-shadow: inset -2px -1px 0 #b8bed1;
	}
	.moon span {
		position: absolute;
		left: 6px;
		top: 6px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #a3a9bb;
		box-shadow:
			6px 7px 0 -1px #a3a9bb,
			-2px 9px 0 -1px #a3a9bb;
	}
	input:checked + .track {
		background: var(--accent);
		border-color: var(--accent);
	}
	input:checked + .track .moon {
		transform: translateX(24px);
	}
	input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	input:disabled + .track,
	input:disabled {
		cursor: not-allowed;
	}
	input:disabled + .track {
		opacity: 0.55;
	}
	@media (prefers-reduced-motion: no-preference) {
		.moon {
			transition: transform 120ms ease;
		}
		.track {
			transition: background-color 120ms ease;
		}
	}
	@media (forced-colors: active) {
		.track {
			border-color: ButtonText;
		}
		.moon {
			background: ButtonText;
			box-shadow: none;
		}
		.moon span {
			display: none;
		}
		input:checked + .track {
			background: Highlight;
			border-color: Highlight;
		}
		input:checked + .track .moon {
			background: HighlightText;
		}
		input:focus-visible + .track {
			outline-color: Highlight;
		}
	}
</style>
