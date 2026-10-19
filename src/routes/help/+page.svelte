<script lang="ts">
	import AppShell from '#lib/components/AppShell.svelte';
</script>

<svelte:head><title>Help & setup · Perilune</title></svelte:head>
<AppShell active="Help"
	><div class="help-page serif">
		<p class="eyebrow">Your flight guide</p>
		<h1>Help & setup</h1>
		<p>Find the next step for your printer, slicer, or device.</p>
		<nav aria-label="Help topics">
			<a href="#connecting">Connect a printer</a><a href="#printing">Print & change filament</a><a
				href="#slicers">Slicers & pairing</a
			><a href="#phones">Phone notifications</a><a href="#updates">Update & backup</a><a
				href="#access">Sign-in help</a
			>
		</nav>
		<section id="connecting">
			<h2>Connect a printer</h2>
			<p>
				If someone already hosts Perilune for you, open their panel address and sign in. You do not
				need another installation on your computer or printer.
			</p>
			<details>
				<summary>Hosting a new installation?</summary>
				<p>
					For a new installation, start in simulator mode, create an owner account using the
					server’s setup token, then configure the backend’s Moonraker WebSocket address. Live
					connections begin read-only; physical controls require separate server options and an
					attended test.
				</p>
				<a
					href="https://github.com/colecrouter/perilune/blob/main/docs/getting-started.md"
					target="_blank"
					rel="noreferrer">Installation and connection instructions ↗</a
				>
			</details>
		</section>
		<section id="printing">
			<h2>Before you print</h2>
			<ol>
				<li>Clear the bed, load the intended filament, and check the printer is ready.</li>
				<li>
					Open <a href="/jobs">Jobs</a>, select your sliced file, and inspect its material,
					estimates, and manual changes.
				</li>
				<li>Start the print explicitly. Uploading from the Jobs page never starts it.</li>
				<li>Stay with the printer for the first layer and any planned filament changes.</li>
			</ol>
			<p>
				Stop lets you choose nozzle and bed cooldown independently. Emergency stop immediately shuts
				down movement and heating; motors may release. It is separate from an ordinary print
				cancellation.
			</p>
			<details>
				<summary>Manual changes and pauses</summary>
				<p>
					File inspection recognizes explicit M600 filament changes and PAUSE, M0, M1, or M25 pause
					commands in text G-code up to 20 MiB. “None found” means no recognized command was
					present; “Not inspected” means we do not know. Custom macros can introduce additional
					pauses.
				</p>
				<p>
					The printer’s macros determine unloading, parking, purging, heating, and resuming. Follow
					the printer’s instructions. Some Resume macros perform a purge step and leave the print
					paused; inspect the messages and use Resume again only when the printer is ready. Do not
					assume the first click resumed printing.
				</p>

				<a
					href="https://www.klipper3d.org/G-Codes.html#pause_resume"
					target="_blank"
					rel="noreferrer">Klipper pause and resume reference ↗</a
				>
			</details>
		</section>
		<section id="slicers">
			<h2>Connect your slicer or another browser</h2>
			<p>
				In <a href="/account#integrations">Account → Integrations</a>, create a named key with
				Upload files or Upload and start prints access. In your slicer, choose Klipper / Moonraker
				and enter this panel’s address and the key. Keep API keys private.
			</p>
			<p>
				An embedded Device tab signs in separately: choose <a href="/pair/start"
					>Sign in with another browser</a
				>, then approve its code in a normal browser at <a href="/pair">Approve a browser</a>. You
				can revoke a key, sign out a paired browser, or disconnect both through Account. Browser
				sign-in expires 90 days after login or pairing; regular use does not extend it. Slicer key
				expiry is a separate choice.
			</p>
		</section>
		<section id="phones">
			<h2>Use Perilune on your phone</h2>
			<ol>
				<li>Open the existing HTTPS panel address and sign in.</li>
				<li>
					On iPhone or iPad, use Share → Add to Home Screen and open the installed app. On Android,
					use the browser’s Install or Add to Home Screen option.
				</li>
				<li>
					Open <a href="/account#notifications">Account → This device</a>, enable notifications, and
					send a test.
				</li>
				<li>
					Close the app and verify delivery. Choose the event types and quiet hours you want. By
					default, notices follow prints started by your account, including slicer integrations.
					Account offers separate options for anyone’s prints and shared printer errors.
				</li>
			</ol>
			<p>
				Notifications apply to this device. OS support, permissions, quiet hours, connectivity, and
				external login layers affect delivery. An accepted test means the push service accepted it;
				confirm it actually appears on your device. Notifications are best effort, so keep checking
				the printer.
			</p>
		</section>
		<section id="updates">
			<h2>Update without losing your setup</h2>
			<p>
				Updating has two parts: the person hosting Perilune updates the server, then browsers
				reload. The app’s “Reload to update” button refreshes your browser; it does not deploy a new
				server version.
			</p>
			<p>
				Save drafts, make a consistent database and signing-secret backup, update the server, and
				keep the existing data volume and private settings. Wait for health checks, then reload your
				panel. “Later” leaves your drafts in place.
			</p>
			<a
				href="https://github.com/colecrouter/perilune/blob/main/docs/getting-started.md#updating"
				target="_blank"
				rel="noreferrer">Update instructions ↗</a
			>
			·
			<a
				href="https://github.com/colecrouter/perilune/blob/main/docs/deployment.md#backups-and-restore"
				target="_blank"
				rel="noreferrer">Backups and recovery ↗</a
			>
		</section>
		<section id="access">
			<h2>Need help signing in?</h2>
			<p>
				Try your password, a passkey, or <a href="/pair/start"
					>approval from another signed-in browser</a
				>. If none are available, ask the person hosting Perilune to recover your account.
			</p>
			<a
				href="https://github.com/colecrouter/perilune/blob/main/docs/deployment.md"
				target="_blank"
				rel="noreferrer">Hosting and recovery guide ↗</a
			>
		</section>
		<p>
			<a href="https://github.com/colecrouter/perilune/issues" target="_blank" rel="noreferrer"
				>Report a problem or follow development ↗</a
			>. Include your app/browser versions and what happened; omit credentials, private addresses,
			configuration, and camera images.
		</p>
	</div></AppShell
>

<style>
	.help-page {
		max-width: 56rem;
		padding: clamp(1rem, 4vw, 3rem);
		margin: auto;
	}
	h1 {
		font-size: clamp(2rem, 5vw, 3rem);
	}
	h2 {
		font-size: 1.8rem;
	}
	p,
	li {
		line-height: 1.7;
	}
	p {
		margin: 0.8rem 0;
	}
	li {
		margin: 0.5rem 0;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1.5rem 0;
	}
	nav a {
		min-height: 44px;
		display: flex;
		align-items: center;
		padding: 0.6rem 0.8rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		text-decoration: none;
	}
	details {
		margin-top: 1rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}
	summary {
		cursor: pointer;
		padding: 0.65rem 0;
		min-height: 44px;
		font-weight: 500;
		color: var(--accent);
	}
	section {
		border-top: 1px solid var(--border);
		padding: 1.5rem 0;
		scroll-margin-top: 1rem;
	}
	a {
		color: var(--accent);
	}
	ol {
		padding-left: 1.4rem;
	}
</style>
