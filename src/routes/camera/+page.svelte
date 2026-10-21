<script lang="ts">
	import { onMount } from 'svelte';
	import { getCameraSetup, getLocalCameras, updateCameraSetup } from './camera.remote.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import { getPrinter } from '../printer.remote.js';
	let { data } = $props();
	const printer = getPrinter();
	const snapshot = $derived(printer.current ?? data.initial!.printer);
	const settings = getCameraSetup();
	const initialSetup = await settings;
	const setup = $derived(settings.current ?? initialSetup);
	const status = $derived(setup.status);
	const candidates = $derived(setup.candidates);
	let candidate = $state('manual');
	let localCandidate = $state('');
	let localDevices = $state<Array<{ id: string; name: string; protocol: string }>>([]);
	let scanned = $state(false);
	let scanning = $state(false);
	let captureHost = $state('printer');
	let name = $state('Printer camera');
	let mediaKind = $state<'network' | 'snapshot'>('network');
	let streamUrl = $state('');
	let snapshotUrl = $state('');
	let rotation = $state(0);
	let flipHorizontal = $state(false);
	let flipVertical = $state(false);
	let pending = $state('');
	let message = $state('');
	let failure = $state('');
	let tested = $state<{ token: string; name: string; codec: string } | null>(null);
	const draft = $derived(
		JSON.stringify({
			mediaKind,
			candidate,
			localCandidate,
			name,
			streamUrl,
			snapshotUrl,
			rotation,
			flipHorizontal,
			flipVertical
		})
	);
	let testedDraft = $state('');
	let previewFailed = $state(false);
	const canSave = $derived(tested && draft === testedDraft);
	let controller = $state<AbortController>();
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
		controller = new AbortController();

		return () => controller?.abort();
	});
	async function scanLocal() {
		if (scanning) return;
		scanning = true;
		failure = '';
		try {
			const devices = getLocalCameras();
			await devices.refresh();
			localDevices = await devices;
			scanned = true;
			if (!localDevices.some((item) => item.id === localCandidate)) localCandidate = '';
		} catch {
			failure =
				'Local cameras could not be checked. Verify the camera service is running and try again.';
		} finally {
			scanning = false;
		}
	}

	async function send(operation: 'test' | 'save' | 'reset') {
		if (pending) return;
		if (operation === 'test') tested = null;
		pending = operation;
		message = '';
		failure = '';
		const submitted = draft;
		try {
			const body = await updateCameraSetup(
				operation === 'reset'
					? { operation, revision: status?.revision }
					: operation === 'save'
						? { operation, token: tested?.token }
						: candidate === 'local'
							? { operation, localCandidate }
							: candidate === 'manual'
								? {
										operation,
										input: {
											kind: mediaKind,
											name,
											streamUrl,
											snapshotUrl,
											rotation,
											flipHorizontal,
											flipVertical
										}
									}
								: { operation, candidate }
			);
			if (operation === 'test') {
				previewFailed = false;
				tested = body as typeof tested;
				testedDraft = submitted;
				message =
					(body as { codec: string }).codec === 'JPEG'
						? 'Image connection verified. Save to use this camera.'
						: 'Video connection verified. Save to use this camera.';
			} else {
				tested = null;
				if (operation === 'save' && draft === submitted) {
					streamUrl = '';
					snapshotUrl = '';
				}
				message =
					operation === 'reset'
						? 'Camera disconnected.'
						: 'Camera saved. It is ready on the overview.';
				try {
					await settings.refresh();
				} catch {
					failure =
						'The change was saved, but current settings could not refresh. Your edits are preserved. Refresh settings to try again.';
				}
			}
		} catch (cause) {
			if (!controller?.signal.aborted)
				failure = cause instanceof Error ? cause.message : 'Camera setup failed.';
		} finally {
			pending = '';
		}
	}
</script>

