<script module lang="ts">
	// Vite's CSS preload listeners may retain this factory; keep it outside page state.
	const loadTemperatureHistory = () => import('#lib/components/TemperatureHistory.svelte');
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import ActionForm from '#lib/components/ActionForm.svelte';
	import { Switch } from 'bits-ui';
	import AppShell from '#lib/components/AppShell.svelte';
	import Icon from '#lib/components/Icon.svelte';
	let TemperatureHistory = $state<
		typeof import('#lib/components/TemperatureHistory.svelte').default | null
	>(null);
	onMount(() => {
		void loadTemperatureHistory()
			.then((module) => (TemperatureHistory = module.default))
			.catch(() => {
				historyUnavailable = true;
			});
	});
	import {
		temperatureSensors,
		heaterTargetsOff,
		temperatureReason
	} from '#lib/domain/temperature.js';
	import HeaterControl from '#lib/components/HeaterControl.svelte';
	import CancelDialog from '#lib/components/CancelDialog.svelte';
	import CameraPanel from '#lib/components/CameraPanel.svelte';
	import type { PrinterCommand } from '#lib/domain/printer.js';
	import {
		getDashboard,
		getTemperatureHistory,
		submitAction,
		setSimulatorConnection,
		resetSimulator
	} from './printer.remote.js';

	let { data } = $props();
	const dashboard = getDashboard();
	const temperatureHistory = getTemperatureHistory();
	const initial = $derived(data.initial!);
	const updates = liveConnection(() => dashboard.connected);
	onMount(() => {
		void Promise.resolve(dashboard).catch(() => {});
		void Promise.resolve(temperatureHistory).catch(() => {
			historyUnavailable = true;
		});
	});
	const snapshot = $derived(dashboard.current?.printer ?? initial.printer);
	const cameraSnapshot = $derived(dashboard.current?.camera ?? initial.camera);
	const samples = $derived(temperatureHistory.current ?? []);
	let historyUnavailable = $state(false);
	onMount(() => {
		let refreshing = false;
		const timer = setInterval(async () => {
			if (refreshing || !dashboard.connected) return;
			refreshing = true;
			try {
				await temperatureHistory.refresh();
				historyUnavailable = false;
			} catch {
				historyUnavailable = true;
			} finally {
				refreshing = false;
			}
		}, 5000);
		return () => clearInterval(timer);
	});

	let serif = $state(true);
	let cancelOpen = $state(false);
	let stopJob = $state<{ filename: string; runId: string | null } | undefined>();
	let submitting = $state(false);
	let errorMessage = $state('');
	const pending = $derived(
		snapshot.actions.some((action) => action.status === 'queued' || action.status === 'sending')
	);
	const live = $derived(snapshot.mode === 'moonraker');
	const readOnly = $derived(
		(live && !snapshot.liveControls) ||
			!!snapshot.liveRecovery ||
			!!snapshot.configurationBusy ||
			snapshot.motion.calibration ||
			data.user?.role === 'viewer'
	);
	const connectionLabel = $derived(
		snapshot.connection.charAt(0).toUpperCase() + snapshot.connection.slice(1)
	);
	const connected = $derived(snapshot.connection === 'connected');
	const transportConnected = $derived(updates.available);
	const sensors = $derived(temperatureSensors(snapshot));
	const thermalReady = $derived(
		snapshot.connection === 'connected' && snapshot.klippy === 'ready' && transportConnected
	);
	const alreadyOff = $derived(thermalReady && heaterTargetsOff(snapshot));
	const thermalReason = $derived(
		!transportConnected
			? `${updates.label}. History and drafts are retained.`
			: data.user?.role === 'viewer'
				? 'An operator account is required to change temperatures.'
				: temperatureReason(snapshot)
	);
	const busy = $derived(submitting || pending || snapshot.storage === 'degraded');
	async function send(command: PrinterCommand) {
		if (command.type === 'pause' || command.type === 'resume' || command.type === 'cancel')
			command = {
				...command,
				expectedJob: command.expectedJob ?? {
					filename: snapshot.job.filename,
					runId: snapshot.job.runId ?? null
				}
			};
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
<AppShell {snapshot}>
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
						? updates.label
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
		{#if !live && !readOnly}<section class="simulator-banner" aria-label="Simulator controls">
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
								? snapshot.liveControls
									? 'Live controls enabled · shared across operators'
									: 'Read-only connection; controls are not enabled yet'
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
						? updates.label
						: snapshot.connection === 'connected'
							? `Klipper ${snapshot.klippy}`
							: live
								? `${connectionLabel} to Moonraker`
								: 'Printer disconnected'}</strong
				><span>Last known values remain visible. Your inputs are preserved.</span
				>{#if !transportConnected}<button
						class="button secondary"
						onclick={() => dashboard.reconnect()}>Retry connection</button
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
						<ActionForm
							fields={{
								intent: snapshot.job.state === 'paused' ? 'resume' : 'pause',
								filename: snapshot.job.filename,
								runId: snapshot.job.runId ?? ''
							}}
							>{#snippet children({ pending, uncertain })}<button
									class="button primary"
									disabled={readOnly ||
										busy ||
										pending ||
										uncertain ||
										!connected ||
										!transportConnected ||
										!['printing', 'paused'].includes(snapshot.job.state)}
									><Icon
										name={snapshot.job.state === 'paused' ? 'play' : 'pause'}
										size={18}
									/>{pending
										? 'Submitting…'
										: snapshot.job.state === 'paused'
											? 'Resume print'
											: 'Pause print'}</button
								>{/snippet}</ActionForm
						>
						<a
							role="button"
							href={`/actions?intent=cancel&filename=${encodeURIComponent(snapshot.job.filename)}&runId=${encodeURIComponent(snapshot.job.runId ?? '')}`}
							class="button danger-outline"
							aria-disabled={readOnly ||
								busy ||
								!connected ||
								!transportConnected ||
								(snapshot.job.state !== 'printing' && snapshot.job.state !== 'paused')}
							onclick={(event) => {
								event.preventDefault();
								if (
									readOnly ||
									busy ||
									!connected ||
									!transportConnected ||
									!['printing', 'paused'].includes(snapshot.job.state)
								)
									return;
								stopJob = { filename: snapshot.job.filename, runId: snapshot.job.runId ?? null };
								cancelOpen = true;
							}}><Icon name="stop" size={16} />Stop print</a
						>
					</div>
				</section>
			</div>
			<div class="secondary-column">
				<section class="panel temperature-panel">
					<div class="section-header">
						<h2>Temperature</h2>
						<ActionForm fields={{ intent: 'cooldown' }}
							>{#snippet children({ pending, uncertain })}<button
									class="button secondary"
									disabled={busy ||
										readOnly ||
										!!thermalReason ||
										alreadyOff ||
										pending ||
										uncertain}>Cool down nozzle &amp; bed</button
								>{/snippet}</ActionForm
						>
					</div>
					{#if thermalReason}<p class="muted">{thermalReason}</p>{/if}
					{#if alreadyOff}<p class="muted">
							Both heater targets are already off. The heaters may still be cooling.
						</p>{/if}
					{#if sensors.some((sensor) => sensor.id === 'extruder')}<HeaterControl
							heater="nozzle"
							progressive
							current={snapshot.heaters.nozzle.current}
							target={snapshot.heaters.nozzle.target}
							{readOnly}
							available={thermalReady &&
								snapshot.heaters.nozzle.current !== null &&
								snapshot.heaters.nozzle.target !== null}
							pending={busy || !transportConnected || !!thermalReason}
							onSet={(target) => send({ type: 'temperature', heater: 'nozzle', target })}
						/>{/if}{#if sensors.some((sensor) => sensor.id === 'heater_bed')}<HeaterControl
							heater="bed"
							progressive
							current={snapshot.heaters.bed.current}
							target={snapshot.heaters.bed.target}
							{readOnly}
							available={thermalReady &&
								snapshot.heaters.bed.current !== null &&
								snapshot.heaters.bed.target !== null}
							pending={busy || !transportConnected || !!thermalReason}
							onSet={(target) => send({ type: 'temperature', heater: 'bed', target })}
						/>{/if}
					{#if snapshot.additionalTemperatures.length}<details>
							<summary>Additional sensors ({snapshot.additionalTemperatures.length})</summary>
							<dl class="connection-list">
								{#each snapshot.additionalTemperatures as sensor}<div>
										<dt>{sensor.label}</dt>
										<dd>
											{sensor.current?.toFixed(1) ?? '—'}°C{sensor.heater
												? ` · target ${sensor.target ?? '—'}°C`
												: ''}
										</dd>
									</div>{/each}
							</dl>
							<p class="muted">Additional heaters are monitored read-only.</p>
						</details>{/if}
					{#if TemperatureHistory}<TemperatureHistory
							{samples}
							{sensors}
							connected={thermalReady}
							unavailable={historyUnavailable}
						/>{:else}<p class="muted">Temperature history loads separately from controls.</p>{/if}
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
								<span class="status-dot" class:offline={!transportConnected}></span>{updates.label}
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
		available={thermalReady}
		bind:open={cancelOpen}
		bedTarget={snapshot.heaters.bed.target}
		nozzleTarget={snapshot.heaters.nozzle.target}
		onConfirm={(coolBed, coolNozzle) =>
			send({ type: 'cancel', coolBed, coolNozzle, expectedJob: stopJob })}
	/>
</AppShell>
