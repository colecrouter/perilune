<script lang="ts">
	import { Dialog } from 'bits-ui';
	import {
		getAccess,
		createOwnerReset,
		revokeOwnerReset
	} from '../../routes/account/account.remote.js';
	let { target = $bindable(null) }: { target: { id: string; name: string; email: string } | null } =
		$props();
	const access = getAccess();
	const initial = await access;
	const status = $derived(access.current?.resetLinks ?? initial.resetLinks);
	let confirmed = $state(false),
		busy = $state(false),
		message = $state(''),
		historyMessage = $state('');
	let revealed = $state<{ id: string; url: string; expires: number } | null>(null);
	let generation = 0;
	function close() {
		generation++;
		target = null;
		confirmed = false;
		revealed = null;
		message = '';
	}
	async function create() {
		if (!target || !confirmed || busy) return;
		const current = target.id,
			version = ++generation;
		busy = true;
		message = '';
		revealed = null;
		try {
			const result = await createOwnerReset({ target: current, confirmed: true });
			if (version === generation && target?.id === current) revealed = result;
			await access.refresh();
		} catch (cause) {
			if (version === generation)
				message =
					(cause instanceof Error ? cause.message : 'Could not create the reset link.') +
					' Check the link history before creating another.';
			try {
				await access.refresh();
			} catch {
				/* Keep the outcome message. */
			}
		} finally {
			busy = false;
		}
	}
	async function revoke(id: string) {
		if (busy) return;
		busy = true;
		historyMessage = '';
		try {
			await revokeOwnerReset(id);
			if (revealed?.id === id) revealed = null;
			await access.refresh();
			historyMessage = 'Reset link revoked.';
		} catch (cause) {
			historyMessage = cause instanceof Error ? cause.message : 'Could not revoke the link.';
		} finally {
			busy = false;
		}
	}
	async function copy() {
		if (!revealed) return;
		try {
			await navigator.clipboard.writeText(revealed.url);
			message = 'Reset link copied.';
		} catch {
			message = 'Select the reset link to copy it.';
		}
	}
</script>

<section class="account-card reset-history" aria-labelledby="reset-links-heading">
	<h2 id="reset-links-heading">Password reset links</h2>
	<p class="help">
		Use “Reset password…” beside an operator or viewer account to help them recover access without
		email. Owner accounts use the host recovery procedure.
	</p>
	{#if historyMessage}<p role="status">{historyMessage}</p>{/if}
	{#each status?.links ?? [] as link (link.id)}
		<div class="reset-row">
			<div>
				<strong>{link.target}</strong><small
					>{link.status} · Created by {link.actor} · {new Date(
						link.created
					).toLocaleString()}</small
				>
			</div>
			{#if link.status === 'active'}<button
					class="button secondary"
					disabled={busy}
					onclick={() => revoke(link.id)}
					aria-label={`Revoke reset link for ${link.target}`}>Revoke link</button
				>{/if}
		</div>
	{:else}<p class="help">No owner-generated reset links.</p>{/each}
</section>

<Dialog.Root
	open={target !== null}
	onOpenChange={(open) => {
		if (!open) close();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content owner-reset-dialog">
			<Dialog.Title class="dialog-title">Reset {target?.name}’s password</Dialog.Title>
			<Dialog.Description class="muted"
				>Create a private, single-use link for {target?.email}. Share it directly with this person.
				It expires in 10 minutes.</Dialog.Description
			>
			{#if revealed}
				<p>
					Link ready. Creating it has not changed the password or signed out any browsers. The link
					is shown only here; closing this dialog hides it.
				</p>
				<label
					>Reset link<input
						class="reset-link"
						readonly
						value={revealed.url}
						onfocus={(event) => event.currentTarget.select()}
						autocomplete="off"
					/></label
				>
				<p class="muted">Expires {new Date(revealed.expires).toLocaleTimeString()}.</p>
				<button class="button primary" onclick={copy}>Copy reset link</button>
			{:else}
				<p>
					Using the link changes their password and signs out their browsers, including paired
					browsers. Passkeys, slicer keys and notification registrations stay available. Their email
					verification status stays unchanged.
				</p>
				{#if status?.recent}
					<label class="reset-confirm"
						><input type="checkbox" bind:checked={confirmed} disabled={busy} />I checked this
						account and will share the link only with its owner.</label
					>
					<button class="button primary" disabled={!confirmed || busy} onclick={create}
						>{busy ? 'Creating…' : 'Create reset link'}</button
					>
				{:else}
					<p>
						Confirm a recent password or passkey sign-in before creating a reset link.
						Paired-browser sign-in does not confirm this action.
					</p>
					<a class="button primary" href="/login?reauth=1">Confirm your sign-in</a>
				{/if}
			{/if}
			{#if message}<p role="status">{message}</p>{/if}
			{#if status?.recent}<p class="muted">
					<a href="/login?reauth=1">Sign in again</a> if your confirmation has expired.
				</p>{/if}
			<div class="dialog-actions"><Dialog.Close class="button secondary">Close</Dialog.Close></div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.owner-reset-dialog p) {
		margin: 0.8rem 0;
	}
	.reset-history {
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}
	h2 {
		margin: 0 0 1rem;
	}
	.help,
	small {
		color: var(--muted);
		line-height: 1.5;
	}
	.reset-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 0;
		border-top: 1px solid var(--border);
	}
	small {
		display: block;
		margin-top: 0.3rem;
	}
	.reset-confirm {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		margin: 1rem 0;
		line-height: 1.5;
	}
	.reset-confirm input {
		flex: none;
		margin-top: 0.3rem;
	}
	.reset-link {
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.5rem;
	}
	@media (max-width: 36rem) {
		.reset-row {
			align-items: flex-start;
			flex-direction: column;
		}
		.reset-row button {
			width: 100%;
		}
	}
</style>
