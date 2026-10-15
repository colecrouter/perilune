<script lang="ts">
	import PrinterConsole from './PrinterConsole.svelte';
	import { getConsole, runConsole, findConsole, pinMacro } from '../../routes/console.remote.js';
	const feed = getConsole();
	const initial = await feed;
	async function find(id: string) {
		const result = findConsole(id);
		await result.refresh();
		return await result;
	}
</script>

<PrinterConsole
	snapshot={feed.current ?? initial}
	connected={feed.connected}
	onSubmit={runConsole}
	onFind={find}
	onPin={pinMacro}
/>
