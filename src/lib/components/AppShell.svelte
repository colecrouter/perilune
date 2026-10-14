<script lang="ts">
	import MoonMark from './MoonMark.svelte';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	let { children, active = 'Overview' }: { children: Snippet; active?: string } = $props();
	const navigation = [
		{ label: 'Overview', icon: 'overview', href: '/' },
		{ label: 'Controls', icon: 'calibration', href: '/controls' },
		{ label: 'Jobs', icon: 'jobs', href: '/jobs' },
		{ label: 'Calibration', icon: 'calibration', href: '/calibration' },
		{ label: 'Configuration', icon: 'configuration', href: '/roadmap#configuration' },
		{ label: 'Account', icon: 'account', href: '/account' }
	] as const;
</script>

<div class="app-shell">
	<aside class="sidebar">
		<a class="brand" href="/">
			<MoonMark class="brand-mark" />
			<span>Perilune</span>
		</a>
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
