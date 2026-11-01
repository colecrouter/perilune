<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { isHttpError } from '@sveltejs/kit';
	import { getIntegrations } from '../../routes/account/integrations.remote.js';
	import { pairBrowser } from '../../routes/pairing.remote.js';
	import MoonMark from './MoonMark.svelte';
	import Starfield from './Starfield.svelte';
	let { approve = false, signedIn = false }: { approve?: boolean; signedIn?: boolean } = $props();
	let name = $state('My browser');
	let code = $state('');
	let request = $state<{ name: string; expires: number } | null>(null);
	let grant = $state<{ code: string; token: string; expires: number; url: string } | null>(null);
	let message = $state('');
	let pending = $state(false);
	let cooldownUntil = $state(0);
	let now = $state(Date.now());
	const retrySeconds = $derived(Math.max(0, Math.ceil((cooldownUntil - now) / 1000)));
	function failure(cause: unknown, fallback: string) {
		if (isHttpError(cause)) {
			if (cause.status === 429) {
				message = '';
				const seconds = cause.body.retryAfter;
				now = Date.now();
				cooldownUntil =
					now +
					(typeof seconds === 'number' && Number.isFinite(seconds)
						? Math.max(1, Math.min(60, seconds))
						: 60) *
						1000;
				return;
			}
			message = cause.body.message;
		} else message = cause instanceof Error ? cause.message : fallback;
	}
	let hydrated = $state(false);
	let inspectedCode = $state('');
	let integrationId = $state('');
	const integrations = untrack(() => approve && signedIn) ? (await getIntegrations()).keys : [];
	const controller = new AbortController();
	async function api(
		operation: 'start' | 'cancel' | 'poll' | 'inspect' | 'approve',
		body: Record<string, unknown>
	) {
		return (await pairBrowser({ operation, ...body })) as {
			code: string;
			token: string;
			expires: number;
			url: string;
			request: { name: string; expires: number } | null;
			approved: boolean;
		};
	}

	async function action(operation: string) {
		if (pending || retrySeconds > 0 || controller.signal.aborted) return;
		pending = true;
		message = '';
		try {
			if (operation === 'start') grant = await api('start', { name });
			else if (operation === 'inspect') {
				request = null;
				inspectedCode = code.trim().toUpperCase().replaceAll('-', '');
				const result = await api('inspect', { code: inspectedCode });
				request = result.request;
				if (!request) message = 'No pending request with that code. Check the code or start again.';
			} else {
				await api('approve', {
					code: inspectedCode,
					approve: operation === 'approve',
					integrationId: integrationId || undefined
				});
				request = null;
				message =
					operation === 'approve'
						? 'Browser approved. Return to that browser to continue.'
						: 'Pairing denied.';
			}
		} catch (cause) {
			failure(cause, 'Could not check pairing. Try again.');
		} finally {
			pending = false;
		}
	}
	onMount(() => {
		hydrated = true;
		const clock = setInterval(() => {
			now = Date.now();
		}, 1000);
		let polling = false;
		const timer = setInterval(async () => {
			if (!grant || polling || approve || retrySeconds > 0) return;
			if (Date.now() >= grant.expires) {
				grant = null;
				message = 'Pairing expired. Start again.';
				return;
			}
			polling = true;
			const current = grant;
			try {
				const result = await api('poll', { token: current.token });
				if (!controller.signal.aborted && result.approved && grant === current)
					location.assign('/');
			} catch (cause) {
				if (!controller.signal.aborted && grant === current) {
					failure(cause, 'Could not check pairing.');
					if (!isHttpError(cause) || cause.status !== 429) grant = null;
				}
			} finally {
				polling = false;
			}
		}, 3000);
		return () => {
			clearInterval(timer);
			clearInterval(clock);
			controller.abort();
		};
	});
</script>