<svelte:head><title>Camera settings · Perilune</title></svelte:head>
<AppShell {snapshot} active="Overview"
	><div class="camera-page page-frame serif">
		<header>
			<h1>Camera settings</h1>
			<p class="muted">
				Connect a printer webcam or IP camera. Video stays behind your Perilune login.
			</p>
		</header>
		{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
		{#if settings.error}<button
				class="button secondary"
				disabled={settings.loading}
				onclick={async () => {
					try {
						await settings.refresh();
						failure = '';
					} catch {
						failure = 'Current settings could not refresh. Your edits are preserved.';
					}
				}}>Refresh settings</button
			>{/if}
		{#if status}
			<section class="panel">
				<h2>Current camera</h2>
				<p>{setup.current.configured ? setup.current.name : 'No camera connected'}</p>
				<p class="muted">
					{setup.current.configured
						? 'Connected through Perilune’s camera service.'
						: 'Choose a source below to connect your first camera.'}
				</p>
				{#if status.message}<p role="status">{status.message}</p>{/if}<a href="/">Open overview</a
				>{#if status.name}<details class="disconnect">
						<summary>Disconnect this camera</summary>
						<p>This stops camera playback. You can connect a camera again below.</p>
						<button
							class="button secondary"
							disabled={Boolean(pending)}
							onclick={() => void send('reset')}>Confirm disconnect</button
						>
					</details>{/if}
			</section>
			{#if !status.enabled}<section class="panel">
					<h2>Enable camera setup</h2>
					<p>
						The managed camera companion needs to be enabled on this server before you can add a
						source here.
					</p>
					<p>
						For Docker installations, start with both <code>compose.yaml</code> and
						<code>compose.camera.yaml</code>. Camera sources are tested and saved here.
					</p>
					<a
						href="https://github.com/colecrouter/perilune/blob/main/docs/camera-compatibility.md"
						target="_blank"
						rel="noreferrer">Camera setup and supported sources ↗</a
					>
				</section>
			{:else}<section class="panel">
					<h2>Add or replace camera</h2>
					<p class="muted">
						Testing keeps the current camera in place. Save only after the connection succeeds.
					</p>
					<form
						onsubmit={(event) => {
							event.preventDefault();
							void send('test');
						}}
					>
						<label
							>Camera source<select bind:value={candidate} disabled={!controller}
								><option value="manual">Network or printer-host camera</option><option value="local"
									>USB camera on this server</option
								>{#each candidates as item}<option value={item.id}
										>{item.name} · {item.protocol}</option
									>{/each}</select
							></label
						>
						{#if candidate === 'local'}
							<p class="muted">
								Find USB / Linux cameras attached to the computer running Perilune’s camera service.
								Cameras attached to a remote printer belong under Network or printer-host camera.
							</p>
							<button
								class="button secondary"
								type="button"
								disabled={scanning || Boolean(pending)}
								onclick={() => void scanLocal()}
								>{scanning ? 'Checking devices…' : 'Find local cameras'}</button
							>
							{#if localDevices.length}
								<label
									>Capture profile<select bind:value={localCandidate}
										><option value="">Choose a detected profile</option
										>{#each localDevices as item}<option value={item.id}>{item.name}</option
											>{/each}</select
									></label
								>
								<p class="muted help">
									Prefer H.264 when offered; MJPEG may need conversion. Close other capture software
									before testing a device.
								</p>
							{:else if scanned}<p role="status">
									No supported local cameras found. Attach a camera and map its video device into
									the camera service, then check again.
								</p>{/if}
							<details>
								<summary>Allow a local USB device</summary>
								<p>
									Linux installations can add <code>compose.camera-usb.yaml</code> alongside the
									normal camera Compose files. Set <code>PERILUNE_CAMERA_DEVICE</code> to the host’s camera
									device. This grants access to one camera, without privileged mode. A camera already
									captured by Crowsnest should use its network stream instead.
								</p>
								<a
									href="https://github.com/colecrouter/perilune/blob/main/docs/camera-setup.md#local-usb-capture"
									target="_blank"
									rel="noreferrer">USB installation guide ↗</a
								>
							</details>
						{:else if candidate === 'manual'}
							<label
								>Camera location<select bind:value={captureHost}
									><option value="printer">USB / CSI on the printer computer</option><option
										value="ip">IP camera or another network source</option
									></select
								></label
							>
							{#if captureHost === 'printer'}<p class="muted help">
									Klipper controls the printer; Crowsnest, ustreamer or camera-streamer captures the
									camera. Choose an imported Moonraker entry above when available, or enter that
									capture service’s stream below. The service must run on the computer with the
									camera attached.
								</p>
								<details>
									<summary>No imported printer cameras?</summary>
									<p>
										Check Moonraker’s webcam configuration. Relative webcam paths require the
										printer web origin on the Perilune server; it can differ from Moonraker’s API
										port. You can also enter the full stream endpoint below.
									</p>
									<a href="https://crowsnest.mainsail.xyz/" target="_blank" rel="noreferrer"
										>Crowsnest setup guide ↗</a
									>
								</details>{:else}<p class="muted help">
									Prefer the camera’s H.264 RTSP stream when available. HTTP video and MJPEG are
									also supported; the camera’s viewer page is not a stream endpoint.
								</p>{/if}
							<label
								>Connection type<select bind:value={mediaKind} disabled={!controller}
									><option value="network">Video stream</option><option value="snapshot"
										>Snapshot-only camera</option
									></select
								></label
							>
							<label>Name<input bind:value={name} required maxlength="120" /></label>
							<label
								>{mediaKind === 'snapshot' ? 'Image endpoint' : 'Video endpoint'}<input
									bind:value={streamUrl}
									required
									autocomplete="off"
									spellcheck="false"
									placeholder={mediaKind === 'snapshot'
										? 'HTTP(S) JPEG endpoint'
										: 'RTSP or HTTP(S) endpoint'}
								/></label
							>
							<p class="muted help">
								{mediaKind === 'snapshot'
									? 'Still images refresh on demand; this does not create a video stream.'
									: 'Use the camera’s stream endpoint, rather than its viewer page.'} Endpoints and credentials
								stay on the server. Relative webcam paths need the printer web origin configured.
							</p>
							{#if mediaKind === 'network'}<label
									>Snapshot endpoint (optional)<input
										bind:value={snapshotUrl}
										autocomplete="off"
										spellcheck="false"
										placeholder="HTTP(S) image endpoint"
									/></label
								>
							{/if}

							<div class="orientation">
								<label
									>Rotation<select bind:value={rotation}
										><option value={0}>0°</option><option value={90}>90°</option><option value={180}
											>180°</option
										><option value={270}>270°</option></select
									></label
								><label class="check"
									><input type="checkbox" bind:checked={flipHorizontal} />Flip horizontally</label
								><label class="check"
									><input type="checkbox" bind:checked={flipVertical} />Flip vertically</label
								>
							</div>
						{/if}
						<div class="actions">
							<button
								class="button secondary"
								type="submit"
								disabled={Boolean(pending) || (candidate === 'local' && !localCandidate)}
								aria-busy={pending === 'test'}
								>{pending === 'test' ? 'Testing camera…' : 'Test connection'}</button
							><button
								class="button primary"
								type="button"
								disabled={!canSave || Boolean(pending)}
								aria-busy={pending === 'save'}
								onclick={() => void send('save')}
								>{pending === 'save' ? 'Saving…' : 'Save camera'}</button
							>
						</div>
					</form>
					{#if canSave && tested}<div class="preview">
							<h3>Snapshot preview</h3>
							{#if previewFailed}<p class="muted">
									Snapshot preview is unavailable. The connection passed its test.
								</p>{:else}<img
									src={`/api/camera/setup-preview?token=${encodeURIComponent(tested.token)}`}
									alt="Preview from the tested camera"
									onerror={() => (previewFailed = true)}
								/>{/if}
						</div>{/if}
					{#if message}<p role="status">{message}</p>{/if}
					{#if tested && draft !== testedDraft}<p class="muted">
							Settings changed. Test the updated connection before saving.
						</p>{/if}
				</section>{/if}
		{:else if !failure}<p role="status">Loading camera settings…</p>{/if}
	</div></AppShell
>

<style>
	.disconnect {
		margin-top: 1rem;
	}
	.disconnect summary {
		cursor: pointer;
	}
	.preview {
		margin-top: 1.5rem;
	}
	.preview img {
		display: block;
		width: 100%;
		max-width: 36rem;
		border-radius: 0.75rem;
	}
	h3 {
		font-size: 1rem;
	}
	.camera-page {
		--page-content-max: 56rem;
	}
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 1rem;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}
	h2 {
		margin: 0 0 1rem;
	}
	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.4rem;
		font-weight: 600;
	}
	input,
	select {
		min-height: 44px;
		border-radius: 7px;
		border: 1px solid var(--border-strong);
		padding: 0.6rem 0.8rem;
		font: inherit;
		color: var(--text);
		background: var(--surface);
		width: 100%;
		min-width: 0;
	}
	.help {
		font-size: 0.85rem;
		margin: 0;
	}
	.orientation,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
	}
	.check {
		display: flex;
		align-items: center;
		font-weight: 400;
	}
	.check input {
		min-height: 0;
		width: auto;
	}
	@media (max-width: 600px) {
		.actions button {
			width: 100%;
		}
		.panel {
			padding: 1rem;
		}
	}
</style>
