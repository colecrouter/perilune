<script lang="ts">
	import { onMount } from 'svelte';
	import { accountEntry } from '../../routes/access.remote.js';
	import EntryFrame from './EntryFrame.svelte';
	let { mode, enabled }: { mode: 'verify' | 'forgot'; enabled: boolean } = $props();
	let revision = 0;
	let hydrated = $state(false),
		token = $state(''),
		email = $state(''),
		password = $state(''),
		confirm = $state(''),
		pending = $state(false),
		message = $state(''),
		done = $state(false),
		failure = $state(false);
	onMount(() => {
		const read = () => {
			if (location.hash) {
				revision++;
				token = location.hash.slice(1);
				done = false;
				message = '';
				failure = false;
				password = '';
				confirm = '';
				history.replaceState(history.state, '', location.pathname);
			}
			hydrated = true;
		};
		read();
		window.addEventListener('hashchange', read);
		return () => window.removeEventListener('hashchange', read);
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!hydrated || pending) return;
		failure = false;
		message = '';
		if (mode === 'forgot' && token && password !== confirm) {
			failure = true;
			message = 'The passwords do not match.';
			return;
		}
		pending = true;
		const started = revision;
		try {
			const operation = mode === 'verify' ? 'verify' : token ? 'reset' : 'request-reset';
			const result = await accountEntry({ operation, token, email, password });
			if (revision !== started) return;
			message = 'message' in result ? result.message! : '';
			done = true;
			password = '';
			confirm = '';
			token = '';
		} catch (cause) {
			if (revision !== started) return;
			failure = true;
			message = cause instanceof Error ? cause.message : 'Please try again.';
		} finally {
			pending = false;
		}
	}
</script>

<svelte:head
	><title>{mode === 'verify' ? 'Verify recovery email' : 'Reset your password'} · Perilune</title
	><meta name="referrer" content="no-referrer" /></svelte:head
>
<EntryFrame>
	<p class="eyebrow">Account recovery</p>
	<h1>
		{mode === 'verify'
			? 'Verify recovery email'
			: token
				? 'Choose a new password'
				: 'Forgot your password?'}
	</h1>
	{#if message}<p role={failure ? 'alert' : 'status'}>{message}</p>{/if}
	{#if !done}
		{#if mode === 'verify'}<p>
				Confirm that this email address belongs to you. It will be eligible to receive password
				reset links for your account.
			</p>{:else if token}<p>
				This signs out browsers, including paired browsers. Your passkeys, slicer integrations and
				notification registrations are preserved.
			</p>{:else}<p>
				{enabled
					? 'Enter your account email. Recovery is available after you have verified that address in Account.'
					: 'Email recovery is not configured on this installation. Use a passkey, approve this browser from another signed-in device, or contact the host.'}
			</p>{/if}
		{#if token || (enabled && mode === 'forgot')}<form method="POST" onsubmit={submit}>
				{#if mode === 'forgot' && !token}<label
						>Email<input
							type="email"
							bind:value={email}
							required
							maxlength="254"
							autocomplete="username"
							disabled={!hydrated || pending}
						/></label
					>{/if}
				{#if mode === 'forgot' && token}<label
						>New password<input
							type="password"
							bind:value={password}
							required
							minlength="12"
							maxlength="128"
							autocomplete="new-password"
							disabled={!hydrated || pending}
						/></label
					><label
						>Confirm new password<input
							type="password"
							bind:value={confirm}
							required
							minlength="12"
							maxlength="128"
							autocomplete="new-password"
							disabled={!hydrated || pending}
						/></label
					>
					<p class="help">Use at least 12 characters. A passphrase works well.</p>{/if}
				<button class="button primary" disabled={!hydrated || pending}
					>{pending
						? 'Working…'
						: mode === 'verify'
							? 'Verify recovery email'
							: token
								? 'Update password'
								: 'Send reset link'}</button
				>
			</form>
		{:else if mode === 'verify'}<p>
				Open the complete verification link from your email. If it expired, request another from
				Account.
			</p>{/if}
	{/if}
	<p><a href="/login">Back to sign in</a></p>
	{#if failure && mode === 'forgot'}<p>
			<a href="/forgot-password">Request a new reset link</a>
		</p>{/if}
	{#if !token && !done && mode === 'forgot'}<p>
			<a href="/pair/start">Sign in with another browser</a>
		</p>{/if}
</EntryFrame>

<style>
	h1 {
		font-size: 2.3rem;
		margin: 0.5rem 0 1rem;
	}
	p {
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	form,
	label {
		display: grid;
		gap: 0.6rem;
	}
	form {
		gap: 1rem;
		margin-top: 1.5rem;
	}
	label {
		font-size: 0.875rem;
		font-weight: 600;
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
	.help {
		font-size: 0.8rem;
		color: var(--muted);
	}
	button {
		min-height: 46px;
	}
</style>
