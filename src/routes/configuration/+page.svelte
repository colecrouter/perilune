<script lang="ts">
	import {
		getConfigurationDocument,
		saveConfiguration,
		applyConfiguration,
		readConfiguration
	} from './configuration.remote.js';
	import { calibrationHandoff } from '#lib/client/calibration-draft.svelte.js';
	import { untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import AppShell from '#lib/components/AppShell.svelte';
	import PendingConfiguration from '#lib/components/PendingConfiguration.svelte';
	import ConfigurationRecovery from '#lib/components/ConfigurationRecovery.svelte';
	import ConfigurationEditor from '#lib/components/ConfigurationEditor.svelte';
	import type { ConfigSources } from '#lib/domain/config-sources.js';
	import type { ConfigDocument, ConfigSave, ConfigSaved } from '#lib/domain/configuration.js';
	let { data } = $props();
	let dirty = $state(false);
	let applicationEnabled = $state(false);
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
	const read = async (path: string) => {
		const document = getConfigurationDocument(path);
		await document.refresh();
		return document;
	};
	const resolveSources = async () => {
		const sources = readConfiguration({ sources: '@main' });
		await sources.refresh();
		return (await sources) as ConfigSources;
	};
	const save = (request: ConfigSave) => saveConfiguration({ ...request });
	const apply = async (
		request: ConfigSave & { sources?: { root: string; fingerprint: string } }
	) => {
		await applyConfiguration({ ...request, action: 'apply', confirmedRestart: true });
	};
	const backup = async (path: string, id: string) =>
		((await readConfiguration({ file: path, backup: id })) as { text: string }).text;
</script>

<svelte:head><title>Configuration · Perilune</title></svelte:head>
<AppShell active="Configuration"
	><div class="config-page page-frame serif">
		<header>
			<h1>Configuration</h1>
		</header>
		{#if !data.allowed}<section class="panel">
				<h2>Owner access required</h2>
				<p>
					Configuration files can contain credentials and private macros. An owner account is
					required to browse, edit, or export them.
				</p>
			</section>{:else}
			<ConfigurationRecovery onEnabled={(value) => (applicationEnabled = value)} />
			{#if applicationEnabled}<PendingConfiguration />{/if}
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
					{applicationEnabled}
					onApply={apply}
					onResolveSources={resolveSources}
					onBackup={backup}
					calibrationProposal={calibrationHandoff.proposal?.ownerId === data.user?.id
						? calibrationHandoff.proposal
						: null}
					onDismissProposal={() => (calibrationHandoff.proposal = null)}
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
	header {
		margin-bottom: 2rem;
	}
	.panel {
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
	}
</style>