<div class="pair-sky serif">
	<Starfield />
	<div class="pair-card">
		<a class="pair-brand" href="/login"><MoonMark /><span>Perilune</span></a>
		<h1>{approve ? 'Approve a browser' : 'Sign in with another browser'}</h1>
		{#if approve}
			<p>
				Only approve a code displayed on a browser you are signing into yourself. Approval gives it
				your account’s permissions.
			</p>
			{#if !signedIn}
				<a class="button primary" href="/login?next=pair">Sign in to approve</a>
			{:else}
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void action('inspect');
					}}
				>
					<label
						>Pairing code<input
							disabled={!hydrated || pending || retrySeconds > 0}
							bind:value={code}
							autocomplete="off"
							maxlength="11"
							oninput={() => {
								request = null;
								inspectedCode = '';
							}}
							required
						/></label
					>
					<button class="button primary" disabled={!hydrated || pending || retrySeconds > 0}
						>Check code</button
					>
				</form>
				{#if request}
					<div class="request-review">
						<p class="eyebrow">Browser requesting access</p>
						<h2>{request.name}</h2>
						{#if integrations.length}<label
								>Link to an integration<select
									aria-label="Link to an integration"
									disabled={!hydrated || pending || retrySeconds > 0}
									bind:value={integrationId}
									><option value="">Standalone browser</option
									>{#each integrations as integration}<option value={integration.id}
											>{integration.name}</option
										>{/each}</select
								></label
							>{/if}
						<p>
							Compare code <strong>{inspectedCode}</strong> with the requesting browser. Browser names
							are supplied by the requester.
						</p>
						<div class="pair-actions">
							<button
								class="button primary"
								disabled={!hydrated || pending || retrySeconds > 0}
								onclick={() => action('approve')}>Approve browser</button
							><button
								class="button secondary"
								disabled={!hydrated || pending || retrySeconds > 0}
								onclick={() => action('deny')}>Deny</button
							>
						</div>
					</div>
				{/if}
			{/if}
		{:else if grant}
			<p>
				In a browser where you can sign in, open <a
					href={grant.url}
					target="_blank"
					rel="noreferrer">{grant.url}</a
				> and enter:
			</p>
			<div class="pair-code">
				<p class="code">{grant.code}</p>
				<button
					class="button secondary"
					onclick={async () => {
						try {
							await navigator.clipboard.writeText(grant?.code ?? '');
							message = 'Pairing code copied.';
						} catch {
							message = 'Select the code to copy it.';
						}
					}}>Copy code</button
				>
			</div>
			<p class="waiting" role="status">Waiting for approval</p>
			<p class="pair-help">
				Expires at {new Date(grant.expires).toLocaleTimeString([], {
					hour: 'numeric',
					minute: '2-digit'
				})}. Keep this page open.
			</p>
			<button
				class="button secondary"
				onclick={() => {
					const current = grant;
					grant = null;
					if (current)
						void api('cancel', { token: current.token }).catch(() => {
							message = 'Could not cancel. The code expires after five minutes.';
						});
				}}>Cancel</button
			>
		{:else}
			<p>Use your normal browser or phone to approve this browser. No passkey is needed here.</p>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void action('start');
				}}
			>
				<label
					>Browser name<input
						disabled={!hydrated || pending || retrySeconds > 0}
						bind:value={name}
						maxlength="80"
						required
					/></label
				>
				<button class="button primary" disabled={!hydrated || pending || retrySeconds > 0}
					>Get pairing code</button
				>
			</form>
		{/if}
		<div
			class="pair-feedback"
			class:active={!!message || retrySeconds > 0}
			role="status"
			aria-live="polite"
		>
			{#if retrySeconds > 0}<p>
					Too many pairing attempts. Try again in {retrySeconds}s.
				</p>{:else if message}<p>{message}</p>{/if}
		</div>
	</div>
</div>

<style>
	.pair-sky {
		min-height: 100svh;
		padding: clamp(1rem, 5vh, 3rem) 1rem;
		display: grid;
		align-items: start;
		justify-items: center;
		background: var(--rail);
		position: relative;
		isolation: isolate;
	}
	.pair-card {
		width: min(100%, 34rem);
		padding: clamp(1.25rem, 4vw, 2rem);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
	}
	.pair-brand {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font:
			2rem 'Newsreader Variable',
			serif;
		text-decoration: none;
		color: var(--text);
		margin-bottom: 1.5rem;
	}
	.pair-brand :global(svg) {
		width: 28px;
		height: 28px;
	}
	.pair-card h1 {
		font-size: clamp(2rem, 6vw, 2.5rem);
		margin-bottom: 1rem;
	}
	.pair-card p {
		margin: 0.75rem 0;
		overflow-wrap: anywhere;
	}
	.pair-card form {
		margin-top: 1rem;
	}
	.pair-help {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.pair-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-top: 1rem;
	}
	.request-review {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.pair-code {
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
		border-radius: 10px;
		padding: 0.75rem;
		text-align: center;
		margin: 1rem 0;
	}
	.waiting {
		font-weight: 600;
	}
	.pair-feedback {
		block-size: 5rem;
		margin-top: 1rem;
		overflow-y: auto;
		background: transparent;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.pair-feedback.active {
		background: var(--accent-soft);
	}
	.pair-feedback p {
		margin: 0;
	}

	h1 {
		font-size: 2.5rem;
	}
	p {
		line-height: 1.6;
	}
	form,
	label {
		display: grid;
		gap: 1rem;
	}
	input,
	select {
		font: inherit;
		padding: 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		min-height: 44px;
		max-width: 100%;
		min-width: 0;
		background: var(--surface);
		color: var(--text);
	}
	button {
		cursor: pointer;
	}
	.code {
		font-size: 2rem;
		letter-spacing: 0.15em;
		overflow-wrap: anywhere;
	}
</style>
