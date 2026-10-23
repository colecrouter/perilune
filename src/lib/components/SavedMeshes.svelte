<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { meshProfileReason } from '#lib/domain/live-mesh.js';
	import { meshProbeActive, meshCalibrationTargetSupported } from '#lib/domain/mesh-probe.js';
	import type { BedMesh } from '#lib/domain/bed-mesh.js';
	import type { PrinterSnapshot, PrinterCommand } from '#lib/domain/printer.js';
	let {
		snapshot,
		connected,
		role,
		onSubmit,
		onInspect,
		onReplace,
		onNew
	}: {
		snapshot: PrinterSnapshot;
		connected: boolean;
		role: string;
		onSubmit: (command: PrinterCommand) => Promise<string>;
		onInspect: (name: string) => void;
		onReplace: (name: string) => void;
		onNew?: () => void;
	} = $props();
	let open = $state(false),
		submitting = $state(false),
		failure = $state(''),
		lastAction = $state('');
	let reviewed = $state<{
		operation: 'load' | 'clear' | 'delete';
		mesh: BedMesh | null;
		expected: string;
	}>();
	let referencesChecked = $state(false);
	const receipt = $derived(snapshot.actions.find((a) => a.id === lastAction));
	const blocked = $derived(
		!connected
			? 'Reconnecting to Perilune.'
			: meshProbeActive(snapshot.meshProbe)
				? 'Finish the current mesh workflow.'
				: meshProfileReason(snapshot)
	);
	const allowed = $derived(['owner', 'operator'].includes(role));
	const label = (name: string) => (name === 'default' ? 'Usual mesh' : name);
	const supported = (name: string) =>
		snapshot.mode === 'simulator' || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name);
	function review(operation: 'load' | 'clear' | 'delete', mesh: BedMesh | null) {
		reviewed = {
			operation,
			mesh: mesh ? structuredClone($state.snapshot(mesh)) : null,
			expected: JSON.stringify(mesh)
		};
		referencesChecked = false;
		failure = '';
		open = true;
	}
	async function confirm() {
		if (!reviewed) return;
		submitting = true;
		failure = '';
		try {
			lastAction = await onSubmit({
				type: 'meshProbeProfile',
				probeId: crypto.randomUUID(),
				operation: reviewed.operation,
				name: reviewed.mesh?.name,
				expected: reviewed.expected,
				confirmed: true
			});
			open = false;
		} catch (e) {
			failure = e instanceof Error ? e.message : 'Could not submit the mesh action.';
		} finally {
			submitting = false;
		}
	}
</script>

