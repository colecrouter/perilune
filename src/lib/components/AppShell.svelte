<script lang="ts">
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import { DropdownMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PrinterSafetyRegion from './PrinterSafetyRegion.svelte';
	import ConfigurationRecovery from './ConfigurationRecovery.svelte';
	import MoonMark from './MoonMark.svelte';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	let {
		children,
		active = 'Overview',
		snapshot
	}: { children: Snippet; active?: string; snapshot?: PrinterSnapshot } = $props();
	const navigation = [
		{ label: 'Overview', icon: 'overview', href: '/' },
		{ label: 'Controls', icon: 'calibration', href: '/controls' },
		{ label: 'Jobs', icon: 'jobs', href: '/jobs' },
		{ label: 'Console', icon: 'console', href: '/console' },
		{ label: 'Activity', icon: 'activity', href: '/activity' },
		{ label: 'Calibration', icon: 'calibration', href: '/calibration' },
		{ label: 'Configuration', icon: 'configuration', href: '/configuration' },
		{ label: 'Account', icon: 'account', href: '/account' },
		{ label: 'Help', icon: 'help', href: '/help' }
	] as const;
	const visibleNavigation = $derived(
		navigation.filter((item) => item.label !== 'Activity' || page.data.user?.role !== 'viewer')
	);
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>
<div class="app-shell">
	<aside class="sidebar">
		<a class="brand" href="/">
			<MoonMark class="brand-mark" />
			<span>Perilune</span>
		</a>
		<nav aria-label="Main navigation">
			{#each visibleNavigation as item}
				{#if item.label === 'Calibration'}
					<DropdownMenu.Root
						><DropdownMenu.Trigger
							class={`nav-trigger secondary-destination ${active === 'Calibration' ? 'active' : ''}`}
							aria-label="Calibration"
							><Icon name="calibration" /><span class="calibration-label"
								>Calibration<svg
									class="calibration-chevron"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg
								></span
							></DropdownMenu.Trigger
						><DropdownMenu.Portal
							><DropdownMenu.Content
								class="calibration-menu"
								side="bottom"
								align="start"
								sideOffset={6}
							>
								<DropdownMenu.Group
									><DropdownMenu.GroupHeading class="calibration-menu-heading"
										>Calibration workflows</DropdownMenu.GroupHeading
									>
									{#each [{ href: '/calibration', title: 'Z-offset workshop', description: 'Understand nozzle clearance' }, { href: '/calibration/mesh', title: 'Bed mesh', description: 'Inspect height grids and profiles' }, { href: '/calibration/extrusion', title: 'Filament & extrusion', description: 'Measure extruder travel' }, { href: '/calibration/pid', title: 'PID heater calibration', description: 'Tune temperature control' }] as workflow}
										<DropdownMenu.Item
											>{#snippet child({ props })}<a
													{...props}
													href={resolve(
														workflow.href as
															| '/calibration'
															| '/calibration/mesh'
															| '/calibration/extrusion'
															| '/calibration/pid'
													)}
													class="calibration-menu-item"
													aria-current={page.url.pathname === workflow.href ? 'page' : undefined}
													><strong>{workflow.title}</strong><small>{workflow.description}</small></a
												>{/snippet}</DropdownMenu.Item
										>
									{/each}</DropdownMenu.Group
								>
							</DropdownMenu.Content></DropdownMenu.Portal
						></DropdownMenu.Root
					>
				{:else}<a
						href={item.href}
						class:secondary-destination={!'Overview Controls Jobs Console'
							.split(' ')
							.includes(item.label)}
						class:active={active === item.label}
						aria-current={active === item.label ? 'page' : undefined}
						><Icon name={item.icon} /><span>{item.label}</span></a
					>{/if}
			{/each}

			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class={`nav-trigger mobile-more ${!['Overview', 'Controls', 'Jobs', 'Console'].includes(active) ? 'active' : ''}`}
					aria-label="More navigation"
				>
					<Icon name="more" /><span>More</span>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal
					><DropdownMenu.Content
						class="calibration-menu mobile-navigation-menu"
						side="bottom"
						align="end"
						sideOffset={6}
					>
						<DropdownMenu.Group
							><DropdownMenu.GroupHeading class="calibration-menu-heading"
								>Workshops</DropdownMenu.GroupHeading
							>
							{#each [{ href: '/calibration', title: 'Z-offset' }, { href: '/calibration/mesh', title: 'Bed mesh' }, { href: '/calibration/extrusion', title: 'Filament & extrusion' }, { href: '/calibration/pid', title: 'PID heater tuning' }] as item}
								<DropdownMenu.Item
									>{#snippet child({ props })}<a
											{...props}
											href={item.href}
											class="calibration-menu-item"
											aria-current={page.url.pathname === item.href ? 'page' : undefined}
											>{item.title}</a
										>{/snippet}</DropdownMenu.Item
								>
							{/each}
						</DropdownMenu.Group>
						<DropdownMenu.Separator class="menu-divider" />
						<DropdownMenu.Group
							><DropdownMenu.GroupHeading class="calibration-menu-heading"
								>Manage & help</DropdownMenu.GroupHeading
							>
							{#each visibleNavigation.filter( (item) => ['Activity', 'Configuration', 'Account', 'Help'].includes(item.label) ) as item}
								<DropdownMenu.Item
									>{#snippet child({ props })}<a
											{...props}
											href={item.href}
											class="calibration-menu-item"
											aria-current={active === item.label ? 'page' : undefined}>{item.label}</a
										>{/snippet}</DropdownMenu.Item
								>
							{/each}
						</DropdownMenu.Group>
					</DropdownMenu.Content></DropdownMenu.Portal
				>
			</DropdownMenu.Root>
		</nav>
		<a
			class="sidebar-footer"
			href="https://github.com/colecrouter/perilune"
			target="_blank"
			rel="noreferrer">Built in the open<small>View development on GitHub</small></a
		>
	</aside>
	<main id="main-content" tabindex="-1">
		<PrinterSafetyRegion {snapshot} initial={page.data.initial?.printer} />
		{#if page.data.user?.role === 'owner' && active !== 'Configuration'}<ConfigurationRecovery
				compact
			/>{/if}
		{@render children()}
	</main>
</div>

<style>
	:global(.sidebar nav .mobile-more) {
		display: none;
	}
	:global(.menu-divider) {
		height: 1px;
		background: var(--border);
		margin: 0.35rem 0;
	}
	:global(.mobile-navigation-menu) {
		max-height: calc(100dvh - 140px);
		overflow-y: auto;
	}
	@media (max-width: 600px) {
		:global(.sidebar nav .secondary-destination) {
			display: none;
		}
		:global(.sidebar nav .mobile-more) {
			display: flex;
		}
	}

	.calibration-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	:global(.sidebar nav .calibration-label .calibration-chevron) {
		width: 12px;
		height: 12px;
		flex: none;
	}
	:global(.calibration-menu) {
		z-index: 80;
		width: min(300px, calc(100vw - 24px));
		padding: 0.5rem;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.8rem;
		box-shadow: 0 12px 36px #0003;
	}
	:global(.calibration-menu-heading) {
		padding: 0.65rem 0.75rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	:global(.calibration-menu-item) {
		display: grid;
		gap: 0.3rem;
		padding: 0.8rem 0.75rem;
		border-radius: 0.5rem;
		text-decoration: none;
		color: var(--text);
		outline: none;
	}
	:global(.calibration-menu-item small) {
		color: var(--muted);
	}
	:global(.calibration-menu-item[data-highlighted]),
	:global(.calibration-menu-item[aria-current='page']) {
		background: var(--highlight);
		color: var(--highlight-text);
	}
	:global(.calibration-menu-item[data-highlighted] small),
	:global(.calibration-menu-item[aria-current='page'] small) {
		color: inherit;
	}
	:global(.nav-trigger) {
		width: 100%;
		border: 0;
		background: transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
	}
	@media (max-width: 600px) {
		:global(.nav-trigger) {
			width: auto;
		}
	}
</style>
