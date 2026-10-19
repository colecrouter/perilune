<script lang="ts">
	import type { Snippet } from 'svelte';
	import MoonMark from './MoonMark.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="entry-sky serif">
	<main class="entry-card">
		<a class="entry-brand" href="/"
			><span class="entry-mark"><MoonMark /></span><span>Perilune</span></a
		>{@render children()}
	</main>
	<aside class="entry-context">
		<span class="orbit" aria-hidden="true"></span>
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
	.entry-sky::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background-image: var(--stars);
		background-size: 242px 720px;
		pointer-events: none;
	}
	.entry-card {
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
		width: 22rem;
		color: #e5e1f4;
		line-height: 1.7;
	}
	.entry-context p:last-child {
		font-family: 'Newsreader Variable', serif;
		font-size: 2rem;
		line-height: 1.25;
	}
	.orbit {
		display: block;
		width: 9rem;
		height: 9rem;
		border: 1px solid #e5e1f44d;
		border-radius: 50%;
		position: relative;
		margin-bottom: 2rem;
	}
	.orbit::before {
		content: '';
		position: absolute;
		inset: 1.25rem;
		border: 1px solid #e5e1f42d;
		border-radius: 50%;
	}
	.orbit::after {
		content: '';
		position: absolute;
		top: 0.8rem;
		left: 1.1rem;
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: #e5e1f4;
		box-shadow: 0 0 2rem #e5e1f429;
	}
	@media (max-width: 900px) {
		.entry-context {
			display: none;
		}
		.entry-sky {
			align-items: safe center;
		}
		.entry-card {
			flex-shrink: 1;
		}
	}
</style>