<section class="saved-meshes panel" aria-labelledby="saved-meshes-title">
	<header>
		<div>
			<h2 id="saved-meshes-title">Saved meshes</h2>
			<p class="muted">
				Active now: <strong
					>{snapshot.bedMesh.active
						? label(snapshot.bedMesh.active.name)
						: 'No compensation'}</strong
				>
			</p>
		</div>
		<div class="actions">
			{#if onNew}<button
					class="button primary"
					disabled={!allowed ||
						meshProbeActive(snapshot.meshProbe) ||
						submitting ||
						!connected ||
						(snapshot.mode === 'moonraker' && !snapshot.liveMesh.enabled)}
					onclick={onNew}>New calibration…</button
				>{/if}
			{#if snapshot.bedMesh.active}<button
					class="button secondary"
					disabled={!allowed || Boolean(blocked) || submitting}
					onclick={() => review('clear', snapshot.bedMesh.active)}>Clear active mesh…</button
				>{/if}
		</div>
	</header>
	{#if blocked}<p class="muted" role="status">{blocked}</p>{/if}
	{#if receipt}<p
			class:failure={receipt.status === 'failed' || receipt.status === 'unknown'}
			role="status"
		>
			{receipt.label}: {receipt.status}. {receipt.message ?? ''}
		</p>{/if}
	{#if !snapshot.bedMesh.profiles.length}<p>No saved meshes are reported.</p>{/if}
	<ul>
		{#each snapshot.bedMesh.profiles.filter((p) => !p.name.startsWith('perilune_')) as mesh (mesh.name)}<li
			>
				<div>
					<strong>{label(mesh.name)}</strong>{#if snapshot.bedMesh.active?.name === mesh.name}<span
							class="active-tag">Active</span
						>{/if}<span class="muted">{mesh.points[0].length} × {mesh.points.length} samples</span>
				</div>
				<div class="actions">
					<button class="button secondary" onclick={() => onInspect(mesh.name)}>Inspect</button
					><button
						class="button secondary"
						disabled={!allowed || Boolean(blocked) || submitting || !supported(mesh.name)}
						onclick={() => review('load', mesh)}>Use…</button
					><button
						class="button secondary"
						disabled={role !== 'owner' ||
							Boolean(blocked) ||
							!meshCalibrationTargetSupported(mesh.name, snapshot.mode === 'simulator')}
						title={!meshCalibrationTargetSupported(mesh.name, snapshot.mode === 'simulator')
							? 'Replacement requires a name of 1–40 letters, numbers, underscores or hyphens (spaces are also supported in the simulator).'
							: undefined}
						onclick={() => onReplace(mesh.name)}>Replace…</button
					><button
						class="button secondary"
						disabled={role !== 'owner' ||
							Boolean(blocked) ||
							submitting ||
							snapshot.bedMesh.active?.name === mesh.name ||
							!supported(mesh.name)}
						title={snapshot.bedMesh.active?.name === mesh.name
							? 'Clear or replace the active mesh before deleting it.'
							: undefined}
						onclick={() => review('delete', mesh)}>Delete…</button
					>
				</div>
			</li>{/each}
	</ul>
	<details>
		<summary>Which mesh will my next print use?</summary>
		<p>
			Saving and selecting a mesh do not change your print-start procedure. A macro or slicer can
			load another mesh, clear compensation, or calibrate a fresh mesh. Print-start behavior has not
			been verified here.
		</p>
		<p>
			For a saved usual mesh, your start procedure should load it after homing and any steps that
			clear compensation:
		</p>
		<pre>BED_MESH_PROFILE LOAD=default</pre>
		<p>
			If you calibrate a fresh mesh for every print, keep that workflow instead. <a
				href="/configuration">Review your start configuration →</a
			>
		</p>
		<p class="muted">
			The usual mesh uses Klipper’s <code>default</code> identifier internally. Selecting a saved mesh
			here only changes compensation now.
		</p>
	</details>
</section>
<Dialog.Root bind:open
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title"
				>{reviewed?.operation === 'delete'
					? 'Delete saved mesh?'
					: reviewed?.operation === 'clear'
						? 'Clear active compensation?'
						: 'Use saved mesh?'}</Dialog.Title
			><Dialog.Description
				>{reviewed?.operation === 'delete'
					? `Permanently delete “${label(reviewed.mesh?.name ?? '')}” and restart Klipper. Known macro references block deletion. Clear or replace any references in slicer start G-code before continuing.`
					: reviewed?.operation === 'clear'
						? 'Turn off mesh compensation now. Saved meshes and print-start configuration are unchanged.'
						: `Activate “${label(reviewed?.mesh?.name ?? '')}” now. This does not move the printer or change what its start procedure selects.`}</Dialog.Description
			>{#if reviewed?.operation === 'delete'}<label class="review-check"
					><input type="checkbox" bind:checked={referencesChecked} /> I checked my print-start and slicer
					settings for references to this mesh.</label
				>{/if}{#if failure}<p role="alert">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Cancel</Dialog.Close><button
					class="button"
					class:danger={reviewed?.operation === 'delete'}
					class:primary={reviewed?.operation !== 'delete'}
					disabled={submitting ||
						Boolean(blocked) ||
						!allowed ||
						(reviewed?.operation === 'delete' && !referencesChecked)}
					onclick={confirm}
					>{submitting
						? 'Submitting…'
						: reviewed?.operation === 'delete'
							? 'Delete and restart'
							: reviewed?.operation === 'clear'
								? 'Clear compensation'
								: 'Use mesh'}</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
	.saved-meshes {
		display: grid;
		gap: 1rem;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--surface);
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}
	h2 {
		margin: 0;
	}
	p {
		line-height: 1.6;
		margin: 0.5rem 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 0;
		border-top: 1px solid var(--border);
	}
	li > div:first-child {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.actions .button {
		padding: 0.55rem 0.8rem;
		min-height: 2.75rem;
	}
	.active-tag {
		color: var(--accent);
		font-size: 0.8rem;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	.review-check {
		display: flex;
		align-items: start;
		gap: 0.6rem;
		margin: 1rem 0;
	}
	.review-check input {
		width: 1.2rem;
		height: 1.2rem;
		flex-shrink: 0;
	}
	.failure {
		color: var(--danger);
	}
	pre {
		overflow: auto;
		padding: 1rem;
		background: var(--background);
		border-radius: 0.5rem;
	}
	@media (max-width: 650px) {
		header,
		li {
			flex-direction: column;
			align-items: stretch;
		}
		.actions {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.saved-meshes {
			padding: 1rem;
		}
	}
</style>
