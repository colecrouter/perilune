<script lang="ts">
	import { onMount } from 'svelte';
	import Integrations from '#lib/components/Integrations.svelte';
	import DeviceSettings from '#lib/components/DeviceSettings.svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import { authClient } from '#lib/client/auth.js';
	let { data } = $props();
	let accounts = $state<{ id: string; name: string; email: string; role: string }[]>([]);
	let invitations = $state<
		{ hash: string; role: string; expires: number; claimed: number | null }[]
	>([]);
	let role = $state('operator');
	let link = $state('');
	let message = $state('');
	let pending = $state(false);
	async function refresh() {
		if (data.user?.role === 'owner') {
			const response = await fetch('/api/account/manage');
			if (response.ok) {
				const result = await response.json();
				accounts = result.accounts;
				invitations = result.invitations;
			}
		}
	}
	onMount(() => {
		void refresh();
	});
	async function action(operation: string, body: unknown) {
		pending = true;
		message = '';
		try {
			const response = await fetch(`/api/account/${operation}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.message ?? 'Action failed.');
			if (result.url) link = result.url;
			await refresh();
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Please try again.';
		} finally {
			pending = false;
		}
	}
	async function addPasskey() {
		pending = true;
		message = '';
		try {
			const result = await authClient.passkey.addPasskey({ name: 'My passkey' });
			if (result.error) throw new Error(result.error.message);
			message = 'Passkey added. You can use it the next time you sign in.';
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Could not add a passkey.';
		} finally {
			pending = false;
		}
	}
	async function logout() {
		await authClient.signOut();
		location.assign('/login');
	}
</script>

<svelte:head><title>Account · Perilune</title></svelte:head>
<AppShell active="Account">
	<div class="account-page serif">
		<p class="eyebrow">Mission crew</p>
		<h1>Your account</h1>
		<p>Signed in as {data.user?.name} · {data.user?.role}</p>
		<DeviceSettings />
		<Integrations canOperate={data.user?.role === 'owner' || data.user?.role === 'operator'} />
		<section class="account-card">
			<h2>Secure access</h2>
			<p>
				Add a passkey to sign in using your device’s fingerprint, face recognition, or security key.
			</p>
			<button class="button primary" onclick={addPasskey} disabled={pending}>Add a passkey</button>
			<button onclick={logout} disabled={pending}>Sign out</button>
		</section>
		{#if message}<p role="status">{message}</p>{/if}
		{#if data.user?.role === 'owner'}
			<section class="account-card">
				<h2>Invite someone aboard</h2>
				<p>
					Viewer: watch status and camera. Operator: also use printer controls. Owner: also manage
					accounts and invitations.
				</p>
				<label
					>Role <select bind:value={role}
						><option value="viewer">Viewer</option><option value="operator">Operator</option><option
							value="owner">Owner</option
						></select
					></label
				>
				<button class="button primary" disabled={pending} onclick={() => action('invite', { role })}
					>Create invitation</button
				>{#if link}<label class="invite-link"
						>Share this single-use link. It expires in 24 hours.<input
							readonly
							value={link}
							onclick={(event) => event.currentTarget.select()}
						/></label
					>{/if}
			</section>
			<section class="account-card">
				<h2>Accounts</h2>
				{#each accounts as account}<div class="crew-row">
						<div>
							<strong>{account.name}</strong><small>{account.email} · {account.role}</small>
						</div>
						{#if account.id !== data.user.id}<button
								disabled={pending}
								onclick={() => action('revoke-account', { id: account.id })}>Revoke access</button
							>{/if}
					</div>{/each}
			</section>
			<section class="account-card">
				<h2>Invitations</h2>
				{#each invitations.filter((invite) => !invite.claimed && invite.expires > Date.now()) as invite}<div
						class="crew-row"
					>
						<span>{invite.role} · expires {new Date(invite.expires).toLocaleString()}</span><button
							disabled={pending}
							onclick={() => action('revoke-invite', { hash: invite.hash })}>Revoke</button
						>
					</div>{:else}<p>No outstanding invitations.</p>{/each}
			</section>
		{/if}
	</div>
</AppShell>

<style>
	.account-page {
		max-width: 900px;
		padding: clamp(1rem, 4vw, 3rem);
	}
	.account-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.5rem;
		margin: 1.5rem 0;
	}
	h1 {
		font-size: 2.5rem;
	}
	h2 {
		font-size: 1.7rem;
	}
	p {
		line-height: 1.6;
	}
	button,
	select,
	input {
		min-height: 44px;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		padding: 0.6rem 0.9rem;
		font: inherit;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
	}
	small {
		display: block;
		color: var(--muted);
		margin-top: 0.3rem;
	}
	.crew-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
		overflow-wrap: anywhere;
	}
	.invite-link {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
		font-size: 0.85rem;
	}
	input {
		width: 100%;
	}
</style>
