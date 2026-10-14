<script lang="ts">
	import { Chart, Layer, Axis, Spline } from 'layerchart';
	import { curveStepAfter } from 'd3-shape';
	import { scaleTime } from 'd3-scale';
	import type { TemperatureSample, TemperatureSensor } from '#lib/domain/temperature.js';
	let {
		samples,
		sensors,
		connected = true,
		unavailable = false
	}: {
		samples: TemperatureSample[];
		sensors: TemperatureSensor[];
		connected?: boolean;
		unavailable?: boolean;
	} = $props();
	let selected = $state('extruder');
	let minutes = $state(15);
	let inspectedAt = $state<number | null>(null);
	const sensor = $derived(sensors.find((item) => item.id === selected) ?? sensors[0]);
	const end = $derived(samples.at(-1)?.at ?? Date.now());
	const points = $derived(
		samples
			.filter((sample) => sample.at >= end - minutes * 60_000)
			.map((sample) => ({
				at: new Date(sample.at),
				current: sensor ? (sample.readings[sensor.id]?.current ?? null) : null,
				target: sensor ? (sample.readings[sensor.id]?.target ?? null) : null
			}))
	);
	const values = $derived(
		points
			.flatMap((point) => [point.current, point.target])
			.filter((value): value is number => value !== null)
	);
	const domain = $derived([
		Math.min(0, Math.floor(Math.min(0, ...values) / 10) * 10),
		Math.max(50, Math.ceil((Math.max(0, ...values) + 10) / 10) * 10)
	]);
	const inspected = $derived(
		inspectedAt === null
			? points.at(-1)
			: (points.find((point) => point.at.getTime() >= inspectedAt!) ?? points.at(-1))
	);
	const index = $derived(inspected ? points.indexOf(inspected) : 0);
	const time = (at: Date) => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const reading = (value: number | null | undefined) =>
		value === null || value === undefined ? 'Unavailable' : `${value.toFixed(1)}°C`;
</script>

<section class="thermal-history" aria-label="Temperature history">
	<div class="history-heading">
		<h3>Temperature history</h3>
		<span class="history-status"
			>{unavailable
				? 'History unavailable · retrying'
				: connected
					? 'Live · 5s samples'
					: 'Disconnected · history retained'}</span
		>
	</div>
	<div class="history-options">
		<label
			>Sensor<select
				value={sensor?.id ?? ''}
				onchange={(event) => {
					selected = event.currentTarget.value;
					inspectedAt = null;
				}}
				>{#each sensors as item}<option value={item.id}>{item.label}</option>{/each}</select
			></label
		>
		<label
			>Window<select bind:value={minutes}
				><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option
					value={60}>1 hour</option
				></select
			></label
		>
	</div>
	<p class="chart-key">
		<span class="actual-key">━ Actual</span>{#if sensor?.heater}<span class="target-key"
				>┄ Target</span
			>{/if}<span>°C</span>
	</p>
	{#if sensor && points.length > 1 && values.length}
		<div
			class="temperature-chart"
			role="img"
			aria-label={`${sensor.label} temperatures over the last ${minutes} minutes. Actual ${reading(sensor.current)}${sensor.heater ? `, target ${reading(sensor.target)}` : ''}. Gaps indicate unavailable readings.`}
		>
			<div aria-hidden="true">
				<Chart
					data={points}
					x="at"
					y="current"
					xScale={scaleTime()}
					xDomain={[new Date(end - minutes * 60_000), new Date(end)]}
					yDomain={domain}
					height={230}
					padding={{ left: 38, right: 12, top: 12, bottom: 28 }}
				>
					<Layer type="svg">
						<Axis placement="left" ticks={4} grid format={(value) => `${value}`} />
						<Axis placement="bottom" ticks={3} format={(value) => time(new Date(value))} />
						<Spline
							y="current"
							defined={(point: { current: number | null }) => point.current !== null}
							stroke="var(--accent)"
							strokeWidth={2}
						/>
						{#if sensor.heater}<Spline
								y="target"
								curve={curveStepAfter}
								defined={(point: { target: number | null }) => point.target !== null}
								stroke="var(--chart-target)"
								strokeWidth={1.5}
								stroke-dasharray="5 4"
							/>{/if}
					</Layer>
				</Chart>
			</div>
		</div>
	{:else}<div class="history-empty">
			<p>{sensor ? 'Collecting temperature history…' : 'Waiting for temperature sensors…'}</p>
			<small>History starts when the backend starts. Missing readings appear as gaps.</small>
		</div>{/if}
	{#if inspected}<div class="sample-reading">
			<strong>{time(inspected.at)}</strong><span>Actual {reading(inspected.current)}</span
			>{#if sensor?.heater}<span>Target {reading(inspected.target)}</span>{/if}
		</div>{/if}
	{#if points.length > 1}<label class="inspect-history"
			>Inspect history<input
				type="range"
				min="0"
				max={points.length - 1}
				step="1"
				value={index}
				oninput={(event) =>
					(inspectedAt = points[Number(event.currentTarget.value)]?.at.getTime() ?? null)}
			/></label
		>{#if inspectedAt !== null}<button
				class="button secondary latest"
				onclick={() => (inspectedAt = null)}>Return to latest</button
			>{/if}{/if}
	<p class="history-help">
		Up to one hour retained by the backend. Disconnects leave gaps; a backend restart starts a new
		history.
	</p>
</section>

<style>
	.thermal-history {
		--chart-target: #6965a2;
		border-top: 1px solid var(--border);
		margin-top: 1.25rem;
		padding-top: 1rem;
		min-width: 0;
	}
	.history-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	h3 {
		font-size: 1.05rem;
		margin: 0;
	}
	.history-status,
	.history-help {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.history-options {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.75rem;
		margin: 1rem 0;
	}
	label {
		font-size: 0.8rem;
		display: grid;
		gap: 0.4rem;
	}
	select {
		min-width: 0;
		width: 100%;
		min-height: 44px;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--canvas);
		color: var(--text);
		padding: 0.5rem;
		font: inherit;
	}
	.chart-key,
	.sample-reading {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.8rem;
	}
	.actual-key {
		color: var(--accent);
	}
	.target-key {
		color: var(--chart-target);
	}
	.temperature-chart {
		height: 230px;
		min-width: 0;
		color: var(--muted);
	}
	.temperature-chart :global(text) {
		fill: var(--muted);
		font-size: 10px;
	}
	.temperature-chart :global(.lc-axis-grid) {
		stroke: var(--border);
	}
	.history-empty {
		min-height: 160px;
		display: grid;
		align-content: center;
		text-align: center;
		gap: 0.6rem;
		background: var(--canvas);
		border-radius: 10px;
		color: var(--muted);
		padding: 1rem;
	}
	.history-empty small {
		font-size: 0.75rem;
	}
	.inspect-history {
		margin-top: 0.75rem;
	}
	.inspect-history input {
		width: 100%;
		min-height: 44px;
		accent-color: var(--accent);
	}
	.latest {
		margin-top: 0.5rem;
		font-size: 0.75rem;
	}
	.history-help {
		line-height: 1.6;
		margin-bottom: 0;
	}
	@media (prefers-color-scheme: dark) {
		.thermal-history {
			--chart-target: #b4afe8;
		}
	}
</style>
