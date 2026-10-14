<script lang="ts">
	import {
		Chart,
		Layer,
		Frame,
		Grid,
		Axis,
		Spline,
		Circle,
		isometric,
		type ChartState
	} from 'layerchart';
	import { curveLinear } from 'd3-shape';
	import { meshPoint, type BedMesh } from '#lib/domain/bed-mesh.js';
	let { mesh, scale, color }: { mesh: BedMesh; scale: number; color: (value: number) => string } =
		$props();
	let context = $state<ChartState>();
	let amplification = $state(100);
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
				<Spline
					g="row"
					curve={curveLinear}
					stroke="var(--accent)"
					strokeWidth={1.5}
					motion="none"
				/>
				<Spline
					data={[...points].sort((a, b) => a.row - b.row)}
					g="column"
					curve={curveLinear}
					stroke="var(--accent)"
					strokeWidth={1.5}
					motion="none"
				/>
				<Circle
					cx="x"
					cy="y"
					r={2.5}
					fill={(point: (typeof points)[number]) => color(point.z)}
					stroke="var(--text)"
					strokeWidth={0.5}
					viewport
				/>
			</Layer>
		</Chart>
	</div>
	<p class="surface-note">
		Lines connect reported samples; they are not Klipper’s compensation surface.
	</p>
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
	<p class="fine-hint">
		Drag to rotate and tilt, or use the sliders. Scroll outside the chart to move down the page.
		Select exact samples with the row and column fields or the top-down map.
	</p>
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
	.surface-note {
		font-size: 0.85rem;
		color: var(--muted);
		line-height: 1.5;
	}
	:global(.surface-chart .lc-axis-label) {
		fill: var(--text);
		font-size: 12px;
	}
</style>
