<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getIntegrations,
		createSlicerKey,
		revokeSlicerKey,
		disconnectSlicer,
		revokePairedBrowser
	} from '../../routes/account/integrations.remote.js';
	let { canOperate = false }: { canOperate?: boolean } = $props();
	let name = $state('Desktop slicer');
	let permission = $state('upload');
	let expiry = $state('never');
	let token = $state('');
	let reveal = $state(false);
	const integrations = getIntegrations();
	const initial = await integrations;
	let keys = $state(initial.keys);
	let browsers = $state(initial.browsers);
	let message = $state('');
	let pending = $state<Record<string, boolean>>({});
	let createMessage = $state('');
	let copyMessage = $state('');
	let rowMessages = $state<Record<string, string>>({});
	let loaded = $state(true);
	let hydrated = $state(false);
	let host = $state(initial.host);
	async function refresh() {
		await integrations.refresh();
		const result = await integrations;
		keys = result.keys;
		browsers = result.browsers;
		host = result.host;
		loaded = true;
	}
	onMount(() => {
		hydrated = true;
	});
	async function action(operation: string, id?: string) {
		const scope = id ?? 'create';
		if (pending[scope]) return;
		pending[scope] = true;
		if (id) rowMessages[id] = '';
		else createMessage = '';
		message = '';
		try {
			if (operation === 'create') {
				const result = await createSlicerKey({
					name,
					canPrint: permission === 'print',
					...(expiry === 'never' ? {} : { expiresDays: Number(expiry) as 90 | 365 })
				});
				token = result.token;
				reveal = false;
				createMessage = 'Key created. Copy it before leaving this page.';
			} else if (operation === 'key') {
				await revokeSlicerKey(id!);
				token = '';
			} else if (operation === 'disconnect') {
				await disconnectSlicer(id!);
				token = '';
			} else await revokePairedBrowser(id!);
			await refresh();
			if (id)
				message =
					operation === 'browser'
						? 'Browser signed out.'
						: operation === 'disconnect'
							? 'Integration disconnected, including its paired browsers.'
							: 'Key revoked. Paired browsers remain signed in.';
		} catch (cause) {
			const error = cause instanceof Error ? cause.message : 'Action failed.';
			if (id) rowMessages[id] = error;
			else createMessage = error;
		} finally {
			pending[scope] = false;
		}
	}
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copyMessage = 'Copied.';
		} catch {
			copyMessage =
				'Clipboard unavailable. Select the address or reveal and select the key to copy it.';
		}
	}
</script>

