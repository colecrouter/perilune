<script lang="ts">
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import PrinterConsole from './PrinterConsole.svelte';
	import { getConsole, runConsole, findConsole, pinMacro } from '../../routes/console.remote.js';
	const feed = getConsole();
	const initial = await feed;
	const updates = liveConnection(() => feed.connected);
	async function find(id: string) {
		const result = findConsole(id);
		await result.refresh();
		return await result;
	}
</script>

<PrinterConsole
	snapshot={feed.current ?? initial}
	connected={updates.available}
	onSubmit={runConsole}
	onFind={find}
	onPin={pinMacro}
/>
