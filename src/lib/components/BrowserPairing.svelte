<script lang="ts">
	import { onMount } from 'svelte';
	let { approve = false, signedIn = false }: { approve?: boolean; signedIn?: boolean } = $props();
	let name = $state('Desktop slicer');
	let code = $state('');
	let request = $state<{ name: string; expires: number } | null>(null);
	let grant = $state<{ code: string; token: string; expires: number; url: string } | null>(null);
	let message = $state('');
	let pending = $state(false);
	let inspectedCode = $state('');
	let integrationId = $state('');
	let integrations = $state<{ id: string; name: string }[]>([]);
	const controller = new AbortController();
	async function api(operation: string, body: unknown) {
		const response = await fetch(`/api/pairing/${operation}`, {
			method: 'POST',
			signal: controller.signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.message ?? 'Pairing failed.');
		return result;
	}
	async function action(operation: string) {
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
			message = cause instanceof Error ? cause.message : 'Pairing failed.';
		} finally {
			pending = false;
		}
	}
	onMount(() => {
		if (approve && signedIn)
			void fetch('/api/jobs/keys')
				.then(async (response) => {
					if (response.ok) integrations = (await response.json()).keys;
				})
				.catch(() => {});
		let polling = false;
		const timer = setInterval(async () => {
			if (!grant || polling || approve) return;
			if (Date.now() >= grant.expires) {
				grant = null;
				message = 'Pairing expired. Start again.';
				return;
			}
			polling = true;
			const current = grant;
			try {
				const result = await api('poll', { token: current.token });
				if (result.approved && grant === current) location.assign('/');
			} catch (cause) {
				if (!controller.signal.aborted && grant === current) {
					message = cause instanceof Error ? cause.message : 'Could not check pairing.';
					grant = null;
				}
			} finally {
				polling = false;
			}
		}, 3000);
		return () => {
			clearInterval(timer);
			controller.abort();
		};
	});
</script>

<div class="pair-card serif">
	<a href="/login">Perilune</a>
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
					>Pairing code<input bind:value={code} autocomplete="off" maxlength="11" required /></label
				>
				<button disabled={pending}>Check code</button>
			</form>
			{#if request}
				<h2>{request.name}</h2>
				{#if integrations.length}<label
						>Link to an integration<select
							aria-label="Link to an integration"
							bind:value={integrationId}
							><option value="">Standalone browser</option
							>{#each integrations as integration}<option value={integration.id}
									>{integration.name}</option
								>{/each}</select
						></label
					>{/if}
				<p>
					Compare code <strong>{inspectedCode}</strong> with the requesting browser. Browser names are
					supplied by the requester.
				</p>
				<button disabled={pending} onclick={() => action('approve')}>Approve browser</button>
				<button disabled={pending} onclick={() => action('deny')}>Deny</button>
			{/if}
		{/if}
	{:else if grant}
		<p>
			In a browser where you can sign in, open <a href={grant.url} target="_blank" rel="noreferrer"
				>{grant.url}</a
			> and enter:
		</p>
		<p class="code">{grant.code}</p>
		<p>Waiting for approval. This code expires in five minutes. Keep this page open.</p>
		<button
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
			<label>Browser name<input bind:value={name} maxlength="80" required /></label>
			<button disabled={pending}>Get pairing code</button>
		</form>
	{/if}
	{#if message}<p role="status">{message}</p>{/if}
</div>

<style>
	.pair-card {
		max-width: 600px;
		margin: 8vh auto;
		padding: 2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
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
	select,
	button {
		font: inherit;
		padding: 0.75rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		min-height: 44px;
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
