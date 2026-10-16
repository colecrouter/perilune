<script lang="ts">
	import { untrack } from 'svelte';
	import { getPrinter } from '../../routes/printer.remote.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import PrinterSafetyControls from './PrinterSafetyControls.svelte';
	import LiveActionRecovery from './LiveActionRecovery.svelte';
	let { snapshot, initial }: { snapshot?: PrinterSnapshot; initial?: PrinterSnapshot } = $props();
	const source = untrack(() => (snapshot ? null : getPrinter()));
	$effect(() => {
		if (source) void Promise.resolve(source).catch(() => {});
	});
	const current = $derived(snapshot ?? source?.current ?? initial);
</script>

<PrinterSafetyControls snapshot={current} /><LiveActionRecovery snapshot={current} />
