<script lang="ts">
	import { onMount } from 'svelte';
	import { defaultNoticePreferences } from '#lib/domain/notifications.js';
	import { installation } from '#lib/client/install.svelte.js';
	let installed = $state(false);
	let supported = $state(false);
	let ios = $state(false);
	let subscribed = $state(false);
	let pending = $state(false);
	let message = $state('');
	let edited = $state(false);
	let preferences = $state({ ...defaultNoticePreferences });
	let subscription: PushSubscription | null = null;
	async function request(action: string) {
		const response = await fetch('/api/notifications', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, subscription: subscription?.toJSON(), preferences })
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.message ?? 'Could not update notifications.');
		return result;
	}
	async function run(action: () => Promise<void>) {
		pending = true;
		message = '';
		try {
			await action();
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Please try again.';
		} finally {
			pending = false;
		}
	}
	onMount(() => {
		installed =
			matchMedia('(display-mode: standalone)').matches ||
			Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
		ios =
			/iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		supported =
			isSecureContext &&
			'serviceWorker' in navigator &&
			'PushManager' in window &&
			'Notification' in window;
		preferences.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		let active = true;
		if (supported)
			void navigator.serviceWorker
				.getRegistration()
				.then(async (registration) => {
					if (!registration || !active) return;
					subscription = await registration.pushManager.getSubscription();
					if (subscription && active) {
						const result = await request('status');
						if (active) {
							subscribed = Boolean(result.id);
							if (result.preferences && !edited) preferences = result.preferences;
						}
					}
				})
				.catch(() => {
					if (active) message = 'Could not load this device’s notification settings.';
				});
		return () => {
			active = false;
		};
	});
	async function enable() {
		// Request permission directly in the click gesture, before any network requests.
		const permission = await Notification.requestPermission();
		if (permission !== 'granted')
			throw new Error(
				'Notifications are blocked. Allow them in your browser or device settings to try again.'
			);
		const registration = await Promise.race([
			navigator.serviceWorker.ready,
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('The app worker is not ready. Reload Perilune and try again.')),
					10000
				)
			)
		]);
		const response = await fetch('/api/notifications');
		if (!response.ok) throw new Error('Sign in again to enable notifications.');
		const { publicKey } = await response.json();
		const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
		const key = Uint8Array.from(raw, (c: string) => c.charCodeAt(0));
		// Rotate an orphaned browser subscription after switching accounts or restoring a database.
		if (!subscribed) {
			const old = await registration.pushManager.getSubscription();
			if (old) await old.unsubscribe();
		}
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: key
		});
		await request('save');
		subscribed = true;
		message = 'Notifications enabled on this device.';
	}
	async function disable() {
		if (subscription) {
			await request('remove');
			await subscription.unsubscribe();
		}
		subscription = null;
		subscribed = false;
		message = 'Notifications disabled on this device.';
	}
</script>

<section class="device-card">
	<div class="heading">
		<img src="/icons/app-192.png" alt="" width="64" height="64" />
		<div>
			<p class="eyebrow">Your own little mission control</p>
			<h2>Perilune on this device</h2>
		</div>
	</div>
	{#if installed}<p>Installed and ready for launch.</p>{:else}<p>
			Keep Perilune on your Home Screen or desktop for a dedicated printer window.
		</p>
		{#if installation.prompt}<button
				class="button primary"
				disabled={pending}
				onclick={() =>
					run(async () => {
						await installation.prompt!.prompt();
						await installation.prompt!.userChoice;
						installation.prompt = null;
					})}>Install Perilune</button
			>{:else if ios}<p class="help">
				Open your browser’s Share menu, then choose <strong>Add to Home Screen</strong>. Enable Open
				as Web App if offered.
			</p>{:else}<p class="help">
				Look for “Install” or “Add to Home Screen” in your browser’s menu. Availability depends on
				your browser.
			</p>{/if}{/if}
	<div class="divider"></div>
	<h3>A signal when it matters</h3>
	<p>Receive updates even when Perilune is closed. These settings apply only to this device.</p>
	{#if ios && !installed}<p class="help">
			Install Perilune to your Home Screen, open it there, then enable notifications. Requires iOS
			or iPadOS 16.4 or later.
		</p>
	{:else if !supported}<p class="help">
			Push notifications aren’t available in this browser. Use a supported browser over HTTPS.
		</p>
	{:else}
		<fieldset disabled={pending} oninput={() => (edited = true)}>
			<legend>Notify me about</legend>
			<label><input type="checkbox" bind:checked={preferences.complete} />Completed prints</label>
			<label><input type="checkbox" bind:checked={preferences.failed} />Failed prints</label>
			<label><input type="checkbox" bind:checked={preferences.printerError} />Printer errors</label>
			<label
				><input type="checkbox" bind:checked={preferences.snapshot} />Include a camera snapshot when
				available</label
			>
			<p class="help">
				Notifications use generic text. Snapshots may appear on your lock screen on supported
				devices; private images expire after five minutes.
			</p>
			<label><input type="checkbox" bind:checked={preferences.quiet} />Quiet hours</label>
			{#if preferences.quiet}<div class="quiet">
					<label>From<input type="time" bind:value={preferences.quietStart} /></label><label
						>Until<input type="time" bind:value={preferences.quietEnd} /></label
					>
				</div>
				<label class="timezone">Time zone<input bind:value={preferences.timezone} /></label>
				<p class="help">
					Events during quiet hours are skipped. Equal start and end times silence the whole day.
				</p>{/if}
		</fieldset>
		<div class="actions">
			{#if subscribed}<button
					class="button primary"
					disabled={pending}
					onclick={() =>
						run(async () => {
							await request('save');
							message = 'Device preferences saved.';
						})}>Save preferences</button
				><button
					disabled={pending}
					onclick={() =>
						run(async () => {
							await request('test');
							message = 'Test notification sent. Check your device’s notifications.';
						})}>Send a test</button
				><button disabled={pending} onclick={() => run(disable)}>Disable notifications</button
				>{:else}<button class="button primary" disabled={pending} onclick={() => run(enable)}
					>{pending ? 'Enabling…' : 'Enable notifications'}</button
				>{/if}
		</div>
	{/if}
	{#if message}<p role="status">{message}</p>{/if}
</section>

<style>
	.device-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.5rem;
		margin: 1.5rem 0;
	}
	.heading {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.heading img {
		border-radius: 16px;
	}
	.eyebrow {
		margin: 0 0 0.3rem;
	}
	h2 {
		font-size: 1.7rem;
		margin: 0;
	}
	h3 {
		font-size: 1.2rem;
	}
	p {
		line-height: 1.6;
	}
	.help {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.divider {
		height: 1px;
		background: var(--border);
		margin: 1.5rem 0;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 1rem 0;
	}
	legend {
		font-weight: 600;
		margin-bottom: 0.6rem;
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 44px;
	}
	input[type='checkbox'] {
		width: 20px;
		height: 20px;
		accent-color: var(--accent);
	}
	.quiet {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.quiet label,
	.timezone {
		display: grid;
		gap: 0.3rem;
	}
	.timezone {
		max-width: 24rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	button,
	input:not([type='checkbox']) {
		min-height: 44px;
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		font: inherit;
		background: var(--surface);
		color: inherit;
		max-width: 100%;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
	}
	@media (max-width: 400px) {
		.heading {
			align-items: flex-start;
		}
		.heading img {
			width: 48px;
			height: 48px;
		}
		.device-card {
			padding: 1rem;
		}
	}
</style>
