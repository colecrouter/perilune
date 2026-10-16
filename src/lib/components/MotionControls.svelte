<script lang="ts">
	import { untrack } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import ActionForm from './ActionForm.svelte';
	import type { PrinterSnapshot, PrinterCommand } from '#lib/domain/printer.js';
	import {
		motionReason,
		allAxesHomed,
		jogDestination,
		type Position,
		type Axis
	} from '#lib/domain/motion.js';
	let {
		snapshot,
		canOperate = true,
		progressive = false,
		transportConnected = true,
		onSubmit
	}: {
		snapshot: PrinterSnapshot;
		canOperate?: boolean;
		progressive?: boolean;
		transportConnected?: boolean;
		onSubmit: (command: PrinterCommand) => Promise<unknown>;
	} = $props();
	let x = $state<number | undefined>(untrack(() => snapshot.motion.position.x ?? undefined));
	let y = $state<number | undefined>(untrack(() => snapshot.motion.position.y ?? undefined));
	let z = $state<number | undefined>(untrack(() => snapshot.motion.position.z ?? undefined));
	let base = $state<Position | null>(null);
	let step = $state(1);
	let pending = $state(false);
	let error = $state('');
	let dragging = $state(false);
	let clearance = $state(false);
	let releaseOpen = $state(false);
	let keepEngaged = $state<HTMLButtonElement | null>(null);
	const operatorReason = $derived(
		!transportConnected
			? 'Reconnecting to Perilune. Wait for live updates.'
			: !canOperate
				? 'An operator account is required.'
				: null
	);
	const alreadyHomed = $derived(transportConnected && allAxesHomed(snapshot));
	const homeAllReason = $derived(operatorReason ?? motionReason(snapshot, ['x', 'y', 'z'], true));
	const releaseReason = $derived(operatorReason ?? motionReason(snapshot, [], true));
	const limits = $derived(snapshot.motion.limits);
	const reason = $derived(
		!transportConnected
			? 'Reconnecting to Perilune. Wait for live updates.'
			: !canOperate
				? 'An operator account is required to move the printer.'
				: motionReason(snapshot, ['x', 'y', 'z'])
	);
	const stale = $derived(
		base !== null &&
			(['x', 'y', 'z'] as const).some((axis) => snapshot.motion.position[axis] !== base![axis])
	);
	const lowering = $derived(z !== undefined && base !== null && z < 5 && z < base.z);
	const mapHeight = $derived(
		limits.x && limits.y
			? (260 * (limits.y.max - limits.y.min)) / (limits.x.max - limits.x.min)
			: 260
	);
	const invalidXY = $derived(
		[
			['X', x, limits.x],
			['Y', y, limits.y]
		]
			.map(([name, value, range]) => {
				const bounds = range as { min: number; max: number } | null;
				return typeof value !== 'number' || !Number.isFinite(value)
					? `Enter a ${name} coordinate.`
					: bounds && (value < bounds.min || value > bounds.max)
						? `${name} must be ${bounds.min}–${bounds.max} mm.`
						: null;
			})
			.find(Boolean) ?? null
	);
	$effect(() => {
		if (!base) {
			x = snapshot.motion.position.x ?? undefined;
			y = snapshot.motion.position.y ?? undefined;
			z = snapshot.motion.position.z ?? undefined;
		}
	});
	function position(): Position | null {
		const p = snapshot.motion.position;
		return p.x !== null && p.y !== null && p.z !== null ? { x: p.x, y: p.y, z: p.z } : null;
	}
	function begin() {
		if (!base) base = position();
		clearance = false;
		error = '';
	}
	function reset() {
		base = null;
		clearance = false;
		error = '';
	}
	function project(axis: 'x' | 'y', value: number) {
		const bounds = limits[axis]!;
		const size = axis === 'x' ? 260 : mapHeight;
		return 20 + (size * (value - bounds.min)) / (bounds.max - bounds.min);
	}
	function select(event: PointerEvent & { currentTarget: EventTarget & SVGSVGElement }) {
		if (!limits.x || !limits.y) return;
		const matrix = event.currentTarget.getScreenCTM();
		if (!matrix) return;
		const point = event.currentTarget.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		const local = point.matrixTransform(matrix.inverse());
		begin();
		x =
			Math.round(
				(limits.x.min +
					Math.max(0, Math.min(1, (local.x - 20) / 260)) * (limits.x.max - limits.x.min)) *
					100
			) / 100;
		y =
			Math.round(
				(limits.y.max -
					Math.max(0, Math.min(1, (local.y - 20) / mapHeight)) * (limits.y.max - limits.y.min)) *
					100
			) / 100;
	}
	function key(event: KeyboardEvent) {
		const delta: Record<string, [Axis, number]> = {
			ArrowLeft: ['x', -step],
			ArrowRight: ['x', step],
			ArrowUp: ['y', step],
			ArrowDown: ['y', -step]
		};
		const chosen = delta[event.key];
		if (!chosen) return;
		event.preventDefault();
		begin();
		const bounds = limits[chosen[0]];
		if (!bounds) return;
		if (chosen[0] === 'x')
			x = Math.max(bounds.min, Math.min(bounds.max, (x ?? bounds.min) + chosen[1]));
		else y = Math.max(bounds.min, Math.min(bounds.max, (y ?? bounds.min) + chosen[1]));
	}
	async function submit(command: PrinterCommand) {
		pending = true;
		error = '';
		try {
			await onSubmit(command);
			reset();
			return true;
		} catch (cause) {
			error = isHttpError(cause)
				? cause.body.message
				: cause instanceof Error
					? cause.message
					: 'Could not submit movement.';
			return false;
		} finally {
			pending = false;
		}
	}
	async function direct(target: Partial<Position>) {
		const expected = position();
		if (!expected) return;
		await submit({ type: 'move', target, expectedPosition: expected });
	}
	async function jog(axis: Axis, delta: number) {
		const destination = jogDestination(snapshot.motion, axis, delta);
		if (destination === null) return;
		if (axis === 'z' && destination < 5 && destination < (snapshot.motion.position.z ?? 0)) {
			begin();
			z = destination;
			return;
		}
		await direct({ [axis]: destination });
	}
	const recent = $derived(
		snapshot.actions
			.filter(
				(action) =>
					action.label.startsWith('Move ') ||
					action.label.startsWith('Home ') ||
					action.label.startsWith('Release ')
			)
			.slice(0, 3)
	);
	const invalidZ = $derived(
		z === undefined || !Number.isFinite(z)
			? 'Enter a Z coordinate.'
			: limits.z && (z < limits.z.min || z > limits.z.max)
				? `Z must be ${limits.z.min}–${limits.z.max} mm.`
				: null
	);
	const active = $derived(
		snapshot.actions.find((action) => action.status === 'queued' || action.status === 'sending')
	);
