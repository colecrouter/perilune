<script lang="ts">
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import type { PrinterLockNotice } from '#lib/domain/printer-locks.js';
	let { snapshot, workflow }: { snapshot: PrinterSnapshot; workflow: PrinterLockNotice['id'] } =
		$props();
	const mesh = $derived(snapshot.meshProbe.session);
	const plan = $derived(mesh?.plan ?? snapshot.liveMesh.plan);
	const total = $derived(
		snapshot.mode === 'simulator' ? 25 : plan ? plan.columns * plan.rows : null
	);
	const fresh = $derived(
		snapshot.connection === 'connected' && snapshot.telemetryReady && snapshot.klippy === 'ready'
	);
	const extrusion = $derived(snapshot.extrusion.session);
</script>

{#if !fresh}<p class="muted">
		Connection interrupted or printer not ready. Showing the last reported workflow state.
	</p>{/if}
{#if workflow === 'mesh' && mesh}
	{#if mesh.stage === 'probing'}
		<p>Mapping the bed · {mesh.completedSamples}{total ? ` of ${total}` : ''} samples reported</p>
		{#if total && total > 0}<progress
				aria-label="Bed-mesh samples"
				max={total}
				value={Math.max(0, Math.min(total, mesh.completedSamples))}
			></progress>{/if}
	{:else if mesh.stage === 'saving'}<p>
			{mesh.operation === 'delete'
				? 'Deleting saved mesh and verifying restart.'
				: mesh.operation === 'load'
					? 'Activating saved mesh.'
					: mesh.operation === 'clear'
						? 'Clearing active compensation.'
						: 'Saving or restoring the mesh and verifying restart.'}
		</p>
	{:else if mesh.stage === 'review'}<p>
			Probing finished. Review the result and choose whether to save or discard it.
		</p>
	{/if}
{:else if workflow === 'extrusion' && extrusion}
	{#if ['extruding', 'feeding'].includes(extrusion.stage) && snapshot.mode === 'moonraker'}<p>
			Filament movement in progress. Waiting for the printer’s acknowledgement.
		</p>
	{:else if ['extruding', 'feeding'].includes(extrusion.stage)}<p>
			Filament movement · {extrusion.completed} of {Math.abs(extrusion.distance)} mm reported
		</p>
		{#if Math.abs(extrusion.distance) > 0}<progress
				aria-label="Extrusion distance"
				max={Math.abs(extrusion.distance)}
				value={Math.max(0, Math.min(Math.abs(extrusion.distance), extrusion.completed))}
			></progress>{/if}
	{:else}<p>
			{extrusion.stage === 'measure'
				? 'Waiting for your filament measurement.'
				: extrusion.stage === 'review'
					? 'Review the measured result.'
					: 'Prepare the filament and measurement.'}
		</p>{/if}
{:else if workflow === 'pid' && snapshot.pid?.run}<p>
		Tuning {snapshot.pid.run.heater === 'nozzle' ? 'nozzle' : 'bed'} at {snapshot.pid.run.target}°C.
		Waiting for Klipper’s result.
	</p>
{:else if workflow === 'z'}<p>Manual Z adjustment · waiting for an operator to continue.</p>
{:else if workflow === 'calibration'}<p>
		{snapshot.calibration.session?.stage === 'review'
			? 'Review the calibration result.'
			: snapshot.calibration.session?.stage === 'first-layer'
				? 'First-layer check in progress.'
				: 'Follow the calibration workshop to continue.'}
	</p>
{:else if workflow === 'filamentChange'}<p>
		{snapshot.filamentChange?.stage === 'waiting'
			? 'Waiting for the configured filament-change pause.'
			: snapshot.filamentChange?.stage === 'review'
				? 'Check the printer before continuing.'
				: 'Print paused for filament handling.'}
	</p>
{/if}

<style>
	p {
		margin: 0.4rem 0;
	}
	progress {
		display: block;
		width: 100%;
		max-width: 36rem;
		height: 0.5rem;
		margin-top: 0.7rem;
		accent-color: var(--accent);
	}
</style>
