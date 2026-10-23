<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Chart,
		Layer,
		Frame,
		Grid,
		Axis,
		Line,
		Circle,
		isometric,
		type ChartState
	} from 'layerchart';
	import { meshSegments } from '#lib/domain/mesh-visualization.js';
	import { meshPoint, type BedMesh } from '#lib/domain/bed-mesh.js';
	let {
		mesh,
		scale,
		color,
		selectedRow = 0,
		selectedColumn = 0
	}: {
		mesh: BedMesh;
		scale: number;
		color: (value: number) => string;
		selectedRow?: number;
		selectedColumn?: number;
	} = $props();
	const segments = $derived(meshSegments(mesh));
	let contrastStroke = $state(false);
	onMount(() => {
		contrastStroke = CSS.supports('color', 'color-mix(in srgb, white, black)');
	});
	const lineColor = (height: number) =>
		contrastStroke ? `color-mix(in srgb, ${color(height)}, var(--text) 45%)` : color(height);
	let context = $state<ChartState>();
	let amplification = $state(100);
	// Dense grids retain every edge but batch strokes into 33 color bands, keeping
	// SVG/reactivity costs close to the original row/column wireframe.
	const densePaths = $derived.by(() => {
		if (!context || segments.length <= 512) return [];
		const lift = context.isometricLift;
		if (!lift) return [];
		const project = (x: number, y: number, z: number) => {
			const height = Number(context!.zScale(z));
			return `${Number(context!.xScale(x)) + lift.x * height},${Number(context!.yScale(y)) + lift.y * height}`;
		};
		const bands = new Map<number, { d: string; count: number }>();
		for (const edge of segments) {
			const band = Math.max(-16, Math.min(16, Math.round((edge.height / scale) * 16)));
			const group = bands.get(band) ?? { d: '', count: 0 };
			group.d += `M${project(edge.x1, edge.y1, edge.z1)}L${project(edge.x2, edge.y2, edge.z2)}`;
			group.count++;
			bands.set(band, group);
		}
		return [...bands].map(([band, group]) => ({ ...group, height: (band * scale) / 16 }));
	});
	const points = $derived(
		mesh.points.flatMap((values, row) =>
			values.map((_, column) => ({ ...meshPoint(mesh, row, column), row, column }))
		)
	);
	const angle = $derived(context?.transform.rotation ?? { x: -45, y: 55 });
	const limitRotation = (x: number, y: number, deltaX: number, deltaY: number) => ({
		x: ((((x + deltaX + 180) % 360) + 360) % 360) - 180,
		y: Math.max(15, Math.min(80, y + deltaY))
	});
</script>