</script>

<Dialog.Root bind:open={releaseOpen}>
	<section class="motion-panel" aria-labelledby="motion-heading">
		<div class="motion-heading">
			<div>
				<p class="eyebrow">Position & movement</p>
				<h2 id="motion-heading">A destination, not a dozen clicks</h2>
			</div>
			<span class="motion-tag"
				>{snapshot.mode === 'simulator' ? 'Simulator' : 'Live · Read-only'}</span
			>
		</div>
		<p class="intro">
			Choose XY on the bed map and Z on the height scale, review the destination, then move.
			Changing XY alone preserves Z. Check that the path is clear.
		</p>
		<div class="setup-controls">
			<div>
				<h3>Home the printer</h3>
				<div class="jog-buttons">
					{#if progressive}<ActionForm fields={{ intent: 'home', axes: 'all' }}
							>{#snippet children({ pending: submitting, uncertain })}<button
									class="button primary home-all"
									disabled={!!homeAllReason || pending || submitting || uncertain || alreadyHomed}
									title={alreadyHomed
										? 'All axes are already homed.'
										: (homeAllReason ?? undefined)}>Home All</button
								>{/snippet}</ActionForm
						>{:else}
						<button
							class="button primary home-all"
							disabled={!!homeAllReason || pending || alreadyHomed}
							title={alreadyHomed ? 'All axes are already homed.' : (homeAllReason ?? undefined)}
							onclick={() => submit({ type: 'home', axes: 'all' })}>Home All</button
						>{/if}
				</div>
				<p class="help">
					Homing establishes the printer's position.{alreadyHomed
						? ' All axes are already homed.'
						: homeAllReason
							? ` ${homeAllReason}`
							: ''}
				</p>
			</div>
			<div>
				<h3>Disengage motors</h3>
				<div class="jog-buttons">
					<Dialog.Trigger
						class="button secondary"
						disabled={!!releaseReason || pending}
						title={releaseReason ?? undefined}
						onclick={() => (error = '')}>Disengage motors</Dialog.Trigger
					>
				</div>
				<p class="help">
					Releases every motor, regardless of printer kinematics. Home again before using movement
					controls.{releaseReason ? ` ${releaseReason}` : ''}
				</p>
			</div>
		</div>

		<div class="position-strip">
			{#each ['x', 'y', 'z'] as axis}<div>
					<span>{axis.toUpperCase()}</span><strong
						>{snapshot.motion.position[axis as Axis]?.toFixed(2) ?? 'Unknown'}
						<small>mm</small></strong
					><small>{snapshot.motion.homed.includes(axis as Axis) ? 'Homed' : 'Not homed'}</small>
				</div>{/each}
		</div>
		{#if active}<p class="notice" role="status">Pending: {active.label} · {active.status}</p>{/if}
		<div class="motion-grid">
			<div class="bed-area">
				<div class="axis-visuals">
					<div class="xy-area">
						{#if limits.x && limits.y}
							<svg
								class="bed-map"
								viewBox={`0 0 300 ${mapHeight + 40}`}
								role="button"
								tabindex="0"
								aria-label="Bed map: preview an XY destination"
								aria-describedby="map-help"
								onkeydown={key}
								onpointerdown={(event) => {
									dragging = true;
									event.currentTarget.setPointerCapture(event.pointerId);
									select(event);
								}}
								onpointermove={(event) => {
									if (dragging) select(event);
								}}
								onpointerup={() => (dragging = false)}
								onpointercancel={() => (dragging = false)}
							>
								<defs
									><pattern id="bed-grid" width="26" height="26" patternUnits="userSpaceOnUse"
										><path
											d="M 26 0 L 0 0 0 26"
											fill="none"
											stroke="currentColor"
											opacity=".14"
										/></pattern
									></defs
								>
								<rect
									x="20"
									y="20"
									width="260"
									height={mapHeight}
									rx="10"
									class="bed-surface"
								/><rect x="20" y="20" width="260" height={mapHeight} fill="url(#bed-grid)" />
								<text x="20" y={mapHeight + 35}>{limits.x.min}</text><text
									x="280"
									y={mapHeight + 35}
									text-anchor="end">X {limits.x.max} mm</text
								><text x="23" y="14">Y {limits.y.max} mm</text>
								{#if snapshot.motion.position.x !== null && snapshot.motion.position.y !== null}<circle
										cx={project('x', snapshot.motion.position.x)}
										cy={20 + mapHeight - (project('y', snapshot.motion.position.y) - 20)}
										r="6"
										class="current-point"
									/>{/if}
								{#if base && x !== undefined && y !== undefined && !invalidXY}<circle
										cx={project('x', x)}
										cy={20 + mapHeight - (project('y', y) - 20)}
										r="11"
										class="destination-point"
									/><path
										d={`M${project('x', x) - 6},${20 + mapHeight - (project('y', y) - 20)}h12 M${project('x', x)},${20 + mapHeight - (project('y', y) - 20) - 6}v12`}
										class="crosshair"
									/>{/if}
							</svg>
							<p id="map-help" class="help">
								Tap or drag to preview. Arrow keys adjust the preview by {step} mm.
								<span class="legend-current">● Reported position</span>
								· <span class="legend-target">◎ Destination</span>
							</p>
						{:else}<div class="map-empty">
								<h3>Waiting for travel limits</h3>
								<p>
									The printer has not reported its reachable area. No bed dimensions are assumed.
								</p>
							</div>{/if}
					</div>
					<div class="z-area">
						{#if limits.z}<label class="z-scale-label"
								>Z height preview <span>{limits.z.max} mm</span><input
									class="z-scale"
									type="range"
									min={limits.z.min}
									max={limits.z.max}
									step="0.1"
									bind:value={z}
									oninput={begin}
									aria-label="Z height preview"
								/><span>{limits.z.min} mm</span></label
							>{:else}<p class="help">Z travel limits unavailable.</p>{/if}
					</div>
				</div>
			</div>
			<div class="destination-form">
				<h3>Destination</h3>
				<div class="coordinate-fields">
					<label>X (mm)<input type="number" step="0.01" bind:value={x} oninput={begin} /></label
					><label>Y (mm)<input type="number" step="0.01" bind:value={y} oninput={begin} /></label
					><label>Z (mm)<input type="number" step="0.1" bind:value={z} oninput={begin} /></label>
				</div>
				{#if base && invalidXY}<p class="warning">
						{invalidXY} Enter a valid value; typed destinations are never clamped.
					</p>{/if}
				{#if base && invalidZ}<p class="warning">
						{invalidZ} Typed destinations are never clamped.
					</p>{/if}
				{#if lowering}<label class="clearance"
						><input type="checkbox" bind:checked={clearance} /> I checked bed clearance before lowering</label
					>{/if}

				{#if stale}<p class="warning" role="status">
						The printer moved after this preview. Review it using the current position.
					</p>
					<button class="button secondary" onclick={reset}>Use current position</button>{/if}
				{#if reason}<p class="help">{reason}</p>{/if}
				<button
					class="button primary"
					disabled={!!reason ||
						pending ||
						!base ||
						stale ||
						!!invalidXY ||
						!!invalidZ ||
						(lowering && !clearance)}
					onclick={() => {
						if (base && x !== undefined && y !== undefined && z !== undefined)
							void submit({
								type: 'move',
								target: { x, y, z },
								expectedPosition: base,
								confirmedLowering: clearance
							});
					}}>{pending ? 'Submitting…' : 'Move here'}</button
				>
				<div class="motion-tools">
					<div>
						<h3>Fine movement</h3>
						<fieldset class="step-switch">
							<legend>Step</legend>
							<div class="step-options">
								{#each [0.1, 1, 10] as amount}<label
										><input
											type="radio"
											name="movement-step"
											value={amount}
											bind:group={step}
										/><span>{amount} mm</span></label
									>{/each}
							</div>
						</fieldset>
						<p class="help">Jog steps stop at the configured travel boundary.</p>

						<div class="jog-buttons">
							{#each [['X −', 'x', -1], ['X +', 'x', 1], ['Y −', 'y', -1], ['Y +', 'y', 1], ['Z −', 'z', -1], ['Z +', 'z', 1]] as [name, axis, direction]}<button
									class="button secondary"
									disabled={!!reason ||
										pending ||
										jogDestination(snapshot.motion, axis as Axis, Number(direction) * step) ===
											snapshot.motion.position[axis as Axis]}
									title={`${Number(direction) > 0 ? 'Increase' : 'Decrease'} ${String(axis).toUpperCase()}${axis === 'z' ? ' height' : ' position'}`}
									onclick={() => jog(axis as Axis, Number(direction) * step)}>{name}</button
								>{/each}
						</div>
					</div>
				</div>
			</div>
		</div>
		{#if error && !releaseOpen}<p class="warning" role="alert">{error}</p>{/if}
		{#if recent.length}<section class="recent-movement" aria-label="Recent movement">
				<h3>Recent movement</h3>
				{#each recent as action}<div class="movement-result">
						<strong>{action.label}</strong><span class="motion-tag">{action.status}</span
						>{#if action.message}<p class="warning" role="status">{action.message}</p>{/if}
					</div>{/each}
			</section>{/if}
	</section>
	<Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content
			class="dialog-content motor-dialog"
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				keepEngaged?.focus();
			}}
			onEscapeKeydown={(event) => {
				if (pending) event.preventDefault();
			}}
			onInteractOutside={(event) => {
				if (pending) event.preventDefault();
			}}
		>
			<Dialog.Title class="dialog-title">Disengage all motors?</Dialog.Title>
			<Dialog.Description class="motor-description"
				>All motors will stop holding position. Position will become unknown; home the printer again
				before moving.</Dialog.Description
			>
			<p class="motor-consequence">Support the gantry: releasing Z can let it fall.</p>
			{#if releaseReason}<p role="status" class="warning">{releaseReason}</p>{/if}
			{#if error}<p role="alert" class="warning">{error}</p>{/if}
			<div class="motor-actions">
				<Dialog.Close bind:ref={keepEngaged} class="button secondary" disabled={pending}
					>Keep motors engaged</Dialog.Close
				><button
					class="button danger"
					disabled={!!releaseReason || pending}
					onclick={async () => {
						if (releaseReason || pending) return;
						if (await submit({ type: 'releaseMotors', axes: 'all', confirmed: true }))
							releaseOpen = false;
					}}>{pending ? 'Disengaging…' : 'Disengage motors'}</button
				>
			</div>
		</Dialog.Content></Dialog.Portal
	>
</Dialog.Root>

<style>
	.destination-form > .primary {
		width: 100%;
		margin-top: 0.75rem;
	}
	.step-switch {
		border: 0;
		padding: 0;
		margin: 0.75rem 0;
		min-width: 0;
	}
	.step-switch legend {
		font-size: 0.85rem;
		margin-bottom: 0.4rem;
	}
	.step-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		padding: 4px;
		background: var(--canvas);
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		gap: 4px;
	}
	.step-options label {
		position: relative;
		cursor: pointer;
	}
	.step-options input {
		position: absolute;
		opacity: 0;
		width: 100%;
		height: 100%;
		z-index: 1;
		cursor: pointer;
		min-height: 0;
		padding: 0;
	}
	.step-options span {
		display: grid;
		place-items: center;
		min-height: 44px;
		border-radius: 6px;
		font-variant-numeric: tabular-nums;
	}
	.step-options input:checked + span {
		background: var(--highlight);
		color: var(--highlight-text);
		font-weight: 600;
	}
	.step-options input:focus-visible + span {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.setup-controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
	}
	.home-all {
		min-width: 140px;
		min-height: 54px;
		font-size: 1rem;
	}

	:global(.motor-dialog) {
		max-height: calc(100dvh - 32px);
		overflow: auto;
	}
	:global(.motor-dialog .motor-description) {
		color: var(--muted);
		line-height: 1.6;
	}
	.motor-consequence {
		margin: 1rem 0;
		padding: 1rem;
		background: var(--canvas);
		border-left: 3px solid var(--border-strong);
		line-height: 1.6;
	}
	.motor-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	@media (max-width: 540px) {
		.motor-actions {
			flex-direction: column;
		}
		.motor-actions :global(.button) {
			width: 100%;
		}
	}

	.axis-visuals {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 80px;
		gap: 1rem;
	}
	.z-scale-label {
		justify-items: center;
		font-size: 0.75rem;
	}
	input.z-scale {
		writing-mode: vertical-lr;
		direction: rtl;
		appearance: auto;
		height: 220px;
		width: 44px;
		padding: 0;
		accent-color: var(--accent);
	}
	@media (max-width: 1000px) {
		.motion-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 700px) {
		.setup-controls {
			grid-template-columns: 1fr;
			gap: 0.5rem;
		}
		.axis-visuals {
			grid-template-columns: minmax(0, 1fr) 64px;
			gap: 0.6rem;
		}
		input.z-scale {
			height: 150px;
		}
	}

	.recent-movement {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.movement-result {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0.7rem 0;
	}
	.movement-result > p {
		flex-basis: 100%;
		margin: 0;
	}
	.motion-panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: clamp(1rem, 3vw, 2rem);
	}
	.motion-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}
	h2 {
		font-size: 2rem;
	}
	h3 {
		font-size: 1.3rem;
		margin-bottom: 0.75rem;
	}
	.intro {
		color: var(--muted);
		margin: 1rem 0;
		max-width: 70ch;
	}
	.motion-tag {
		font-size: 0.75rem;
		background: var(--highlight);
		color: var(--highlight-text);
		padding: 0.4rem 0.7rem;
		border-radius: 20px;
		white-space: nowrap;
	}
	.position-strip {
		display: flex;
		gap: 1rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--border);
	}
	.position-strip > div {
		flex: 1;
		display: grid;
		gap: 0.25rem;
	}
	.position-strip span {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.position-strip strong {
		font-size: 1.35rem;
		font-variant-numeric: tabular-nums;
	}
	.position-strip small {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.motion-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
		gap: 2rem;
		margin-top: 1.5rem;
	}
	.bed-map {
		width: 100%;
		max-height: 380px;
		touch-action: none;
		cursor: crosshair;
		color: var(--muted);
	}
	.bed-map:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
		border-radius: 12px;
	}
	.bed-map text {
		fill: var(--muted);
		font-size: 10px;
	}
	.bed-surface {
		fill: var(--canvas);
		stroke: var(--border-strong);
	}
	.current-point {
		fill: var(--accent);
	}
	.destination-point {
		fill: var(--highlight);
		stroke: var(--highlight-text);
		stroke-width: 2;
	}
	.crosshair {
		stroke: var(--highlight-text);
		stroke-width: 1.5;
	}
	.help {
		font-size: 0.8rem;
		color: var(--muted);
		line-height: 1.6;
		margin: 0.65rem 0;
	}
	.legend-current {
		color: var(--accent);
	}
	.legend-target {
		color: var(--highlight-text);
	}
	.coordinate-fields {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.85rem;
		font-weight: 500;
	}
	input {
		width: 100%;
		min-height: 44px;
		padding: 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--canvas);
		color: var(--text);
		font: inherit;
	}
	.jog-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.8rem 0;
	}
	.button {
		min-height: 44px;
		white-space: normal;
	}
	.motion-tools {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border);
	}
	.clearance {
		display: flex;
		align-items: start;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.clearance input {
		width: 20px;
		min-height: 20px;
		margin: 2px 0;
	}
	.warning,
	.notice {
		padding: 0.75rem;
		border-radius: 8px;
		background: var(--warning-soft);
		color: var(--warning);
		font-size: 0.85rem;
		margin: 0.75rem 0;
	}
	.map-empty {
		min-height: 240px;
		display: grid;
		place-content: center;
		text-align: center;
		padding: 1rem;
		background: var(--canvas);
		border-radius: 12px;
	}
	@media (max-width: 700px) {
		.motion-grid,
		.motion-tools {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}
		.motion-heading {
			flex-direction: column;
		}
		h2 {
			font-size: 1.65rem;
		}
		.position-strip {
			gap: 0.5rem;
		}
		.position-strip strong {
			font-size: 1rem;
		}
	}
</style>
