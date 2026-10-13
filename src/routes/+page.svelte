<script lang="ts">
	import { Switch } from 'bits-ui';
	import AppShell from '#lib/components/AppShell.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import HeaterControl from '#lib/components/HeaterControl.svelte';
	import CancelDialog from '#lib/components/CancelDialog.svelte';
	import CameraPanel from '#lib/components/CameraPanel.svelte';
	import type { PrinterCommand } from '#lib/domain/printer.js';
	import {
		getPrinter,
		getCamera,
		submitAction,
		setSimulatorConnection,
		resetSimulator
	} from './printer.remote.js';

	let { data } = $props();
	const printer = getPrinter();
	const camera = getCamera();
	const [initial, initialCamera] = await Promise.all([printer, camera]);
	const cameraSnapshot = $derived(camera.current ?? initialCamera);
	const snapshot = $derived(printer.current ?? initial);
	let serif = $state(true);
	let cancelOpen = $state(false);
	let submitting = $state(false);
	let errorMessage = $state('');
	const pending = $derived(
		snapshot.actions.some((action) => action.status === 'queued' || action.status === 'sending')
	);
	const live = $derived(snapshot.mode === 'moonraker');
	const readOnly = $derived(live || data.user?.role === 'viewer');
	const connectionLabel = $derived(
		snapshot.connection.charAt(0).toUpperCase() + snapshot.connection.slice(1)
	);
	const connected = $derived(snapshot.connection === 'connected');
	const transportConnected = $derived(printer.connected);
	const busy = $derived(submitting || pending || snapshot.storage === 'degraded');
	async function send(command: PrinterCommand) {
		submitting = true;
		errorMessage = '';
		try {
			await submitAction({ id: crypto.randomUUID(), command });
		} catch (cause) {
			errorMessage = cause instanceof Error ? cause.message : 'Could not submit action';
			throw cause;
		} finally {
			submitting = false;
		}
	}
	async function control(task: () => Promise<unknown>) {
		errorMessage = '';
		try {
			await task();
		} catch (cause) {
			errorMessage = cause instanceof Error ? cause.message : 'Could not update simulator';
		}
	}
</script>

<svelte:head
	><title>Overview · Perilune</title><meta
		name="description"
		content="Perilune printer control development preview"
	/></svelte:head
