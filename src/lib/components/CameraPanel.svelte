<script lang="ts">
	import { captureCamera } from '../../routes/camera/camera.remote.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { CameraDescriptor } from '#lib/domain/camera.js';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import { playCamera } from '#lib/client/camera-player.js';
	let { camera }: { camera: CameraDescriptor } = $props();
	let video = $state<HTMLVideoElement>();
	let mounted = $state(false);
	let visible = $state(true);
	let retry = $state(0);
	let snapshotRefresh = $state(0);
	let quality = $state('original');
	let nativeHls = $state(false);
	let transportKey = '';
	let nativeAttempted = false;
	const selectedQuality = $derived(
		camera.qualities?.some((item) => item.id === quality) ? quality : 'original'
	);
	function qualityUrl(url: string | null) {
		if (!url || !camera.qualities) return url;
		return `${url}?quality=${encodeURIComponent(selectedQuality)}`;
	}
	function chooseQuality(value: string) {
		quality = value;
		try {
			localStorage.setItem('perilune.camera.quality', value);
		} catch {
			/* Storage may be unavailable. */
		}
	}
	let status = $state<'connecting' | 'live' | 'reconnecting' | 'unsupported'>('connecting');
	let message = $state('');
	let capturing = $state(false);
	let captureAbort: AbortController | undefined;
	let captureError = $state('');
	let failures = 0;
	let pausedByUser = $state(false);
	let canFullscreen = $state(false);
	const showFallback = $derived(!visible || pausedByUser || status !== 'live');
	const fallbackTitle = $derived(
		!visible || pausedByUser
			? 'Camera playback paused'
			: status === 'reconnecting'
				? 'Reconnecting to camera'
				: status === 'unsupported'
					? 'Camera video unavailable'
					: 'Connecting to camera'
	);
	const transform = $derived(
		`translate(-50%, -50%) rotate(${camera.rotation}deg) scale(${camera.flipHorizontal ? -1 : 1}, ${camera.flipVertical ? -1 : 1})`
	);
	onMount(() => {
		try {
			quality = localStorage.getItem('perilune.camera.quality') ?? 'original';
		} catch {
			/* Use the original stream. */
		}
		mounted = true;
		canFullscreen = document.fullscreenEnabled;
		const visibility = () => {
			visible = !document.hidden;
		};
		visibility();
		document.addEventListener('visibilitychange', visibility);
		return () => {
			document.removeEventListener('visibilitychange', visibility);
			captureAbort?.abort();
		};
	});
	// Remote snapshots replace descriptor objects on every printer update. Playback
	// depends only on primitive source identity, not the descriptor object reference.
	const streamUrl = $derived(qualityUrl(camera.streamUrl));
	const mseUrl = $derived(qualityUrl(camera.mseUrl));
	const configured = $derived(camera.configured);
	const generation = $derived(camera.generation);
	$effect(() => {
		const source = streamUrl;
		void generation;
		void retry;
		if (!mounted || !visible || pausedByUser || !configured || !source || !video) return;
		const nextTransportKey = `${generation}:${source}`;
		if (transportKey !== nextTransportKey) {
			transportKey = nextTransportKey;
			nativeHls = false;
			nativeAttempted = false;
		}
		const element = video;
		let closed = false;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		status = 'connecting';
		message = '';
		const failed = () => {
			if (closed || timer) return;
			if (nativeHls) {
				nativeHls = false;
				return;
			}
			status = 'reconnecting';
			message = 'Camera unavailable. Retrying automatically.';
			timer = setTimeout(
				() => {
					if (!closed) retry++;
				},
				Math.min(30_000, 2000 * 2 ** Math.min(failures++, 4))
			);
		};
		const playing = () => {
			if (!closed && !timer) {
				status = 'live';
				message = '';
				failures = 0;
			}
		};
		element.addEventListener('playing', playing);
		element.addEventListener('error', failed);
		if (typeof MediaSource !== 'undefined' && mseUrl && !nativeHls) {
			void playCamera(element, mseUrl, controller.signal, () => {
				if (!closed) message = 'Tap play to start the camera.';
			}).catch((cause) => {
				if (closed) return;
				if (
					cause instanceof Error &&
					['Camera format unsupported', 'Camera video could not be decoded'].includes(cause.message)
				) {
					if (!nativeAttempted && element.canPlayType('application/vnd.apple.mpegurl')) {
						nativeAttempted = true;
						nativeHls = true;
					} else {
						status = 'unsupported';
						message =
							'This browser could not decode the camera video. Try a lower quality or a current browser; snapshots are still available.';
					}
				} else failed();
			});
		} else if (element.canPlayType('application/vnd.apple.mpegurl')) {
			element.src = source;
			element.load();
			void element.play().catch((cause) => {
				if (closed) return;
				if (cause instanceof DOMException && cause.name === 'NotAllowedError')
					message = 'Tap play to start the camera.';
				else failed();
			});
		} else {
			status = 'unsupported';
			message =
				'This browser cannot play the camera video. Try a current browser; snapshots are still available.';
		}
		return () => {
			closed = true;
			clearTimeout(timer);
			controller.abort();
			element.removeEventListener('playing', playing);
			element.removeEventListener('error', failed);
			element.pause();
			element.removeAttribute('src');
			element.load();
		};
	});
	async function fullscreen() {
		try {
			await video?.parentElement?.requestFullscreen();
		} catch {
			captureError = 'Fullscreen could not open in this browser.';
		}
	}
	async function play() {
		message = '';
		try {
			await video?.play();
		} catch {
			message = 'Playback could not start. Retry the connection or try another browser.';
		}
	}
	async function capture() {
		if (!camera.snapshotUrl || capturing) return;
		capturing = true;
		captureError = '';
		try {
			captureAbort = new AbortController();
			const bytes = await captureCamera();
			if (captureAbort.signal.aborted) return;
			const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'perilune-camera.jpg';
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (cause) {
			captureError = cause instanceof Error ? cause.message : 'Could not capture camera image.';
		} finally {
			capturing = false;
		}
	}
</script>

<section class="panel camera-panel">
	<div class="section-header">
		<h2>Camera</h2>
		<span class="tag"
			>{!camera.configured
				? 'Not connected'
				: camera.snapshotOnly
					? 'Still image'
					: !visible || pausedByUser
						? 'Paused'
						: status === 'live'
							? 'Live'
							: status === 'unsupported'
								? 'Unsupported'
								: status === 'reconnecting'
									? 'Reconnecting'
									: 'Connecting'}</span
		>
	</div>
	{#if camera.configured && camera.snapshotOnly && camera.snapshotUrl}
		<div class="camera-video" class:portrait={camera.rotation === 90 || camera.rotation === 270}>
			{#key `${camera.generation}:${snapshotRefresh}`}<img
					src={`${camera.snapshotUrl}?refresh=${snapshotRefresh}`}
					alt={camera.name}
					style:transform
					onerror={() => (captureError = 'Image unavailable. Refresh to try again.')}
				/>{/key}
		</div>
		<div class="camera-tools">
			<small class="muted">Still image · refreshed on demand</small>
			<div class="camera-actions">
				<IconButton
					icon="retry"
					label="Refresh image"
					onclick={() => {
						captureError = '';
						snapshotRefresh++;
					}}
				/><IconButton
					icon="capture"
					label={capturing ? 'Capturing…' : 'Capture image'}
					onclick={capture}
					disabled={capturing}
					busy={capturing}
				/>
			</div>
		</div>
		{#if captureError}<p class="error-text" role="alert">{captureError}</p>{/if}
	{:else if camera.configured}
		<div class="camera-video" class:portrait={camera.rotation === 90 || camera.rotation === 270}>
			<video bind:this={video} style:transform autoplay muted playsinline aria-label={camera.name}
				><track kind="captions" /></video
			>
			{#if showFallback}<div class="camera-empty camera-fallback" role="status">
					<Icon name="camera" size={52} />
					<h3>{fallbackTitle}</h3>
					<p>Your camera will appear here through a secure app URL.</p>
				</div>{/if}
		</div>
		{#if camera.qualities && camera.qualities.length > 1}<label class="camera-quality"
				>Video quality<select
					value={selectedQuality}
					onchange={(event) => chooseQuality(event.currentTarget.value)}
					>{#each camera.qualities as item}<option value={item.id}>{item.label}</option
						>{/each}</select
				></label
			>{/if}
		<div class="camera-tools">
			<small class="muted">{camera.name}</small>
			<div class="camera-actions">
				<IconButton
					icon={pausedByUser ? 'play' : 'pause'}
					label={pausedByUser ? 'Resume view' : 'Pause view'}
					onclick={() => {
						pausedByUser = !pausedByUser;
					}}
				/>
				{#if canFullscreen}<IconButton
						icon="fullscreen"
						label="Fullscreen"
						onclick={fullscreen}
					/>{/if}
				<IconButton
					icon="capture"
					label={capturing ? 'Capturing…' : 'Capture image'}
					onclick={capture}
					disabled={capturing}
					busy={capturing}
				/>
			</div>
		</div>
		{#if !pausedByUser && visible && message}<div class="camera-message" role="status">
				<span>{message}</span>
				{#if status !== 'unsupported'}<div class="camera-actions">
						<IconButton icon="play" label="Play camera" onclick={play} /><IconButton
							icon="retry"
							label="Retry now"
							onclick={() => {
								failures = 0;
								retry++;
							}}
						/>
					</div>{/if}
			</div>{/if}
		{#if captureError}<p class="error-text" role="alert">{captureError}</p>{/if}
	{:else}
		<p class="camera-unconfigured muted">No camera configured.</p>
	{/if}
	{#if page.data.user?.role === 'owner'}<a class="camera-setup-link" href="/camera"
			>Camera settings</a
		>{/if}
</section>

<style>
	.camera-quality {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.8rem;
		font-size: 0.85rem;
	}
	.camera-quality select {
		min-height: 44px;
		border: 1px solid var(--border-strong);
		border-radius: 7px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		padding: 0.4rem 0.6rem;
		min-width: 0;
		width: auto;
		max-width: 65%;
	}
	.camera-setup-link {
		display: inline-block;
		margin-top: 0.8rem;
		font-size: 0.85rem;
	}
	.camera-unconfigured {
		margin: 0;
		font-size: 0.85rem;
	}
</style>
