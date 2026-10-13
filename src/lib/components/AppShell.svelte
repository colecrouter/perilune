<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	let { children, active = 'Overview' }: { children: Snippet; active?: string } = $props();
	const navigation = [
		{ label: 'Overview', icon: 'overview', href: '/' },
		{ label: 'Jobs', icon: 'jobs', href: '/roadmap#jobs' },
		{ label: 'Calibration', icon: 'calibration', href: '/roadmap#calibration' },
		{ label: 'Configuration', icon: 'configuration', href: '/roadmap#configuration' }
	] as const;
</script>

<div class="app-shell">
	<aside class="sidebar">
		<a class="brand" href="/">Perilune</a>
		<nav aria-label="Main navigation">
			{#each navigation as item}<a
					href={item.href}
					class:active={active === item.label}
					aria-current={active === item.label ? 'page' : undefined}
					><Icon name={item.icon} /><span>{item.label}</span></a
				>{/each}
		</nav>
		<a
			class="sidebar-footer"
			href="https://github.com/colecrouter/perilune"
			target="_blank"
			rel="noreferrer">Built in the open<small>View development on GitHub</small></a
		>
	</aside>
	<main>{@render children()}</main>
</div>
