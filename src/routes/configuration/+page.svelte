<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import AppShell from '#lib/components/AppShell.svelte';
	import ConfigurationEditor from '#lib/components/ConfigurationEditor.svelte';
	import type { ConfigDocument, ConfigSave, ConfigSaved } from '#lib/domain/configuration.js';
	let { data } = $props();
	let dirty = $state(false);
	let retained = $state(untrack(() => data.document));
	let retainedFiles = $state(untrack(() => data.files));
	$effect(() => {
		if (!data.allowed) {
			retained = null;
			retainedFiles = [];
			dirty = false;
		} else if (data.document) {
			retained = data.document;
			retainedFiles = data.files;
		}
	});
	beforeNavigate((navigation) => {
		if (
			dirty &&
			navigation.to?.url.pathname !== '/configuration' &&
			!window.confirm(
				'Leave configuration with unsaved drafts? Export or save them first to keep your changes.'
			)
		)
			navigation.cancel();
	});
	async function api<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, { ...init, cache: 'no-store' });
		if (!response.ok) {
			let message = 'Configuration request failed. Your draft is unchanged.';
			try {
				const body = await response.json();
				message = body.message ?? message;
			} catch {
				/* Leave the draft available on unexpected responses. */
			}
			throw new Error(message);
		}
		return response.json();
	}
	const read = (path: string) =>
		api<ConfigDocument>(`/api/configuration?file=${encodeURIComponent(path)}`);
	const save = (request: ConfigSave) =>
		api<ConfigSaved>('/api/configuration', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request)
		});
	const backup = async (path: string, id: string) =>
		(
			await api<{ text: string }>(
				`/api/configuration?file=${encodeURIComponent(path)}&backup=${encodeURIComponent(id)}`
			)
		).text;
</script>

<svelte:head><title>Configuration · Perilune</title></svelte:head>
<AppShell active="Configuration"
	><div class="config-page serif">
		<header>
			<p class="eyebrow">Know what your printer is told</p>
			<h1>Configuration</h1>
			<p class="muted">Understand a setting. Keep the source. Review every change.</p>
		</header>
		{#if !data.allowed}<section class="panel">
				<h2>Owner access required</h2>
				<p>
					Configuration files can contain credentials and private macros. An owner account is
					required to browse, edit, or export them.
				</p>
			</section>{:else}
			{#if data.issue}<section class="panel">
					<h2>Could not open that file</h2>
					<p role="alert">
						{data.issue}
						{retained ? 'Your open file and drafts have been kept.' : ''}
					</p>
					<a href="/configuration">Return to configuration files →</a>
				</section>{/if}
			{#if retained}<ConfigurationEditor
					document={retained}
					files={retainedFiles}
					onRead={read}
					onSave={save}
					onBackup={backup}
					onDirty={(value) => (dirty = value)}
				/>
			{:else if !data.issue}<section class="panel">
					<h2>No supported configuration files</h2>
					<p>
						Text files up to 256 KiB with cfg, conf, ini, yaml, yml, or json extensions appear here
						when available.
					</p>
				</section>{/if}
		{/if}
	</div></AppShell
>

<style>
	.config-page {
		padding: clamp(1rem, 3vw, 2.5rem);
	}
	header {
		margin-bottom: 2rem;
	}
	h1 {
		margin: 0.4rem 0;
		font-size: clamp(2.2rem, 5vw, 3rem);
	}
	.muted {
		color: var(--muted);
	}
	.panel {
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
	}
</style>
