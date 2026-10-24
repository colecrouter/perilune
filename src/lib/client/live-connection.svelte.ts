import { onMount } from 'svelte';
/** Initial server state is usable before the browser stream has been established. */
export function liveConnection(connected: () => boolean) {
	let established = $state(false),
		timedOut = $state(false);
	$effect(() => {
		if (connected()) {
			established = true;
			timedOut = false;
		}
	});
	onMount(() => {
		const timer = setTimeout(() => {
			if (!connected()) timedOut = true;
		}, 10_000);
		return () => clearTimeout(timer);
	});
	return {
		get available() {
			return connected() || (!established && !timedOut);
		}
	};
}
