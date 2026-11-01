<script lang="ts">
	let { value, onDismiss }: { value: string; onDismiss: () => void } = $props();
	let revealed = $state(false);
	let copied = $state(false);
	let copying = $state(false);
	let feedback = $state('');
	$effect(() => {
		void value;
		revealed = false;
		copied = false;
		feedback = '';
	});
	async function copy() {
		if (copying) return;
		copying = true;
		const current = value;
		try {
			await navigator.clipboard.writeText(current);
			if (value === current) {
				copied = true;
				feedback = 'Key copied to clipboard.';
			}
		} catch {
			if (value === current) {
				copied = false;
				feedback = 'Could not copy. Reveal the key and select it to copy manually.';
			}
		} finally {
			copying = false;
		}
	}
</script>

<div class="secret">
	<p>Copy this key now. After leaving this page, create a replacement if you lose it.</p>
	<input
		type={revealed ? 'text' : 'password'}
		{value}
		readonly
		aria-label="New slicer key"
		autocomplete="off"
		spellcheck="false"
	/>
	<div class="secret-actions">
		<button class="button secondary" disabled={copying} onclick={copy}
			>{copied ? 'Copied' : 'Copy key'}</button
		>
		<button
			class="button secondary"
			aria-pressed={revealed}
			onclick={() => {
				revealed = !revealed;
			}}>{revealed ? 'Hide' : 'Reveal'} key</button
		>
		<button class="button secondary" onclick={onDismiss}>Dismiss key</button>
	</div>
	<div class="secret-feedback" role="status" aria-live="polite">{feedback}</div>
</div>

<style>
	.secret {
		display: grid;
		gap: 0.85rem;
		margin: 1rem 0;
		padding: 1.25rem;
		background: var(--background);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.secret p {
		margin: 0;
	}
	input {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 0.6rem 0.9rem;
		font: inherit;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
	}
	.secret-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.button {
		min-inline-size: 8rem;
	}
	.button:not(:disabled):hover {
		background: var(--highlight);
		color: var(--highlight-text);
		border-color: var(--accent);
	}
	.button:not(:disabled):active {
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.secret-feedback {
		block-size: 3rem;
		overflow-y: auto;
		overflow-wrap: anywhere;
		color: var(--muted);
	}
</style>
