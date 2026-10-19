<script lang="ts">
	import { page } from '$app/state';
	import ActionNotices from './ActionNotices.svelte';
	import { untrack } from 'svelte';
	import { getPrinter } from '../../routes/printer.remote.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import PrinterLockNotices from './PrinterLockNotices.svelte';
	import PrinterSafetyControls from './PrinterSafetyControls.svelte';
	let { snapshot, initial }: { snapshot?: PrinterSnapshot; initial?: PrinterSnapshot } = $props();
	const source = untrack(() => (snapshot ? null : getPrinter()));
	$effect(() => {
		if (source) void Promise.resolve(source).catch(() => {});
	});
	const current = $derived(snapshot ?? source?.current ?? initial);
</script>

<PrinterSafetyControls snapshot={current} /><PrinterLockNotices
	snapshot={current}
	role={page.data.user?.role}
/><ActionNotices snapshot={current} userId={page.data.user?.id} />