<section id="integrations" class="integrations">
	<h2>Slicers & browsers</h2>
	{#if message}<p class="feedback" role="status">{message}</p>{/if}
	{#if canOperate}
		<p>
			Connect any slicer that supports Klipper / Moonraker. Each key belongs to your account and can
			be revoked independently.
		</p>
		<details class="setup-guide">
			<summary>Slicer connection instructions</summary>
			<ol>
				<li>
					In the slicer’s printer connection settings, choose <strong>Klipper / Moonraker</strong>.
				</li>
				<li>
					Set the host to <code>{host}</code>
					<button class="button secondary" onclick={() => copy(host)}>Copy address</button>
				</li>
				<li>
					Create a key below and paste it into the slicer’s API key field. Use its connection test,
					then upload a file.
				</li>
				<li>
					For an embedded Device tab, open this address and choose <strong
						>Sign in with another browser</strong
					>. Upload keys do not sign browsers in.
				</li>
			</ol>
		</details>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void action('create');
			}}
		>
			<label
				>Integration name<input
					disabled={!hydrated}
					bind:value={name}
					maxlength="80"
					required
				/></label
			>
			<label
				>Access<select disabled={!hydrated} aria-label="Access" bind:value={permission}
					><option value="upload">Upload files</option><option value="print"
						>Upload and start prints</option
					></select
				></label
			>
			<label
				>Key expiration<select disabled={!hydrated} aria-label="Key expiration" bind:value={expiry}
					><option value="never">No expiration</option><option value="90">After 90 days</option
					><option value="365">After one year</option></select
				></label
			>
			<button class="button primary" disabled={!hydrated || pending.create}
				>{pending.create ? 'Creating…' : 'Create key'}</button
			>
		</form>
		{#if createMessage}<p class="feedback" role="status">{createMessage}</p>{/if}
		{#if token}
			<div class="secret">
				<p>Copy this key now. After leaving this page, create a replacement if you lose it.</p>
				<input
					type={reveal ? 'text' : 'password'}
					value={token}
					readonly
					aria-label="New slicer key"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="button secondary" onclick={() => copy(token)}>Copy key</button><button
					class="button secondary"
					onclick={() => {
						reveal = !reveal;
					}}>{reveal ? 'Hide' : 'Reveal'} key</button
				><button
					class="button secondary"
					onclick={() => {
						token = '';
					}}>Dismiss key</button
				>
			</div>
		{/if}
		{#each keys as key (key.id)}
			<div class="integration-row">
				<div>
					<strong>{key.name} · …{key.suffix}</strong>
					<p>
						{key.canPrint ? 'Upload and start prints' : 'Upload files'} · {key.expires
							? `Expires ${new Date(key.expires).toLocaleDateString()}`
							: 'No expiration'}
					</p>
					<small
						>Created {new Date(key.created).toLocaleDateString()} · {key.lastUsed
							? `Last used ${new Date(key.lastUsed).toLocaleString()}`
							: 'Never used'}</small
					>
					{#if rowMessages[key.id]}<p class="feedback" role="status">{rowMessages[key.id]}</p>{/if}
				</div>
				<button
					class="button danger-outline"
					disabled={pending[key.id]}
					onclick={() => action('key', key.id)}>Revoke key</button
				>
				<button
					class="button danger-outline"
					disabled={pending[key.id]}
					onclick={() => action('disconnect', key.id)}>Disconnect integration</button
				>
			</div>
		{:else}<p>{loaded ? 'No active slicer keys.' : 'Loading slicer keys…'}</p>{/each}
	{/if}
	<section class="paired-browsers" aria-labelledby="paired-browsers-heading">
		<h3 id="paired-browsers-heading">Paired browsers</h3>
		<p>
			Approve a slicer Device tab, touchscreen, or another browser. Paired browsers use your account
			permissions and stay signed in for up to 90 days.
		</p>
		<a class="button secondary" href="/pair">Approve a browser</a>
		{#each browsers as browser (browser.id)}
			<div class="integration-row">
				<div>
					<strong>{browser.name}</strong>{#if browser.current}<small>This browser</small
						>{/if}{#if browser.integrationId}<small
							>Linked to {keys.find((key) => key.id === browser.integrationId)?.name ??
								'a revoked integration'}</small
						>{/if}
					<p>
						Paired {new Date(browser.created).toLocaleDateString()} · Expires {new Date(
							browser.expires
						).toLocaleDateString()}
					</p>
					{#if rowMessages[browser.id]}<p class="feedback" role="status">
							{rowMessages[browser.id]}
						</p>{/if}
				</div>
				<button
					class="button secondary"
					disabled={pending[browser.id]}
					onclick={() => action('browser', browser.id)}>Sign out browser</button
				>
			</div>
		{:else}<p>{loaded ? 'No paired browsers.' : 'Loading paired browsers…'}</p>{/each}
	</section>
	{#if copyMessage}<p class="feedback" role="status">{copyMessage}</p>{/if}
</section>

<style>
	.paired-browsers {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}
	.paired-browsers > .button {
		justify-self: start;
	}
	.setup-guide {
		margin: 0.75rem 0 1rem;
	}
	.setup-guide summary {
		cursor: pointer;
		min-height: 44px;
		padding: 0.6rem 0;
		color: var(--accent);
	}
	.feedback {
		margin: 0.75rem 0;
		font-size: 0.875rem;
	}
	.integrations {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.5rem;
		margin: 1.5rem 0;
	}
	h2 {
		font-size: 1.7rem;
	}
	p,
	li {
		line-height: 1.6;
	}
	li {
		margin-bottom: 0.7rem;
	}
	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.4rem;
	}
	input,
	select {
		font: inherit;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		padding: 0.6rem 0.9rem;
		min-height: 44px;
		max-width: 100%;
		background: var(--surface);
		color: var(--text);
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
	}
	.integration-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
		overflow-wrap: anywhere;
	}
	small {
		color: var(--muted);
	}
	.secret {
		margin: 1rem 0;
		padding: 1rem;
		background: var(--background);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.secret input {
		width: 100%;
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