<div class="surface-view">
	<div
		class="surface-chart"
		role="img"
		aria-label="Rotatable bed mesh wireframe; X and Y coordinates and Z heights in millimetres"
	>
		<Chart
			data={points}
			x="x"
			y="y"
			z="z"
			xDomain={[mesh.min[0], mesh.max[0]]}
			yDomain={[mesh.min[1], mesh.max[1]]}
			zDomain={[-scale, scale]}
			zRange={({ width }) => {
				const height = ((scale * width) / (mesh.max[0] - mesh.min[0])) * amplification;
				return [0, 2 * height];
			}}
			view={isometric({
				rotate: -45,
				tilt: 55,
				aspect: (mesh.max[0] - mesh.min[0]) / (mesh.max[1] - mesh.min[1])
			})}
			transform={{
				mode: 'canvas',
				drag: 'rotate',
				scrollMode: 'none',
				pinch: false,
				processRotate: limitRotation
			}}
			padding={{ top: 25, right: 32, bottom: 42, left: 42 }}
			height={330}
			bind:context
		>
			<Layer>
				<Frame fill="var(--surface)" stroke="var(--border)" fillOpacity={0.3} />
				<Grid x y z stroke="var(--border)" />
				<Axis
					placement="bottom"
					label="X (mm)"
					ticks={3}
					tickLabelProps={{ viewport: true, fill: 'var(--muted)' }}
				/>
				<Axis
					placement="left"
					label="Y (mm)"
					ticks={[mesh.min[1], (mesh.min[1] + mesh.max[1]) / 2]}
					tickLabelProps={{ viewport: true, fill: 'var(--muted)' }}
				/>
				<Axis
					placement="back"
					label="Z (mm)"
					format={(value) => Number(value).toFixed(3)}
					ticks={[-scale, scale]}
					tickLabelProps={{ viewport: true, fill: 'var(--muted)' }}
				/>
				{#if segments.length > 512}
					{#each densePaths as band}<path
							class="mesh-band"
							d={band.d}
							data-segment-count={band.count}
							fill="none"
							stroke={lineColor(band.height)}
							stroke-width="2"
						/>{/each}
				{:else}
					<Line
						class="mesh-segment"
						data={segments}
						x1="x1"
						y1="y1"
						z1="z1"
						x2="x2"
						y2="y2"
						z2="z2"
						stroke={(segment: (typeof segments)[number]) => lineColor(segment.height)}
						strokeWidth={2}
						motion="none"
					/>
				{/if}
				<Circle
					class={(point: (typeof points)[number]) =>
						point.row === selectedRow && point.column === selectedColumn
							? 'mesh-sample selected-sample'
							: 'mesh-sample'}
					cx="x"
					cy="y"
					r={2.5}
					fill={(point: (typeof points)[number]) => color(point.z)}
					stroke="var(--text)"
					strokeWidth={(point: (typeof points)[number]) =>
						point.row === selectedRow && point.column === selectedColumn ? 3 : 0.5}
					viewport
				/>
			</Layer>
		</Chart>
	</div>
	<div class="surface-controls">
		<label
			>Rotation<input
				type="range"
				min="-180"
				max="180"
				step="1"
				value={angle.x}
				oninput={(event) =>
					context?.transform.setRotation(
						{ x: event.currentTarget.valueAsNumber, y: angle.y },
						{ duration: 0 }
					)}
			/></label
		>
		<label
			>Tilt<input
				type="range"
				min="15"
				max="80"
				step="1"
				value={angle.y}
				oninput={(event) =>
					context?.transform.setRotation(
						{ x: angle.x, y: event.currentTarget.valueAsNumber },
						{ duration: 0 }
					)}
			/></label
		>
		<label
			>Height scale<select bind:value={amplification}
				><option value={1}>×1 · actual proportions</option><option value={25}>×25</option><option
					value={100}>×100</option
				><option value={300}>×300</option></select
			></label
		>
		<button
			class="button secondary"
			onclick={() => {
				context?.transform.reset({ instant: true });
				amplification = 100;
			}}>Reset view</button
		>
	</div>
	<details class="surface-help">
		<summary>View controls &amp; height scale</summary>
		<p>
			Drag to rotate and tilt, or use the Rotation and Tilt sliders with your keyboard. Height scale
			exaggerates the shape; numeric values stay in millimetres. Reset view restores the initial
			angle and ×100 scale.
		</p>
		<p>
			Lines connect adjacent reported samples and use their average height for color. They are not
			Klipper’s compensation surface. The outlined larger point is the selected sample; use the
			top-down map or row and column fields to choose another.
		</p>
	</details>
</div>

<style>
	.surface-chart {
		border: 1px solid var(--border);
		border-radius: 0.8rem;
		overflow: hidden;
		background: var(--surface);
	}
	.surface-controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
		align-items: end;
	}
	label {
		display: grid;
		gap: 0.5rem;
		font-size: 0.8rem;
		font-weight: 600;
	}
	select {
		min-width: 0;
		max-width: 100%;
		padding: 0.6rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
	}
	input {
		width: 100%;
		accent-color: var(--accent);
	}
	.surface-help {
		font-size: 0.85rem;
		color: var(--muted);
		line-height: 1.5;
		margin-top: 0.75rem;
	}
	.surface-help summary {
		cursor: pointer;
		padding-block: 0.5rem;
		font-weight: 550;
	}
	.surface-controls {
		margin-top: 0.8rem;
	}
	:global(.surface-chart .lc-axis-label) {
		fill: var(--text);
		font-size: 12px;
	}
</style>
