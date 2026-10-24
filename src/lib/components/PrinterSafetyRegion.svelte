<script lang="ts">
	import { page } from '$app/state';
	import ActionNotices from './ActionNotices.svelte';
	import { untrack } from 'svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import PrintNotice from './PrintNotice.svelte';
	import {
		dismissFailureNotices,
		getPrinter,
		getDashboard,
		submitAction,
		reconcilePrintAction
	} from '../../routes/printer.remote.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import PrinterLockNotices from './PrinterLockNotices.svelte';
	import PrinterSafetyControls from './PrinterSafetyControls.svelte';
	let acknowledged = $state<PrinterSnapshot | undefined>();
	let { snapshot, initial }: { snapshot?: PrinterSnapshot; initial?: PrinterSnapshot } = $props();
	const overview = untrack(() => page.url.pathname === '/');
	const dashboard = overview ? getDashboard() : null;
	const source = overview ? null : getPrinter();
	const updates = liveConnection(() => dashboard?.connected ?? source?.connected ?? false);
	const received = $derived(dashboard?.current?.printer ?? source?.current);
	$effect(() => {
		if (source) void Promise.resolve(source).catch(() => {});
		if (dashboard) void Promise.resolve(dashboard).catch(() => {});
	});
	const receivedOrAcknowledged = $derived(
		acknowledged && acknowledged.revision >= (received?.revision ?? -1) ? acknowledged : received
	);
	const current = $derived(
		receivedOrAcknowledged && receivedOrAcknowledged.revision >= (snapshot?.revision ?? -1)
			? receivedOrAcknowledged
			: (snapshot ?? received ?? initial)
	);
	const activePrint = $derived(current && ['printing', 'paused'].includes(current.job.state));
</script>

<PrinterSafetyControls snapshot={current} /><PrinterLockNotices
	snapshot={current}
	role={page.data.user?.role}
	suppressFilamentChange={Boolean(activePrint)}
/>{#if current}<PrintNotice
		snapshot={current}
		reviewingStop={page.url.pathname === '/actions' &&
			page.url.searchParams.get('intent') === 'cancel'}
		available={updates.available}
		role={page.data.user?.role}
		userId={page.data.user?.id ?? ''}
		submitStop={submitAction}
		reconcile={(id, accountId) => reconcilePrintAction({ id, accountId })}
	/>{/if}<ActionNotices
	snapshot={current}
	dismissNotices={async (ids) => {
		acknowledged = await dismissFailureNotices(ids);
	}}
/>
