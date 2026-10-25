<script lang="ts">
	import { liveQuery } from '#lib/client/live-query.js';
	import { onMount } from 'svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import { temperatureSensors } from '#lib/domain/temperature.js';
	import AppShell from '#lib/components/AppShell.svelte';
	import PidWorkshop from '#lib/components/PidWorkshop.svelte';
	import TemperatureHistory from '#lib/components/TemperatureHistory.svelte';
	import { getPrinter, getTemperatureHistory } from '../../printer.remote.js';
	let { data } = $props();
	const printer = liveQuery(getPrinter);
	const history = getTemperatureHistory();
	const updates = liveConnection(() => printer.connected);
	const snapshot = $derived(printer.current ?? data.initial!.printer);
	let historyUnavailable = $state(false);
	onMount(() => {
		void Promise.resolve(printer).catch(() => {});
		void Promise.resolve(history).catch(() => {
			historyUnavailable = true;
		});
		let refreshing = false;
		const timer = setInterval(async () => {
			if (refreshing || !printer.connected) return;
			refreshing = true;
			try {
				await history.refresh();
				historyUnavailable = false;
			} catch {
				historyUnavailable = true;
			} finally {
				refreshing = false;
			}
		}, 5000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>PID heater calibration · Perilune</title></svelte:head>
<AppShell {snapshot} active="Calibration"
	><div class="pid-page page-frame serif">
		<header>
			<h1>PID heater calibration</h1>
			<p>Give your heater a steadier orbit.</p>
		</header>
		<PidWorkshop {snapshot} connected={updates.available} role={data.user?.role ?? 'viewer'} />
		<section class="panel chart">
			<h2>Temperature during calibration</h2>
			<TemperatureHistory
				samples={history.current ?? []}
				sensors={temperatureSensors(snapshot)}
				connected={updates.available}
				unavailable={historyUnavailable}
				combined
			/>
		</section>
	</div></AppShell
>

<style>
	.pid-page {
		--page-content-max: 76rem;
	}
	header {
		margin-bottom: 1.75rem;
	}
	header > p:last-child {
		color: var(--muted);
	}
	.chart {
		padding: clamp(1rem, 3vw, 1.75rem);
	}
</style>
