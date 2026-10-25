<script lang="ts">
	import { preferencesContext } from '#lib/client/preferences.svelte.js';
	import { untrack } from 'svelte';
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
		unavailable = false,
		combined = false,
		standalone = false
	}: {
		samples: TemperatureSample[];
		sensors: TemperatureSensor[];
		connected?: boolean;
		unavailable?: boolean;
		combined?: boolean;
		standalone?: boolean;
	} = $props();
	type Point = {
		at: Date;
		current: number | null;
		target: number | null;
		readings: TemperatureSample['readings'];
	};
	const xScale = scaleTime();
	const yScale = scaleLinear();
	let chart = $state<ChartState<Point, typeof xScale, typeof yScale>>();
	const gradientId = $props.id();
	let selected = $state(untrack(() => (combined ? '*' : 'extruder')));
	const all = $derived(selected === '*');
	const palette = ['var(--accent)', '#a47740', '#8a78bd', '#548ba9', '#b36980', '#6b8750'];
	const color = (index: number) => palette[index % palette.length];
	const preferences = preferencesContext();
	let minutes = $state(15);
	$effect(() => {
		if (preferences) minutes = preferences.values.temperatureMinutes;
	});
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
				target: sensor ? (sample.readings[sensor.id]?.target ?? null) : null,
				readings: sample.readings
			}))
	);
	const start = $derived(
		Math.max(end - minutes * 60_000, points[0]?.at.getTime() ?? end - minutes * 60_000)
	);
	const values = $derived(
		points
			.flatMap((point) =>
				all
					? sensors.flatMap((item) => [
							point.readings[item.id]?.current ?? null,
							point.readings[item.id]?.target ?? null
						])
					: [point.current, point.target]
			)
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

<section class="thermal-history" class:standalone aria-label="Temperature history">
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
		{#if !combined}
			<label
				>Sensor<select
					value={all ? '*' : (sensor?.id ?? '')}
					onchange={(event) => {
						selected = event.currentTarget.value;
						inspectedAt = null;
						pinned = false;
					}}
					>{#if combined}<option value="*">All sensors</option>{/if}{#each sensors as item}<option
							value={item.id}>{item.label}</option
						>{/each}</select
				></label
			>{/if}
		<label
			>Window<select
				bind:value={minutes}
				onchange={(event) => {
					preferences?.update({
						temperatureMinutes: Number(event.currentTarget.value) as 5 | 15 | 60
					});
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
		<span class="actual-key">━ Actual</span>{#if all || sensor?.heater}<span class="target-key"
				>┄ Target</span
			>{/if}<span>°C</span>
	</p>
	{#if combined}<div class="sensor-readings" aria-label="Temperature sensors">
			<button
				class="sensor-all"
				aria-pressed={all}
				onclick={() => {
					selected = '*';
					inspectedAt = null;
					pinned = false;
				}}>All sensors</button
			>
			<div class="sensor-heading" aria-hidden="true">
				<span>Sensor</span><span>Actual</span><span>Target</span>
			</div>
			{#each sensors as item, i}<button
					class="sensor-row"
					aria-pressed={selected === item.id}
					aria-label={`Focus ${item.label} history. Actual ${connected ? reading(item.current) : 'Unavailable'}. ${item.heater ? `Target ${connected ? reading(item.target) : 'Unavailable'}.` : 'Read-only sensor.'}`}
					onclick={() => {
						selected = item.id;
						inspectedAt = null;
						pinned = false;
					}}
					><span><i style:background={color(i)}></i>{item.label}</span><strong
						>{connected ? reading(item.current) : 'Unavailable'}</strong
					><span
						>{item.heater ? (connected ? reading(item.target) : 'Unavailable') : 'Read-only'}</span
					></button
				>{/each}
		</div>{:else if all}<div class="sensor-key">
			{#each sensors as item, i}<span style:--sensor-color={color(i)}>{item.label}</span>{/each}
		</div>{/if}
	{#if sensor && points.length > 1 && values.length}
		<div
			class="temperature-chart"
			role="slider"
			tabindex="0"
			aria-valuemin={0}
			aria-valuemax={points.length - 1}
			aria-valuenow={index}
			aria-valuetext={inspected
				? `${time(inspected.at, true)}, ${all ? sensors.map((item) => `${item.label}: actual ${reading(inspected.readings[item.id]?.current)}${item.heater ? `, target ${reading(inspected.readings[item.id]?.target)}` : ''}`).join('; ') : `actual ${reading(inspected.current)}${sensor.heater ? `, target ${reading(inspected.target)}` : ''}`}`
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
			aria-label={`${all ? 'All sensor' : sensor.label} temperatures over the last ${minutes} minutes.${all ? '' : ` Actual ${reading(sensor.current)}${sensor.heater ? `, target ${reading(sensor.target)}` : ''}.`} Gaps indicate unavailable readings.`}
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
						{#if all}<defs
								>{#each sensors as item, i}<linearGradient
										id={`${gradientId}-${i}`}
										x1="0"
										y1="0"
										x2="0"
										y2="1"
										><stop offset="0%" stop-color={color(i)} stop-opacity=".2" /><stop
											offset="100%"
											stop-color={color(i)}
											stop-opacity=".01"
										/></linearGradient
									>{/each}</defs
							>{/if}
						<ChartClipPath>
							{#if all}
								{#each sensors as item, i}
									<Area
										y1={(point: Point) => point.readings[item.id]?.current ?? null}
										y0={() => 0}
										defined={(point: Point) => point.readings[item.id]?.current != null}
										fill={`url(#${gradientId}-${i})`}
										stroke="none"
									/>
									<Spline
										y={(point: Point) => point.readings[item.id]?.current ?? null}
										defined={(point: Point) => point.readings[item.id]?.current != null}
										stroke={color(i)}
										strokeWidth={2}
									/>
									{#if item.heater}<Spline
											y={(point: Point) => point.readings[item.id]?.target ?? null}
											curve={curveStepAfter}
											defined={(point: Point) => point.readings[item.id]?.target != null}
											stroke={color(i)}
											strokeWidth={1.25}
											stroke-dasharray="5 4"
										/>{/if}
								{/each}
							{:else}
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
							{/if}
							{#if inspectedAt !== null && inspected}<Rule
									x={inspected.at}
									stroke="var(--muted)"
									stroke-dasharray="3 3"
									class="inspection-marker"
								/>{#if !all && inspected.current !== null}<Circle
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
			>{#if all}{#each sensors as item, i}<span
						class="sensor-reading"
						style:--sensor-color={color(i)}
						>{item.label}
						{reading(inspected.readings[item.id]?.current)}{item.heater
							? ` / ${reading(inspected.readings[item.id]?.target)} target`
							: ''}</span
					>{/each}{:else}<span>Actual {reading(inspected.current)}</span>{#if sensor?.heater}<span
						>Target {reading(inspected.target)}</span
					>{/if}{/if}
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
	.sensor-readings {
		margin: 0.75rem 0 1rem;
	}
	.sensor-all {
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 0.8rem;
		margin-bottom: 0.5rem;
		cursor: pointer;
	}
	.sensor-heading,
	.sensor-row {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.5rem;
		width: 100%;
		text-align: left;
		align-items: center;
	}
	.sensor-heading {
		padding: 0.35rem 0.5rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.sensor-row {
		border: 0;
		border-top: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		padding: 0.65rem 0.5rem;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		min-height: 44px;
		font-variant-numeric: tabular-nums;
	}
	.sensor-row span,
	.sensor-row strong {
		overflow-wrap: anywhere;
	}
	.sensor-row i {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-right: 0.4rem;
	}
	.sensor-row[aria-pressed='true'],
	.sensor-all[aria-pressed='true'] {
		background: var(--highlight);
		color: var(--highlight-text);
	}
	.sensor-row:focus-visible,
	.sensor-all:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.sensor-key {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0.75rem 0;
		font-size: 0.75rem;
	}
	.sensor-key span::before {
		content: '';
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		margin-right: 0.4rem;
		background: var(--sensor-color);
	}
	.thermal-history {
		--chart-target: #6965a2;
		border-top: 1px solid var(--border);
		margin-top: 1.25rem;
		padding-top: 1rem;
		min-width: 0;
	}
	.standalone {
		border-top: 0;
		margin-top: 0;
		padding-top: 0;
	}
	.standalone h3 {
		font-size: 1.5rem;
		font-family: 'Newsreader Variable', Georgia, serif;
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
	.sensor-reading {
		color: var(--text);
	}
	.sensor-reading::before {
		content: '';
		display: inline-block;
		width: 0.55em;
		height: 0.55em;
		margin-right: 0.35em;
		border-radius: 50%;
		background: var(--sensor-color);
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
