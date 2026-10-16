<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { moonPhasePath } from '#lib/domain/moon.js';
	import { getPrinter } from '../../routes/printer.remote.js';
	import fallback from '#lib/assets/favicon.svg';

	const dashboard = getPrinter();
	onMount(() => {
		void Promise.resolve(dashboard).catch(() => {});
	});
	const printer = $derived(dashboard.current);
	const progress = $derived.by(() => {
		if (!printer) return null;
		if (printer.job.state === 'complete') return 1;
		if (printer.job.state !== 'printing' && printer.job.state !== 'paused') return null;
		return printer.job.progress === null ? null : Math.round(printer.job.progress) / 100;
	});
	const unavailable = $derived(
		!dashboard.connected || printer?.connection !== 'connected' || printer?.klippy !== 'ready'
	);
	const paused = $derived(printer?.job.state === 'paused');
	let href = $state(fallback);

	$effect(() => {
		const phase = progress;
		const stale = unavailable;
		const hold = paused;
		if (phase === null) {
			href = fallback;
			return;
		}
		let disposed = false;
		const image = new Image();
		image.onload = () => {
			if (disposed) return;
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 64;
			const context = canvas.getContext('2d');
			if (!context) return;
			context.scale(0.64, 0.64);
			context.fillStyle = '#29364d';
			context.strokeStyle = '#8d97ae';
			context.lineWidth = 1.5;
			context.beginPath();
			context.arc(50, 50, 48, 0, Math.PI * 2);
			context.fill();
			context.stroke();
			context.save();
			context.clip(new Path2D(moonPhasePath(phase)));
			context.drawImage(image, 0, 0, 100, 100);
			context.restore();
			if (stale || hold) {
				context.fillStyle = '#182339';
				context.beginPath();
				context.arc(80, 80, 19, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = stale ? '#e8b575' : '#c9c3ec';
				if (stale) {
					context.beginPath();
					context.arc(80, 80, 9, 0, Math.PI * 2);
					context.fill();
				} else {
					context.fillRect(71, 70, 6, 20);
					context.fillRect(83, 70, 6, 20);
				}
			}
			href = canvas.toDataURL('image/png');
		};
		image.src = asset('brand/moon-texture.png');
		return () => {
			disposed = true;
			image.onload = null;
		};
	});
</script>

<svelte:head><link rel="icon" {href} /></svelte:head>
