<script lang="ts">
	import { onMount } from 'svelte';
	import { installation, type InstallPrompt } from '#lib/client/install.svelte.js';
	import { updated } from '$app/state';
	let waiting = $state<ServiceWorker | null>(null);
	let dismissed = $state(false);
	let pending = $state(false);
	onMount(() => {
		const capture = (event: Event) => {
			event.preventDefault();
			installation.prompt = event as InstallPrompt;
		};
		const installed = () => {
			installation.prompt = null;
		};
		window.addEventListener('beforeinstallprompt', capture);
		window.addEventListener('appinstalled', installed);
		if (!('serviceWorker' in navigator))
			return () => {
				window.removeEventListener('beforeinstallprompt', capture);
				window.removeEventListener('appinstalled', installed);
			};
		let active = true;
		let registration: ServiceWorkerRegistration | undefined;
		let installing: ServiceWorker | null = null;
		const changed = () => {
			if (active && registration?.waiting) waiting = registration.waiting;
		};
		const found = () => {
			installing = registration?.installing ?? null;
			installing?.addEventListener('statechange', changed);
		};
		void navigator.serviceWorker.ready.then((value) => {
			if (!active || !value) return;
			registration = value;
			changed();
			found();
			value.addEventListener('updatefound', found);
			void value.update().catch(() => {});
		});
		return () => {
			active = false;
			window.removeEventListener('beforeinstallprompt', capture);
			window.removeEventListener('appinstalled', installed);
			registration?.removeEventListener('updatefound', found);
			installing?.removeEventListener('statechange', changed);
		};
	});
	function reload() {
		pending = true;
		if (waiting) {
			navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
				once: true
			});
			waiting.postMessage('ACTIVATE_UPDATE');
		} else location.reload();
	}
</script>

{#if (waiting || updated.current) && !dismissed}
	<aside aria-label="App update" class="app-update">
		<div>
			<strong>A new Perilune is ready</strong>
			<p>Save your edits before reloading.</p>
		</div>
		<button disabled={pending} onclick={reload}>{pending ? 'Updating…' : 'Reload to update'}</button
		><button onclick={() => (dismissed = true)}>Later</button>
	</aside>
{/if}

<style>
	.app-update {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		left: 1rem;
		z-index: 100;
		max-width: 36rem;
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		padding: 1rem;
		box-shadow: 0 8px 30px #0003;
	}
	p {
		margin: 0.25rem 0 0;
		color: var(--muted);
	}
	button {
		min-height: 44px;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
		color: inherit;
		cursor: pointer;
	}
</style>
