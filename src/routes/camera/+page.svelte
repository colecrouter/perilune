<script lang="ts">
	import { onMount } from 'svelte';
	import AppShell from '#lib/components/AppShell.svelte';
	import { getPrinter } from '../printer.remote.js';
	let { data } = $props();
	const printer = getPrinter();
	const snapshot = $derived(printer.current ?? data.initial!.printer);
	let status = $state<{
		enabled: boolean;
		revision: number;
		name: string | null;
		status: string;
		message: string;
	} | null>(null);
	let candidates = $state<Array<{ id: string; name: string; protocol: string }>>([]);
	let candidate = $state('manual');
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
	let controller: AbortController | undefined;
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
		controller = new AbortController();
		void fetch('/api/camera/setup', { signal: controller.signal, cache: 'no-store' })
			.then(async (response) => {
				if (!response.ok) throw Error('Camera settings could not load. Reload to try again.');
				const body = await response.json();
				status = body.status;
				candidates = body.candidates;
			})
			.catch((cause) => {
				if (!controller?.signal.aborted) failure = cause.message;
			});
		return () => controller?.abort();
	});
	async function send(operation: 'test' | 'save' | 'reset') {
		if (pending) return;
		if (operation === 'test') tested = null;
		pending = operation;
		message = '';
		failure = '';
		const submitted = draft;
		try {
			const response = await fetch('/api/camera/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller?.signal,
				body: JSON.stringify(
					operation === 'reset'
						? { operation, revision: status?.revision }
						: operation === 'save'
							? { operation, token: tested?.token }
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
				)
			});
			const body = await response.json();
			if (!response.ok)
				throw Error(body.message ?? 'Camera setup failed. Check the connection and try again.');
			if (operation === 'test') {
				previewFailed = false;
				tested = body;
				testedDraft = submitted;
				message =
					body.codec === 'JPEG'
						? 'Image connection verified. Save to use this camera.'
						: 'Video connection verified. Save to use this camera.';
			} else {
				status = body;
				tested = null;
				if (operation === 'save' && draft === submitted) {
					streamUrl = '';
					snapshotUrl = '';
				}
				message =
					operation === 'reset'
						? 'Managed camera disconnected. The previous connection is restored, if configured.'
						: 'Camera saved. It is ready on the overview.';
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
		{#if status}
			<section class="panel">
				<h2>Current camera</h2>
				<p>{status.name ?? 'Using the existing camera connection, if configured.'}</p>
				{#if status.message}<p role="status">{status.message}</p>{/if}<a href="/">Open overview</a
				>{#if status.name}<details class="disconnect">
						<summary>Disconnect this camera</summary>
						<p>This restores the previous external camera connection, if configured.</p>
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
						<code>compose.camera.yaml</code>. Existing external camera connections continue to work.
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
							>Camera source<select bind:value={candidate}
								><option value="manual">Enter an endpoint</option>{#each candidates as item}<option
										value={item.id}>{item.name} · {item.protocol}</option
									>{/each}</select
							></label
						>
						{#if candidate === 'manual'}
							<label
								>Connection type<select bind:value={mediaKind}
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
								disabled={Boolean(pending)}
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