>
<AppShell>
	<div class:serif class="dashboard">
		<header class="page-header">
			<div>
				<h1>Overview</h1>
				<p class="muted">Monitor your printer, track progress, and keep things running smoothly.</p>
			</div>
			<div class="header-tools">
				<span class="connection-status"
					><span class="status-dot" class:offline={!connected || !transportConnected}
					></span>{!transportConnected
						? 'Reconnecting'
						: connected
							? 'Connected'
							: connectionLabel}</span
				><label for="serif-switch">Serif headings</label><Switch.Root
					id="serif-switch"
					aria-label="Serif headings"
					bind:checked={serif}
					class="switch"><Switch.Thumb class="switch-thumb" /></Switch.Root
				>
			</div>
		</header>
		{#if !readOnly}<section class="simulator-banner" aria-label="Simulator controls">
				<div>
					<Icon name="monitor" size={24} />
					<p><strong>Simulator</strong><span> · No physical printer is controlled</span></p>
				</div>
				<div class="banner-actions">
					<button
						class="button secondary"
						onclick={() => control(() => setSimulatorConnection(!connected))}
						>{connected ? 'Disconnect' : 'Reconnect'}</button
					><button
						class="button subtle"
						disabled={busy || data.user?.role === 'viewer'}
						onclick={() => control(() => resetSimulator())}>Reset demo</button
					>
				</div>
			</section>{:else}<section
				class="simulator-banner"
				aria-label={live ? 'Live printer mode' : 'Viewer mode'}
			>
				<div>
					<Icon name="monitor" size={24} />
					<p>
						<strong>{live ? 'Live printer' : 'Simulator'}</strong><span>
							· {live
								? 'Read-only connection; controls are not enabled yet'
								: 'Viewer access; printer controls require an operator'}</span
						>
					</p>
				</div>
			</section>{/if}
		{#if !transportConnected || !connected || snapshot.klippy !== 'ready'}<div
				class="reconnect-banner"
				role="status"
			>
				<strong
					>{!transportConnected
						? 'Reconnecting to Perilune'
						: snapshot.connection === 'connected'
							? `Klipper ${snapshot.klippy}`
							: live
								? `${connectionLabel} to Moonraker`
								: 'Printer disconnected'}</strong
				><span>Last known values remain visible. Your inputs are preserved.</span
				>{#if !transportConnected}<button
						class="button secondary"
						onclick={() => printer.reconnect()}>Retry connection</button
					>{/if}
			</div>{/if}
		{#if snapshot.storage === 'degraded'}<div class="reconnect-banner" role="status">
				<strong>Action history storage is recovering</strong><span
					>Commands are paused. Uncertain actions will not be replayed.</span
				>
			</div>{/if}
		{#if errorMessage}<p class="error-text" role="alert">{errorMessage}</p>{/if}
		<div class="dashboard-grid">
			<div class="primary-column">
				<CameraPanel camera={cameraSnapshot} />
				<section class="panel job-panel">
					<div class="section-header">
						<h2>Current job</h2>
						<span class="job-state">{snapshot.job.state}</span>
					</div>
					<div class="job-file">
						<Icon name="jobs" size={30} />
						<div>
							<strong
								>{snapshot.job.filename ||
									(snapshot.telemetryAt === null
										? 'Waiting for printer status'
										: 'No file selected')}</strong
							><small>{live ? 'Live printer status' : 'Simulated print'}</small>
						</div>
					</div>
					<div class="progress-row">
						<progress max="100" value={snapshot.job.progress ?? 0} aria-label="Print progress"
						></progress><strong
							>{snapshot.job.progress === null
								? '—'
								: `${Math.round(snapshot.job.progress)}%`}</strong
						>
					</div>
					<div class="job-metrics">
						<div>
							<span>{live ? 'Remaining (estimate)' : 'Remaining'}</span><strong
								>{snapshot.job.remainingMinutes === null
									? '—'
									: `${snapshot.job.remainingMinutes} min`}</strong
							>
						</div>
						<div>
							<span>Layer</span><strong
								>{snapshot.job.layer ?? '—'} / {snapshot.job.totalLayers ?? '—'}</strong
							>
						</div>
					</div>
					<div class="job-actions">
						<button
							class="button primary"
							disabled={readOnly ||
								busy ||
								!connected ||
								!transportConnected ||
								(snapshot.job.state !== 'printing' && snapshot.job.state !== 'paused')}
							onclick={() =>
								control(() => send({ type: snapshot.job.state === 'paused' ? 'resume' : 'pause' }))}
							><Icon name={snapshot.job.state === 'paused' ? 'play' : 'pause'} size={18} />{busy
								? 'Action pending…'
								: snapshot.job.state === 'paused'
									? 'Resume print'
									: 'Pause print'}</button
						><button
							class="button danger-outline"
							disabled={readOnly ||
								busy ||
								!connected ||
								!transportConnected ||
								(snapshot.job.state !== 'printing' && snapshot.job.state !== 'paused')}
							onclick={() => (cancelOpen = true)}><Icon name="stop" size={16} />Stop print</button
						>
					</div>
				</section>
			</div>
			<div class="secondary-column">
				<section class="panel temperature-panel">
					<div class="section-header"><h2>Temperature</h2></div>
					<HeaterControl
						heater="nozzle"
						current={snapshot.heaters.nozzle.current}
						target={snapshot.heaters.nozzle.target}
						{readOnly}
						pending={busy || !transportConnected}
						onSet={(target) => send({ type: 'temperature', heater: 'nozzle', target })}
					/><HeaterControl
						heater="bed"
						current={snapshot.heaters.bed.current}
						target={snapshot.heaters.bed.target}
						{readOnly}
						pending={busy || !transportConnected}
						onSet={(target) => send({ type: 'temperature', heater: 'bed', target })}
					/>
				</section>
				<section class="panel">
					<div class="section-header"><h2>Connection</h2></div>
					<dl class="connection-list">
						<div>
							<dt>Moonraker</dt>
							<dd>
								<span class="status-dot" class:offline={!connected}></span>{connectionLabel}
							</dd>
						</div>
						<div>
							<dt>Klipper</dt>
							<dd>
								<span class="status-dot" class:offline={!connected || snapshot.klippy !== 'ready'}
								></span>{snapshot.klippy.charAt(0).toUpperCase() + snapshot.klippy.slice(1)}
							</dd>
						</div>
						<div>
							<dt>Updates</dt>
							<dd>
								<span class="status-dot" class:offline={!transportConnected}
								></span>{transportConnected ? 'Live' : 'Reconnecting'}
							</dd>
						</div>
					</dl>
					<small class="snapshot-meta"
						>{live ? 'Live state' : 'Simulated state'} · revision {snapshot.revision}{#if live}<br
							/>{snapshot.telemetryAt === null
								? 'Awaiting telemetry'
								: `Last telemetry ${new Date(snapshot.telemetryAt).toLocaleTimeString()}`} · {snapshot
								.availableObjects.length} available objects{/if}</small
					>
				</section>
				<section class="panel activity-panel">
					<div class="section-header">
						<h2>Activity</h2>
						{#if pending}<span class="tag">Pending</span>{/if}
					</div>
					<div class="activity-list" aria-live="polite">
						{#each snapshot.actions.slice(0, 5) as action (action.id)}<div class="activity-row">
								<Icon name="jobs" />
								<div>
									<strong>{action.label}</strong><small
										>{action.message ??
											new Date(action.createdAt).toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit'
											})}</small
									>
								</div>
								<span
									class="action-status"
									class:failed={action.status === 'failed' || action.status === 'unknown'}
									>{action.status}</span
								>
							</div>{:else}{#if live}<p class="muted">
									No Perilune actions. This printer connection is read-only.
								</p>{:else}<div class="activity-row">
									<Icon name="play" />
									<div><strong>Print started</strong><small>Simulator demonstration</small></div>
								</div>
								<div class="activity-row">
									<Icon name="bed" />
									<div><strong>Bed reached target</strong><small>60°C · simulated</small></div>
								</div>
								<div class="activity-row">
									<Icon name="jobs" />
									<div><strong>File uploaded</strong><small>orbital-bracket.gcode</small></div>
								</div>{/if}{/each}
					</div>
				</section>
			</div>
		</div>
		<footer class="page-footer">Development preview <a href="/roadmap">What’s next</a></footer>
	</div>
	<CancelDialog
		bind:open={cancelOpen}
		bedTarget={snapshot.heaters.bed.target}
		nozzleTarget={snapshot.heaters.nozzle.target}
		onConfirm={(coolBed, coolNozzle) => send({ type: 'cancel', coolBed, coolNozzle })}
	/>
</AppShell>
