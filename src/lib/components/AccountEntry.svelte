<script lang="ts">
	import { accountEntry } from '../../routes/access.remote.js';
	import EntryFrame from './EntryFrame.svelte';
	import { onMount } from 'svelte';
	import { authClient } from '#lib/client/auth.js';
	import { goto } from '$app/navigation';
	let {
		mode,
		signedIn = false,
		reauthenticate = false
	}: {
		mode: 'login' | 'setup' | 'register';
		signedIn?: boolean;
		reauthenticate?: boolean;
	} = $props();
	let token = $state('');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let pending = $state(false);
	let message = $state('');
	let reset = $state(false);
	let destination = $state('/');
	let recoveryHelp = $state(false);
	let hydrated = $state(false),
		invitation = $state<{
			state: string;
			role: string | null;
			expires: number | null;
			emailRequired: boolean;
		} | null>(null);
	async function inspectInvitation() {
		if (!token) {
			invitation = { state: 'missing', role: null, expires: null, emailRequired: false };
			return;
		}
		const requested = token;
		try {
			const result = await accountEntry({ operation: 'invitation', token });
			if (token === requested) invitation = result as typeof invitation;
		} catch {
			if (token !== requested) return;
			message = 'Could not inspect this invitation. Reload the complete link to try again.';
		}
	}
	onMount(() => {
		hydrated = true;
		if (mode === 'login' && reauthenticate) destination = '/account';
		const hash = location.hash.slice(1);
		const query = new URLSearchParams(location.search);
		if (query.get('next') === 'pair') destination = '/pair';
		if (mode === 'login' && query.get('created') === '1')
			message = 'Account created. Sign in to continue.';
		if (mode === 'register') {
			token = hash;
			void inspectInvitation();
		}
		if (mode === 'login' && hash.startsWith('reset=')) {
			token = hash.slice(6);
			reset = true;
		}
		history.replaceState(null, '', location.pathname + (reauthenticate ? '?reauth=1' : ''));
		// Recovery tokens live in the fragment, so choose after inspecting it in the browser.
		if (mode === 'login' && signedIn && !reset && !reauthenticate)
			void goto(destination, { replaceState: true });
		const followInvitation = () => {
			if (mode !== 'register' || !location.hash) return;
			token = location.hash.slice(1);
			invitation = null;
			message = '';
			history.replaceState(null, '', location.pathname);
			void inspectInvitation();
		};
		window.addEventListener('hashchange', followInvitation);
		return () => window.removeEventListener('hashchange', followInvitation);
	});
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		pending = true;
		message = '';
		try {
			if (reset) {
				const result = await authClient.resetPassword({ token, newPassword: password });
				if (result.error) throw new Error(result.error.message);
				reset = false;
				message = 'Password updated. You can sign in now.';
				password = '';
			} else if (mode === 'login') {
				const result = await authClient.signIn.email({ email, password });
				if (result.error)
					throw new Error(
						result.error.status === 429
							? 'Too many sign-in attempts. Wait a moment and try again.'
							: 'Could not sign in. Check your email and password.'
					);
				location.assign(destination);
			} else {
				await accountEntry({ operation: 'enroll', token, name, email, password });
				location.assign('/login?created=1');
			}
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Please try again.';
		} finally {
			pending = false;
		}
	}
	async function signInPasskey() {
		pending = true;
		message = '';
		try {
			const result = await authClient.signIn.passkey();
			if (result.error) throw new Error(result.error.message);
			location.assign(destination);
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Could not use this passkey.';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head
	><title
		>{mode === 'setup' ? 'Welcome aboard' : mode === 'register' ? 'Join Perilune' : 'Sign in'} · Perilune</title
	><meta name="referrer" content="no-referrer" /></svelte:head
>
<EntryFrame>
	<p class="eyebrow">Your printer, in orbit</p>
	<h1>
		{reset
			? 'Recover your account'
			: mode === 'setup'
				? 'Welcome aboard'
				: mode === 'register'
					? 'Your invitation awaits'
					: reauthenticate
						? 'Confirm your sign-in'
						: 'Welcome back'}
	</h1>
	<p>
		{reset
			? 'Choose a new password. Existing sessions and passkeys have been revoked.'
			: mode === 'setup'
				? 'Create the owner account for this installation.'
				: mode === 'register'
					? 'Create your account to join this printer.'
					: reauthenticate
						? 'Use your password or passkey to confirm account recovery actions. You will return to Account.'
						: 'Sign in to check on your printer and pick up where you left off.'}
	</p>
	{#if mode === 'login' && !reset && !reauthenticate}<p class="entry-help">
			Use your password, a passkey, or approve this browser from another device.
		</p>{/if}
	{#if mode === 'register' && invitation}<p class="entry-message" role="status">
			{invitation.state === 'ready'
				? `You are joining as ${invitation.role}. This invitation expires ${new Date(invitation.expires!).toLocaleString()}.`
				: invitation.state === 'used'
					? 'This invitation has already been used. Sign in with the account you created.'
					: invitation.state === 'revoked'
						? 'This invitation was revoked. Ask the host for a new link.'
						: invitation.state === 'expired'
							? 'This invitation expired. Ask the host for a new link.'
							: 'This invitation link is incomplete or invalid. Ask the host for the complete link.'}
		</p>
		{#if invitation.emailRequired && invitation.state === 'ready'}<p class="entry-help">
				Enter the email address that received this invitation.
			</p>{/if}{/if}
	<form method="POST" onsubmit={submit}>
		<fieldset
			disabled={!hydrated || pending || (mode === 'register' && invitation?.state !== 'ready')}
		>
			{#if mode === 'setup'}<label
					>Setup token<input
						bind:value={token}
						required
						autocomplete="off"
						spellcheck="false"
					/></label
				>
				<p class="entry-help">
					On the server, run <code>node scripts/auth.mjs setup</code> to generate a token. It expires
					in 30 minutes.
				</p>{/if}
			{#if mode !== 'login'}<label
					>Your name<input bind:value={name} required maxlength="100" autocomplete="name" /></label
				>{/if}
			{#if !reset}<label
					>Email<input type="email" bind:value={email} required autocomplete="username" /></label
				>{/if}
			<label
				>Password<input
					type="password"
					bind:value={password}
					required
					minlength={mode === 'login' && !reset ? 1 : 12}
					maxlength="128"
					autocomplete={mode === 'login' && !reset ? 'current-password' : 'new-password'}
				/></label
			>
			{#if mode !== 'login' || reset}<p class="entry-help">
					Use at least 12 characters. A passphrase works well.
				</p>{/if}
			{#if message}<p role="alert" class="entry-message">{message}</p>{/if}
			<button class="button primary" type="submit" disabled={!hydrated || pending}
				>{pending
					? 'Working…'
					: reset
						? 'Update password'
						: mode === 'login'
							? 'Sign in'
							: 'Create account'}</button
			>
		</fieldset>
	</form>
	{#if mode === 'login' && !reset}<button
			class="secondary-button"
			onclick={signInPasskey}
			disabled={!hydrated || pending}>Sign in with a passkey</button
		>
		{#if !reauthenticate}<p><a href="/pair/start">Sign in with another browser</a></p>
			<p class="entry-help">
				Use this in a slicer Device tab or on a touchscreen where passkeys are unavailable.
			</p>{/if}
		<p><a href="/forgot-password">Forgot your password?</a></p>
		<details bind:open={recoveryHelp} class="entry-recovery">
			<summary>Need help signing in?</summary>
			<p class="entry-help">
				Sign-in lasts up to 90 days. If you have no working password, passkey, or signed-in browser,
				ask the person hosting Perilune for help.
			</p>
			<p class="entry-help">
				Hosting this installation? Stop Perilune, then recover an owner account on the server using <code
					>node scripts/auth.mjs recover email --server-stopped</code
				>.
			</p>
		</details>{/if}
</EntryFrame>

<style>
	h1 {
		font-size: 2.3rem;
		margin: 0.5rem 0 1rem;
	}
	p {
		line-height: 1.6;
	}
	form,
	fieldset {
		display: grid;
		gap: 1rem;
		margin-top: 1.5rem;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-weight: 600;
		font-size: 0.875rem;
	}
	input {
		width: 100%;
		min-height: 46px;
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		padding: 0.7rem;
		background: var(--canvas);
		color: var(--text);
		font: inherit;
	}
	.entry-help {
		font-size: 0.8rem;
		color: var(--muted);
		margin: 0;
		overflow-wrap: anywhere;
	}
	.secondary-button {
		width: 100%;
		margin: 1rem 0;
		min-height: 46px;
		border: 1px solid var(--accent-border);
		border-radius: 10px;
		background: transparent;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}
	.entry-message {
		padding: 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--accent-soft);
	}
	.entry-recovery {
		margin-top: 1rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--canvas);
	}
	.entry-recovery summary {
		cursor: pointer;
		min-height: 44px;
		display: list-item;
		list-style: disclosure-closed inside;
		padding: 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text);
	}
	.entry-recovery[open] summary {
		list-style-type: disclosure-open;
	}
	.entry-recovery p {
		padding: 0 0.75rem 0.75rem;
	}
	code {
		font-size: 0.8rem;
	}
	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}
</style>
