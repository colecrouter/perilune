<script lang="ts">
	let {
		name,
		size = 20
	}: {
		name:
			| 'overview'
			| 'jobs'
			| 'calibration'
			| 'configuration'
			| 'camera'
			| 'capture'
			| 'fullscreen'
			| 'retry'
			| 'monitor'
			| 'pause'
			| 'stop'
			| 'play'
			| 'nozzle'
			| 'bed';
		size?: number;
	} = $props();
	const paths = {
		overview: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
		jobs: 'M6 3h8l5 5v13H6z M14 3v6h5',
		calibration: 'M14 5a5 5 0 0 0-6 6L3 16a3 3 0 0 0 5 5l5-5a5 5 0 0 0 6-6l-4 3-3-3 3-4z',
		configuration:
			'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
		camera: 'M3 3l18 18 M5 7H3v13h18V7h-6l-2-3H9L7 7 M9 10a4 4 0 0 0 5 5',
		capture: 'M3 7h5l2-3h4l2 3h5v13H3z M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
		fullscreen: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
		retry: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
		monitor: 'M3 3h18v14H3z M8 21h8 M12 17v4',
		pause: 'M8 5v14 M16 5v14',
		stop: 'M5 5h14v14H5z',
		play: 'm7 4 14 8-14 8z',
		nozzle: 'M7 3h10v12l-5 6-5-6z M9 17h6',
		bed: 'M3 19h18 M5 15c-3-4 3-5 0-9 M12 15c-3-4 3-5 0-9 M19 15c-3-4 3-5 0-9'
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"><path d={paths[name]} /></svg
>
