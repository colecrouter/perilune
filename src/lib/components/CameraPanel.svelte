<script lang="ts">
	import { onMount } from 'svelte';
	import type { CameraDescriptor } from '#lib/domain/camera.js';
	import Icon from './Icon.svelte';
	import { playCamera } from '#lib/client/camera-player.js';
	let { camera }: { camera: CameraDescriptor } = $props();
	let video = $state<HTMLVideoElement>();
	let mounted = $state(false);
	let visible = $state(true);
	let retry = $state(0);
	let status = $state<'connecting' | 'live' | 'reconnecting' | 'unsupported'>('connecting');
	let message = $state('');
	let capturing = $state(false);
	let captureAbort: AbortController | undefined;
	let captureError = $state('');
	let failures = 0;
	let pausedByUser = $state(false);
	let canFullscreen = $state(false);
	const transform = $derived(
		`translate(-50%, -50%) rotate(${camera.rotation}deg) scale(${camera.flipHorizontal ? -1 : 1}, ${camera.flipVertical ? -1 : 1})`
	);
	onMount(() => {
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
	$effect(() => {
		const source = camera.streamUrl;
		const generation = camera.generation;
		void generation;
		void retry;
		if (!mounted || !visible || pausedByUser || !camera.configured || !source || !video) return;
		const element = video;
		let closed = false;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		status = 'connecting';
		message = '';
		const failed = () => {
			if (closed || timer) return;
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
		if (typeof MediaSource !== 'undefined' && camera.mseUrl) {
			void playCamera(element, camera.mseUrl, controller.signal, () => {
				if (!closed) message = 'Tap play to start the camera.';
			}).catch(() => {
				if (!closed) failed();
			});
		} else if (element.canPlayType('application/vnd.apple.mpegurl')) {
			element.src = source;
			element.load();
			void element.play().catch(() => {
				if (!closed) message = 'Tap play to start the camera.';
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
			const response = await fetch(camera.snapshotUrl, {
				cache: 'no-store',
				signal: captureAbort.signal
			});
			if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg'))
				throw new Error('Snapshot unavailable. Live video may still work; try again shortly.');
			const url = URL.createObjectURL(await response.blob());
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
	{#if camera.configured}
		<div class="camera-video" class:portrait={camera.rotation === 90 || camera.rotation === 270}>
			<video bind:this={video} style:transform autoplay muted playsinline aria-label={camera.name}
				><track kind="captions" /></video
			>
		</div>
		<div class="camera-tools">
			<small class="muted">{camera.name}</small><button
				class="button secondary"
				onclick={() => {
					pausedByUser = !pausedByUser;
				}}>{pausedByUser ? 'Resume view' : 'Pause view'}</button
			>{#if canFullscreen}<button class="button secondary" onclick={fullscreen}>Fullscreen</button
				>{/if}<button class="button secondary" onclick={capture} disabled={capturing}
				>{capturing ? 'Capturing…' : 'Capture image'}</button
			>
		</div>
		{#if pausedByUser}<p class="muted" role="status">
				Camera playback paused.
			</p>{:else if !visible}<p class="muted" role="status">
				Playback pauses while this tab is hidden.
			</p>{:else if message}<div class="camera-message" role="status">
				<span>{message}</span>{#if status !== 'unsupported'}<button
						class="button secondary"
						onclick={play}>Play camera</button
					>{/if}
				{#if status !== 'unsupported'}<button
						class="button secondary"
						onclick={() => {
							failures = 0;
							retry++;
						}}>Retry now</button
					>{/if}
			</div>{/if}
		{#if captureError}<p class="error-text" role="alert">{captureError}</p>{/if}
	{:else}
		<div class="camera-empty">
			<Icon name="camera" size={52} />
			<h3>Camera not connected</h3>
			<p>Your camera will appear here through a secure app URL.</p>
		</div>
	{/if}
</section>
