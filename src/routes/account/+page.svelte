<script lang="ts">
	import { onMount } from 'svelte';
	import DisplayPreferences from '#lib/components/DisplayPreferences.svelte';
	import Integrations from '#lib/components/Integrations.svelte';
	import DeviceSettings from '#lib/components/DeviceSettings.svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import { authClient } from '#lib/client/auth.js';
	let { data } = $props();
	const sections = [
		{ id: 'access', label: 'Access & people' },
		{ id: 'notifications', label: 'This device' },
		{ id: 'integrations', label: 'Slicers & browsers' },
		{ id: 'preferences', label: 'Display' }
	];
	let active = $state('access');
	let accounts = $state<{ id: string; name: string; email: string; role: string }[]>([]);
	let invitations = $state<
		{ hash: string; role: string; expires: number; claimed: number | null }[]
	>([]);
	let role = $state('operator');
	let link = $state('');
	let messages = $state<Record<string, string>>({});
	let pending = $state<Record<string, boolean>>({});
	let loaded = $state(false);
	async function refresh() {
		if (data.user?.role !== 'owner') return;
		const response = await fetch('/api/account/manage');
		if (!response.ok) throw new Error('Could not load accounts and invitations. Try again.');
		const result = await response.json();
		accounts = result.accounts;
		invitations = result.invitations;
		loaded = true;
	}
	async function load() {
		messages.people = '';
		try {
			await refresh();
		} catch (cause) {
			messages.people = cause instanceof Error ? cause.message : 'Could not load accounts.';
		}
	}
	onMount(() => {
		const followHash = () => {
			const hash = location.hash.slice(1);
			active = sections.some((section) => section.id === hash) ? hash : 'access';
		};
		followHash();
		window.addEventListener('hashchange', followHash);
		void load();
		return () => window.removeEventListener('hashchange', followHash);
	});
	async function action(operation: string, body: unknown, scope: string) {
		if (pending[scope]) return;
		pending[scope] = true;
		messages[scope] = '';
		try {
			const response = await fetch(`/api/account/${operation}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.message ?? 'Action failed.');
			if (result.url) link = result.url;
			messages[scope] = operation === 'invite' ? 'Invitation ready to share.' : 'Access revoked.';
			await load();
			if (operation === 'revoke-account') messages.accountsResult = 'Account access revoked.';
			if (operation === 'revoke-invite') messages.invitationsResult = 'Invitation revoked.';
		} catch (cause) {
			messages[scope] = cause instanceof Error ? cause.message : 'Please try again.';
		} finally {
			pending[scope] = false;
		}
	}
	async function addPasskey() {
		pending.security = true;
		messages.security = '';
		try {
			const result = await authClient.passkey.addPasskey({ name: 'My passkey' });
			if (result.error) throw new Error(result.error.message);
			messages.security = 'Passkey added. You can use it the next time you sign in.';
		} catch (cause) {
			messages.security = cause instanceof Error ? cause.message : 'Could not add a passkey.';
		} finally {
			pending.security = false;
		}
	}
	async function logout() {
		pending.security = true;
		messages.security = '';
		try {
			const result = await authClient.signOut();
			if (result.error) throw new Error('Could not sign out. Please try again.');
			location.assign('/login');
		} catch (cause) {
			messages.security = cause instanceof Error ? cause.message : 'Could not sign out.';
			pending.security = false;
		}
	}
	async function copyInvitation() {
		try {
			await navigator.clipboard.writeText(link);
			messages.invite = 'Invitation link copied.';
		} catch {
			messages.invite = 'Select the invitation link to copy it.';
		}
	}
</script>

<svelte:head><title>Account · Perilune</title></svelte:head>
<AppShell active="Account">
	<div class="account-page serif">
		<header class="account-header">
			<div>
				<p class="eyebrow">Your space</p>
				<h1>Your account</h1>
				<p>{data.user?.name} · {data.user?.role}</p>
			</div>
		</header>
		<nav class="account-sections" aria-label="Account sections">
			{#each sections as section}<a
					href={`#${section.id}`}
					aria-current={active === section.id ? 'location' : undefined}
					onclick={() => (active = section.id)}>{section.label}</a
				>{/each}
		</nav>
		<div hidden={active !== 'preferences'} id="preferences"><DisplayPreferences /></div>
		<div hidden={active !== 'notifications'} id="notifications"><DeviceSettings /></div>
		<div hidden={active !== 'integrations'}>
			<Integrations canOperate={data.user?.role === 'owner' || data.user?.role === 'operator'} />
		</div>
		<div hidden={active !== 'access'} id="access">
			<section class="account-card" aria-labelledby="secure-access">
				<h2 id="secure-access">Secure access</h2>
				<p>Use your device’s fingerprint, face recognition, or security key to sign in.</p>
				<div class="actions">
					<button class="button primary" onclick={addPasskey} disabled={pending.security}
						>Add a passkey</button
					><button class="button secondary" onclick={logout} disabled={pending.security}
						>Sign out</button
					>
				</div>
				{#if messages.security}<p class="feedback" role="status">{messages.security}</p>{/if}
			</section>
			{#if data.user?.role === 'owner'}
				<section class="account-card" aria-labelledby="invite-heading">
					<h2 id="invite-heading">Invite someone</h2>
					<div class="invite-form">
						<label
							>Access<select bind:value={role}
								><option value="viewer">Viewer</option><option value="operator">Operator</option
								><option value="owner">Owner</option></select
							></label
						><button
							class="button primary"
							disabled={pending.invite}
							onclick={() => action('invite', { role }, 'invite')}
							>{pending.invite ? 'Creating…' : 'Create invitation'}</button
						>
					</div>
					<p class="help">
						{role === 'viewer'
							? 'Viewers can watch status and the camera.'
							: role === 'operator'
								? 'Operators can also use printer controls.'
								: 'Owners can also manage accounts and invitations.'}
					</p>
					{#if link}<div class="invite-link">
							<label
								>Single-use link · expires in 24 hours<input
									readonly
									value={link}
									onclick={(event) => event.currentTarget.select()}
								/></label
							><button class="button secondary" onclick={copyInvitation}>Copy link</button>
						</div>{/if}
					{#if messages.invite}<p class="feedback" role="status">{messages.invite}</p>{/if}
				</section>
				{#if messages.people}<div class="account-card" role="status">
						<p>{messages.people}</p>
						<button class="button secondary" onclick={load}>Retry loading accounts</button>
					</div>{/if}
				<section class="account-card" aria-labelledby="accounts-heading">
					<h2 id="accounts-heading">Accounts</h2>
					{#if messages.accountsResult}<p class="feedback" role="status">
							{messages.accountsResult}
						</p>{/if}
					{#if !loaded && !messages.people}<p role="status">Loading accounts…</p>{/if}
					{#each accounts as account}<div class="crew-row">
							<div>
								<strong>{account.name}</strong><small>{account.email} · {account.role}</small
								>{#if messages[account.id]}<p class="feedback" role="status">
										{messages[account.id]}
									</p>{/if}
							</div>
							{#if account.id !== data.user.id}<button
									class="button danger-outline"
									disabled={pending[account.id]}
									onclick={() => action('revoke-account', { id: account.id }, account.id)}
									>Revoke access</button
								>{/if}
						</div>{/each}
				</section>
				<section class="account-card" aria-labelledby="invitations-heading">
					<h2 id="invitations-heading">Invitations</h2>
					{#if messages.invitationsResult}<p class="feedback" role="status">
							{messages.invitationsResult}
						</p>{/if}
					{#each invitations.filter((invite) => !invite.claimed && invite.expires > Date.now()) as invite}<div
							class="crew-row"
						>
							<div>
								<strong>{invite.role}</strong><small
									>Expires {new Date(invite.expires).toLocaleString()}</small
								>{#if messages[invite.hash]}<p class="feedback" role="status">
										{messages[invite.hash]}
									</p>{/if}
							</div>
							<button
								class="button danger-outline"
								disabled={pending[invite.hash]}
								onclick={() => action('revoke-invite', { hash: invite.hash }, invite.hash)}
								>Revoke invitation</button
							>
						</div>{:else}{#if loaded}<p class="help">No outstanding invitations.</p>{/if}{/each}
				</section>
			{/if}
		</div>
	</div>
</AppShell>

<style>
	.account-page {
		max-width: 64rem;
		padding: clamp(1rem, 3vw, 2rem);
	}
	.account-header {
		margin-bottom: 1rem;
	}
	.account-header h1 {
		margin: 0.25rem 0 0.5rem;
	}
	.account-header p {
		color: var(--muted);
	}
	.account-sections {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.account-sections a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		color: var(--text);
		text-decoration: none;
		background: var(--surface);
	}
	.account-sections a[aria-current] {
		background: var(--highlight);
		color: var(--highlight-text);
		border-color: var(--accent-border);
	}
	.account-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1rem;
	}
	.account-card h2 {
		margin-bottom: 0.6rem;
	}
	p {
		line-height: 1.6;
	}
	.actions,
	.invite-form {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-size: 0.875rem;
		font-weight: 500;
	}
	select,
	input {
		min-height: 44px;
		border-radius: 7px;
		border: 1px solid var(--border-strong);
		padding: 0.6rem 0.8rem;
		font: inherit;
		color: var(--text);
		background: var(--surface);
		max-width: 100%;
	}
	.help {
		color: var(--muted);
		font-size: 0.875rem;
		margin-top: 0.75rem;
	}
	.feedback {
		margin-top: 0.75rem;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
	.crew-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 1rem 0;
		border-top: 1px solid var(--border);
		overflow-wrap: anywhere;
	}
	.crew-row > div {
		min-width: 0;
		flex: 1 1 12rem;
	}
	.crew-row small {
		margin-top: 0.25rem;
	}
	.invite-link {
		display: grid;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.invite-link .button {
		justify-self: start;
	}
	input {
		width: 100%;
	}
</style>
