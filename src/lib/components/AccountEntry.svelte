<script lang="ts">
	import MoonMark from './MoonMark.svelte';
	import { onMount } from 'svelte';
	import { authClient } from '#lib/client/auth.js';
	let { mode }: { mode: 'login' | 'setup' | 'register' } = $props();
	let token = $state('');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let pending = $state(false);
	let message = $state('');
	let reset = $state(false);
	let destination = $state('/');
	onMount(() => {
		const hash = location.hash.slice(1);
		if (new URLSearchParams(location.search).get('next') === 'pair') destination = '/pair';
		if (mode === 'register') token = hash;
		if (mode === 'login' && hash.startsWith('reset=')) {
			token = hash.slice(6);
			reset = true;
		}
		history.replaceState(null, '', location.pathname);
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
				const response = await fetch('/api/account/enroll', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token, name, email, password })
				});
				if (!response.ok) {
					const body = await response.json();
					throw new Error(body.message ?? 'Could not create this account.');
				}
				location.assign('/login');
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
<div class="entry-sky serif">
	<section class="entry-card">
		<a class="entry-brand" href="/"><MoonMark /><span>Perilune</span></a>
		<p class="eyebrow">Your printer, in orbit</p>
		<h1>
			{reset
				? 'Recover your account'
				: mode === 'setup'
					? 'Welcome aboard'
					: mode === 'register'
						? 'Your invitation awaits'
						: 'Welcome back'}
		</h1>
		<p>
			{reset
				? 'Choose a new password. Existing sessions and passkeys have been revoked.'
				: mode === 'setup'
					? 'Create the owner account for this installation.'
					: mode === 'register'
						? 'Create your account to join this printer.'
						: 'Sign in to check on your printer and pick up where you left off.'}
		</p>
		{#if mode === 'login' && !reset}<p class="entry-help">
				Sign-in lasts up to 90 days. You can sign out or revoke access sooner.
			</p>{/if}
		<form onsubmit={submit}>
			{#if mode === 'setup'}<label
					>Setup token<input
						bind:value={token}
						required
						autocomplete="off"
						spellcheck="false"
					/></label
				>
				<p><a href="/pair/start">Sign in with another browser</a></p>
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
			{#if mode !== 'login' || reset}<p><a href="/pair/start">Sign in with another browser</a></p>
				<p class="entry-help">Use at least 12 characters. A passphrase works well.</p>{/if}
			{#if message}<p role="alert" class="entry-message">{message}</p>{/if}
			<button class="button primary" type="submit" disabled={pending}
				>{pending
					? 'Working…'
					: reset
						? 'Update password'
						: mode === 'login'
							? 'Sign in'
							: 'Create account'}</button
			>
		</form>
		{#if mode === 'login' && !reset}<button
				class="secondary-button"
				onclick={signInPasskey}
				disabled={pending}>Sign in with a passkey</button
			>
			<p><a href="/pair/start">Sign in with another browser</a></p>
			<p class="entry-help">
				Locked out? Stop Perilune, then recover an owner account on the server using <code
					>node scripts/auth.mjs recover email --server-stopped</code
				>.
			</p>{/if}
	</section>
</div>

<style>
	.entry-sky {
		min-height: 100svh;
		display: grid;
		place-items: center;
		padding: 2rem 1rem;
		position: relative;
		isolation: isolate;
		background: var(--rail);
	}
	.entry-sky::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		background-image: var(--stars);
		background-size: 242px 720px;
	}
	.entry-card {
		width: min(100%, 460px);
		background: var(--surface, #faf8f3);
		border-radius: 24px;
		padding: clamp(1.5rem, 5vw, 2.5rem);
		box-shadow: 0 24px 80px #060e2140;
	}
	.entry-brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 2rem;
		color: var(--text);
		text-decoration: none;
		margin-bottom: 2rem;
	}
	.entry-brand :global(svg) {
		width: 30px;
		height: 30px;
		flex-shrink: 0;
	}
	.entry-brand span {
		font-family: 'Newsreader Variable', serif;
	}
	h1 {
		font-size: 2.3rem;
		margin: 0.5rem 0 1rem;
	}
	p {
		line-height: 1.6;
	}
	form {
		display: grid;
		gap: 1rem;
		margin-top: 1.5rem;
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
		color: var(--danger);
	}
	code {
		font-size: 0.8rem;
	}
	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}
</style>
