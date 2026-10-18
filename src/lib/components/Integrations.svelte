<script lang="ts">
	import { onMount } from 'svelte';
	import type { KeySummary } from '#lib/server/job-service.js';
	let { canOperate = false }: { canOperate?: boolean } = $props();
	let name = $state('Desktop slicer');
	let permission = $state('upload');
	let expiry = $state('never');
	let token = $state('');
	let reveal = $state(false);
	let keys = $state<KeySummary[]>([]);
	let browsers = $state<
		{
			id: string;
			name: string;
			created: number;
			integrationId: string | null;
			lastUsed: number;
			current: boolean;
			expires: number;
		}[]
	>([]);
	let message = $state('');
	let pending = $state(false);
	let host = $state('');
	async function api(path: string, body?: unknown) {
		const response = await fetch(path, {
			method: body ? 'POST' : 'GET',
			...(body
				? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
				: {})
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.message ?? 'Could not update integrations.');
		return result;
	}
	async function refresh() {
		browsers = (await api('/api/account/browsers')).browsers;
		if (canOperate) keys = (await api('/api/jobs/keys')).keys;
	}
	onMount(() => {
		host = location.origin;
		void refresh().catch(() => {
			message = 'Could not load integrations. Reload to try again.';
		});
	});
	async function action(operation: string, id?: string) {
		pending = true;
		message = '';
		try {
			if (operation === 'create') {
				const result = await api('/api/jobs/key', {
					name,
					canPrint: permission === 'print',
					...(expiry === 'never' ? {} : { expiresDays: Number(expiry) })
				});
				token = result.token;
				reveal = false;
			} else if (operation === 'key') {
				await api('/api/jobs/revoke-key', { id });
				token = '';
			} else if (operation === 'disconnect') {
				await api('/api/account/disconnect-integration', { id });
				token = '';
			} else await api('/api/account/revoke-browser', { id });
			await refresh();
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Action failed.';
		} finally {
			pending = false;
		}
	}
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			message = 'Copied.';
		} catch {
			message = 'Clipboard unavailable. Reveal and select the key to copy it.';
		}
	}
</script>

<section id="integrations" class="integrations">
	<h2>Integrations</h2>
	{#if canOperate}
		<p>
			Connect any slicer that supports Klipper / Moonraker. Each key belongs to your account and can
			be revoked independently.
		</p>
		<ol>
			<li>
				In the slicer’s printer connection settings, choose <strong>Klipper / Moonraker</strong>.
			</li>
			<li>
				Set the host to <code>{host}</code> <button onclick={() => copy(host)}>Copy address</button>
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
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void action('create');
			}}
		>
			<label>Integration name<input bind:value={name} maxlength="80" required /></label>
			<label
				>Access<select aria-label="Access" bind:value={permission}
					><option value="upload">Upload files</option><option value="print"
						>Upload and start prints</option
					></select
				></label
			>
			<label
				>Key expiration<select aria-label="Key expiration" bind:value={expiry}
					><option value="never">No expiration</option><option value="90">After 90 days</option
					><option value="365">After one year</option></select
				></label
			>
			<button disabled={pending}>Create key</button>
		</form>
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
				<button onclick={() => copy(token)}>Copy key</button><button
					onclick={() => {
						reveal = !reveal;
					}}>{reveal ? 'Hide' : 'Reveal'} key</button
				><button
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
				</div>
				<button disabled={pending} onclick={() => action('key', key.id)}>Revoke key</button>
				<button disabled={pending} onclick={() => action('disconnect', key.id)}
					>Disconnect integration</button
				>
			</div>
		{:else}<p>No active slicer keys.</p>{/each}
	{/if}
	<h3>Paired browsers</h3>
	<p>
		Pairing works with slicers, touchscreens, and other browsers. Sign-in expires 90 days after
		login or pairing, even when used regularly. Sign in or pair again to start a new period. Account
		recovery or removal revokes access.
	</p>
	<a href="/pair">Approve a browser</a>
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
			</div>
			<button disabled={pending} onclick={() => action('browser', browser.id)}
				>Sign out browser</button
			>
		</div>
	{:else}<p>No paired browsers.</p>{/each}
	{#if message}<p role="status">{message}</p>{/if}
</section>

<style>
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
	select,
	button {
		font: inherit;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		padding: 0.6rem 0.9rem;
		min-height: 44px;
		max-width: 100%;
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
