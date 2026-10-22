<script lang="ts">
	import type { Snippet } from 'svelte';
	import MoonMark from './MoonMark.svelte';
	import Starfield from './Starfield.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="entry-sky serif">
	<Starfield />
	<div class="orbit-window" aria-hidden="true">
		<span class="orbit"><span class="orbiter"></span></span>
	</div>
	<main class="entry-card">
		<a class="entry-brand" href="/"
			><span class="entry-mark"><MoonMark /></span><span>Perilune</span></a
		>{@render children()}
	</main>
	<aside class="entry-context">
		<p class="eyebrow">A little closer to your printer</p>
		<p>Your prints, camera and controls.<br />One calm place to come back to.</p>
	</aside>
</div>

<style>
	.entry-sky {
		min-height: 100svh;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: clamp(3rem, 8vw, 8rem);
		padding: clamp(1rem, 4vw, 3rem);
		isolation: isolate;
		position: relative;
		background: var(--rail);
	}
	.entry-card {
		position: relative;
		width: min(100%, 460px);
		flex-shrink: 0;
		background: var(--surface, #faf8f3);
		border: 1px solid var(--border);
		border-radius: 24px;
		padding: clamp(1.5rem, 4vw, 2.5rem);
		box-shadow: 0 24px 80px #060e2140;
	}
	.entry-brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 2rem;
		color: var(--text);
		text-decoration: none;
		margin-bottom: 2rem;
	}
	.entry-brand :global(svg) {
		width: 30px;
		height: 30px;
		flex-shrink: 0;
	}
	.entry-mark {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		background: var(--rail);
		border-radius: 50%;
	}
	.entry-brand span {
		font-family: 'Newsreader Variable', serif;
	}
	.entry-context {
		position: relative;
		width: 22rem;
		color: #e5e1f4;
		line-height: 1.7;
	}
	.entry-context p:last-child {
		font-family: 'Newsreader Variable', serif;
		font-size: 2rem;
		line-height: 1.25;
	}
	.orbit-window {
		position: absolute;
		inset: 0;
		overflow: clip;
		pointer-events: none;
		z-index: -1;
	}
	.orbit {
		--orbit-size: clamp(68rem, 110vw, 110rem);
		position: absolute;
		width: var(--orbit-size);
		height: var(--orbit-size);
		right: calc(50% - 25rem);
		bottom: calc(50% + clamp(-3rem, 18rem - 23vw, 3rem));
		border: 1px dotted #e5e1f44d;
		border-radius: 50%;
	}
	.orbiter {
		position: absolute;
		inset: -1px;
		border-radius: 50%;
		transform: rotate(140deg);
		animation: orbit 180s linear infinite;
	}
	.orbiter::after {
		content: '';
		position: absolute;
		top: 0;
		left: 50%;
		width: 0.8rem;
		height: 0.8rem;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		background: #e5e1f4;
		box-shadow: 0 0 1.5rem #e5e1f429;
	}
	@keyframes orbit {
		from {
			transform: rotate(140deg);
		}
		to {
			transform: rotate(500deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.orbiter {
			animation: none;
		}
	}
	@media (max-width: 900px) {
		.entry-context {
			position: relative;
			display: none;
		}
		.entry-sky {
			align-items: safe center;
		}
		.entry-card {
			position: relative;
			flex-shrink: 1;
		}
	}
</style>
