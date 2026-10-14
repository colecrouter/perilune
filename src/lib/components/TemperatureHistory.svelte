<script lang="ts">
	import {
		Chart,
		Layer,
		Axis,
		Spline,
		Area,
		Rule,
		Circle,
		ChartClipPath,
		type ChartState
	} from 'layerchart';
	import { prefersReducedMotion } from 'svelte/motion';
	import { curveStepAfter } from 'd3-shape';
	import { scaleTime, scaleLinear } from 'd3-scale';
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
	type Point = { at: Date; current: number | null; target: number | null };
	const xScale = scaleTime();
	const yScale = scaleLinear();
	let chart = $state<ChartState<Point, typeof xScale, typeof yScale>>();
	const gradientId = $props.id();
	let selected = $state('extruder');
	let minutes = $state(15);
	let inspectedAt = $state<number | null>(null);
	let pinned = $state(false);
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
	const start = $derived(
		Math.max(end - minutes * 60_000, points[0]?.at.getTime() ?? end - minutes * 60_000)
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
	function inspect(event: PointerEvent & { currentTarget: EventTarget & HTMLDivElement }) {
		const bounds = event.currentTarget.getBoundingClientRect();
		const fraction = Math.max(
			0,
			Math.min(1, (event.clientX - bounds.left - 38) / Math.max(1, bounds.width - 50))
		);
		const at =
			chart?.xScale.invert?.(event.clientX - bounds.left - 38)?.getTime() ??
			start + fraction * (end - start);
		const nearest = points.reduce<(typeof points)[number] | undefined>(
			(best, point) =>
				!best || Math.abs(point.at.getTime() - at) < Math.abs(best.at.getTime() - at)
					? point
					: best,
			undefined
		);
		inspectedAt = nearest?.at.getTime() ?? null;
	}
	function inspectKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			inspectedAt = null;
			pinned = false;
			return;
		}
		const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key)
			? -1
			: ['ArrowRight', 'ArrowUp'].includes(event.key)
				? 1
				: 0;
		if (!direction && !['Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? points.length - 1
					: Math.max(0, Math.min(points.length - 1, index + direction));
		inspectedAt = points[next]?.at.getTime() ?? null;
		pinned = true;
	}

	const time = (at: Date, seconds = false) =>
		at.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: seconds ? '2-digit' : undefined
		});
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
					pinned = false;
				}}
				>{#each sensors as item}<option value={item.id}>{item.label}</option>{/each}</select
			></label
		>
		<label
			>Window<select
				bind:value={minutes}
				onchange={() => {
					inspectedAt = null;
					pinned = false;
				}}
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
			role="slider"
			tabindex="0"
			aria-valuemin={0}
			aria-valuemax={points.length - 1}
			aria-valuenow={index}
			aria-valuetext={inspected
				? `${time(inspected.at, true)}, actual ${reading(inspected.current)}${sensor.heater ? `, target ${reading(inspected.target)}` : ''}`
				: 'Unavailable'}
			aria-describedby="history-interaction-help"
			onkeydown={inspectKey}
			onpointermove={(event) => {
				if (event.pointerType === 'mouse') {
					pinned = false;
					inspect(event);
				}
			}}
			onpointerdown={(event) => {
				inspect(event);
				pinned = event.pointerType !== 'mouse';
			}}
			onpointerleave={() => {
				if (!pinned) inspectedAt = null;
			}}
			aria-label={`${sensor.label} temperatures over the last ${minutes} minutes. Actual ${reading(sensor.current)}${sensor.heater ? `, target ${reading(sensor.target)}` : ''}. Gaps indicate unavailable readings.`}
		>
			<div aria-hidden="true">
				<Chart
					data={points}
					x="at"
					y="current"
					bind:context={chart}
					{xScale}
					{yScale}
					motion={{
						type: 'tween',
						duration: () => (prefersReducedMotion.current || inspectedAt !== null ? 0 : 350)
					}}
					xDomain={[new Date(start), new Date(end)]}
					yDomain={domain}
					height={230}
					padding={{ left: 38, right: 12, top: 12, bottom: 28 }}
				>
					<Layer type="svg">
						<Axis placement="left" ticks={4} grid format={(value) => `${value}`} />
						<Axis
							placement="bottom"
							ticks={3}
							format={(value) => time(new Date(value), end - start < 120_000)}
						/>
						<defs
							><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"
								><stop offset="0%" stop-color="var(--accent)" stop-opacity=".24" /><stop
									offset="100%"
									stop-color="var(--accent)"
									stop-opacity=".015"
								/></linearGradient
							></defs
						>
						<ChartClipPath>
							<Area
								y1="current"
								y0={() => 0}
								defined={(point: Point) => point.current !== null}
								fill={`url(#${gradientId})`}
								stroke="none"
							/>

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
							{#if inspectedAt !== null && inspected}<Rule
									x={inspected.at}
									stroke="var(--muted)"
									stroke-dasharray="3 3"
									class="inspection-marker"
								/>{#if inspected.current !== null}<Circle
										data={[inspected]}
										cx="at"
										cy="current"
										r={5}
										fill="var(--accent)"
										stroke="var(--surface)"
										strokeWidth={2}
									/>{/if}{/if}
						</ChartClipPath>
					</Layer>
				</Chart>
			</div>
		</div>
	{:else}<div class="history-empty">
			<p>{sensor ? 'Collecting temperature history…' : 'Waiting for temperature sensors…'}</p>
			<small>History starts when the backend starts. Missing readings appear as gaps.</small>
		</div>{/if}
	{#if inspected}<div class="sample-reading">
			<strong>{inspectedAt === null ? 'Latest' : 'Selected'} · {time(inspected.at, true)}</strong
			><span>Actual {reading(inspected.current)}</span>{#if sensor?.heater}<span
					>Target {reading(inspected.target)}</span
				>{/if}
		</div>{/if}
	{#if points.length > 1}<p id="history-interaction-help" class="history-help">
			Hover or tap the chart to inspect a reading. Use arrow keys when focused.
		</p>
		{#if pinned}<button
				class="button secondary latest"
				onclick={() => {
					inspectedAt = null;
					pinned = false;
				}}>Return to latest</button
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
		position: relative;
		cursor: crosshair;
		touch-action: pan-y;
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
	.temperature-chart:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
		border-radius: 8px;
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
