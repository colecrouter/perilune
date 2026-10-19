<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { page, navigating } from '$app/state';
	import JobInterventions from './JobInterventions.svelte';
	import CurrentJob from './CurrentJob.svelte';
	import ActionFeedback from './ActionFeedback.svelte';
	import { actionStatusLabel } from '#lib/client/action-label.js';
	import type { ActionRecord } from '#lib/domain/printer.js';
	import { liveConnection } from '#lib/client/live-connection.svelte.js';
	import type { PrinterSnapshot } from '#lib/domain/printer.js';
	import JobTable from './JobTable.svelte';
	import { jobQueryString, type JobPage } from '#lib/domain/job-query.js';
	import { Dialog } from 'bits-ui';
	import { resolve } from '$app/paths';
	import AppShell from '#lib/components/AppShell.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import CancelDialog from '#lib/components/CancelDialog.svelte';
	import { durationLabel, startReason, MAX_GCODE_BYTES, type JobFile } from '#lib/domain/jobs.js';
	import type { PrinterCommand } from '#lib/domain/printer.js';
	import { getPrinter, submitAction } from '../../routes/printer.remote.js';
	let {
		data
	}: {
		data: {
			initial?: { printer: PrinterSnapshot };
			catalog: JobPage;
			selected: JobFile | null;
			missingFile: boolean;
			inspectionError: string | null;
			user: { role: string } | null;
		};
	} = $props();
	const dashboard = getPrinter();
	const updates = liveConnection(() => dashboard.connected);
	const initial = $derived(data.initial!.printer);
	onMount(() => {
		void Promise.resolve(dashboard).catch(() => {});
	});
	const library = { refresh: () => invalidate('perilune:jobs') };
	const snapshot = $derived(dashboard.current ?? initial);
	const catalog = $derived(data.catalog);
	const canOperate = $derived(data.user?.role === 'owner' || data.user?.role === 'operator');
	const live = $derived(snapshot.mode === 'moonraker');
	const pending = $derived(
		snapshot.actions.some((a) => a.status === 'queued' || a.status === 'sending')
	);
	const reason = $derived(
		!canOperate
			? 'An operator account is required.'
			: !updates.available
				? 'Reconnecting to Perilune. Your selection is retained.'
				: startReason(snapshot)
	);
	let search = $state(untrack(() => data.catalog.query.q));
	let material = $state(untrack(() => data.catalog.query.material));
	const selected = $derived(data.selected);
	const routeSearch = $derived(page.url.search);
	const routePath = $derived(page.url.pathname);
	$effect(() => {
		const params = new URLSearchParams(routeSearch);
		search = params.get('q') ?? '';
		material = params.get('material') ?? '';
	});
	const listHref = $derived(resolve('/jobs') + jobQueryString(catalog.query));
	let historyExpanded = $state(false);
	let message = $state('');
	let failure = $state('');
	let stale = $state(false);
	let submitting = $state(false);
	let startOpen = $state(false);
	let startReceipt = $state<ActionRecord | null>(null);
	let startedFileId = $state<string | null>(null);
	const currentStart = $derived(
		startReceipt && selected?.id === startedFileId
			? (snapshot.actions.find((action) => action.id === startReceipt!.id) ?? startReceipt)
			: null
	);
	let removeOpen = $state(false);
	$effect(() => {
		void routePath;
		startOpen = false;
		removeOpen = false;
	});
	let cancelOpen = $state(false);
	let stopJob = $state<{ filename: string; runId: string | null } | undefined>();
	let uploadProgress = $state<number | null>(null);
	let uploading = $state(false);
	let uploadRequest: XMLHttpRequest | undefined;
	let fileInput = $state<HTMLInputElement>();
	const requests = new AbortController();

	let thumbnailFailed = $state(false);
	const missing = false;
	const thumbnail = $derived(
		selected?.metadata?.thumbnail?.startsWith('/api/')
			? resolve('/api/jobs/[operation]', { operation: 'thumbnail' }) + '?id=' + selected.id
			: selected?.metadata?.thumbnail
	);
	$effect(() => {
		const source = thumbnail;
		if (source) thumbnailFailed = false;
	});
	async function api<T>(
		operation: string,
		body?: Record<string, unknown>,
		id?: string
	): Promise<T> {
		const response = await fetch(
			resolve('/api/jobs/[operation]', { operation }) + (id ? '?id=' + encodeURIComponent(id) : ''),
			{
				method: body ? 'POST' : 'GET',
				signal: requests.signal,
				...(body
					? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
					: {})
			}
		);
		const result = await response.json();
		if (!response.ok) throw new Error(result.message ?? 'The operation failed. Try again.');
		return result as T;
	}
	onMount(() => {
		let refreshing = false;
		const timer = setInterval(async () => {
			if (refreshing) return;
			refreshing = true;
			try {
				await library.refresh();
				stale = false;
			} catch {
				stale = true;
			} finally {
				refreshing = false;
			}
		}, 5000);
		return () => {
			clearInterval(timer);
			requests.abort();
			uploadRequest?.abort();
		};
	});
	async function upload(file: File | undefined) {
		if (!file || uploading) return;
		failure = '';
		message = '';
		if (file.size > MAX_GCODE_BYTES) {
			failure = 'Choose a G-code file up to 20 MiB.';
			return;
		}
		uploading = true;
		uploadProgress = 0;
		try {
			const result = await new Promise<{ file: JobFile }>((accept, reject) => {
				const xhr = new XMLHttpRequest();
				uploadRequest = xhr;
				xhr.open(
					'POST',
					resolve('/api/jobs/[operation]', { operation: 'upload' }) +
						'?name=' +
						encodeURIComponent(file.name)
				);
				xhr.timeout = 60_000;
				xhr.setRequestHeader('Content-Type', 'application/octet-stream');
				xhr.upload.onprogress = (event) => {
					uploadProgress = event.lengthComputable
						? Math.round((100 * event.loaded) / event.total)
						: null;
				};
				xhr.onload = () => {
					try {
						const result = JSON.parse(xhr.responseText);
						if (xhr.status >= 200 && xhr.status < 300) accept(result);
						else reject(new Error(result.message ?? 'Upload failed.'));
					} catch {
						reject(new Error('Upload failed. Retry the same file to check whether it was saved.'));
					}
				};
				xhr.onerror = () =>
					reject(new Error('Connection lost. Refresh the library before taking another action.'));
				xhr.ontimeout = () =>
					reject(new Error('Upload timed out. Retry the same file to check whether it was saved.'));
				xhr.onabort = () =>
					reject(new Error('Upload cancelled. Refresh the library to check whether it was saved.'));
				xhr.send(file);
			});
			await goto(resolve('/jobs/[id]', { id: result.file.id }) + jobQueryString(catalog.query));
			message = `${result.file.name} is ready to inspect.`;
			await library.refresh();
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Upload failed.';
		} finally {
			uploading = false;
			uploadProgress = null;
			uploadRequest = undefined;
			if (fileInput) fileInput.value = '';
		}
	}
	async function command(command: PrinterCommand) {
		if (command.type === 'pause' || command.type === 'resume' || command.type === 'cancel')
			command = {
				...command,
				expectedJob: command.expectedJob ?? {
					filename: snapshot.job.filename,
					runId: snapshot.job.runId ?? null
				}
			};
		submitting = true;
		failure = '';
		try {
			const receipt = await submitAction({ id: crypto.randomUUID(), command });
			if (command.type === 'start') {
				startReceipt = receipt;
				startedFileId = command.fileId;
			}
			message = ''; // The shared job card and activity already show command progress.
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not submit the action.';
			throw cause;
		} finally {
			submitting = false;
		}
	}
	async function start() {
		if (!selected) return;
		try {
			await command({ type: 'start', fileId: selected.id });
			startOpen = false;
		} catch {
			/* failure shown in dialog */
		}
	}
	async function remove() {
		if (!selected) return;
		submitting = true;
		failure = '';
		try {
			await api('remove', { id: selected.id });
			message = `Removed ${selected.name}.`;

			removeOpen = false;
			await goto(listHref);
			await library.refresh();
		} catch (cause) {
			failure = cause instanceof Error ? cause.message : 'Could not remove this file.';
		} finally {
			submitting = false;
		}
	}
	const sizeLabel = (bytes: number) =>
		bytes >= 1024 * 1024
			? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
			: `${Math.max(1, Math.round(bytes / 1024))} KiB`;
</script>

<svelte:head><title>Jobs · Perilune</title></svelte:head>
<AppShell {snapshot} active="Jobs"
	><div class="jobs-page serif">
		<header>
			<div>
				<p class="eyebrow">From slice to orbit</p>
				<h1>Jobs</h1>
				<p class="muted">Your files, their print settings, and a clear path to the next job.</p>
			</div>
			<span class="mode-label"
				>{live
					? snapshot.liveControls
						? 'Live printer library'
						: 'Live library · read-only'
					: 'Simulator · no physical printer is controlled'}</span
			>
		</header>
		{#if failure}<p role="alert" class="notice error-text">{failure}</p>{/if}
		{#if message}<p role="status" class="notice">{message}</p>{/if}
		{#if !updates.available || snapshot.connection !== 'connected' || snapshot.klippy !== 'ready'}
			<p class="notice" role="status">
				{!updates.available ? 'Reconnecting to Perilune.' : 'The printer is unavailable.'} Showing the
				last known job; your file selection is retained. Print controls will return when the connection
				is ready.
			</p>
		{/if}
		{#if stale || !catalog.available}<p class="notice">
				Library connection unavailable. Showing the last known files; your selection is retained.
			</p>{/if}
		<CurrentJob
			compact
			{snapshot}
			available={updates.available}
			operator={canOperate}
			onStop={() => {
				stopJob = { filename: snapshot.job.filename, runId: snapshot.job.runId ?? null };
				cancelOpen = true;
			}}
		/>
		<div
			class="library-grid"
			class:detail={Boolean(page.params.id)}
			aria-busy={Boolean(navigating.to)}
		>
			<section class="panel library">
				<div class="section-top">
					<h2>File library</h2>
					<span class="muted">{catalog.total} {catalog.total === 1 ? 'file' : 'files'}</span>
				</div>
				{#if catalog.total > 0 || search || material}<form
						class="library-filters"
						method="GET"
						action={resolve('/jobs')}
						data-sveltekit-reset="false"
					>
						<label class="search-label"
							>Find a file<input
								name="q"
								type="search"
								placeholder="Search filenames…"
								bind:value={search}
							/></label
						>
						<label class="search-label"
							>Material<select
								name="material"
								bind:value={material}
								disabled={!catalog.metadataComplete}
								><option value="">All materials</option>{#each catalog.materials as value}<option
										{value}>{value}</option
									>{/each}</select
							></label
						>
						<input type="hidden" name="sort" value={catalog.query.sort} />
						<input type="hidden" name="direction" value={catalog.query.direction} />
						<input type="hidden" name="size" value={catalog.query.pageSize} />
						<button class="button secondary" type="submit">Search</button>
					</form>{/if}
				{#if canOperate && (!live || snapshot.liveControls)}<div class="upload-zone">
						<Icon name="jobs" size={28} />
						<div>
							<strong>Bring your next print aboard</strong>
							<p class="muted">Text .gcode files · up to 20 MiB · uploads never start a print</p>
						</div>
						<input
							bind:this={fileInput}
							class="file-input"
							type="file"
							accept=".gcode"
							aria-label="Upload G-code"
							disabled={uploading}
							onchange={(event) => void upload(event.currentTarget.files?.[0])}
						/><button class="button primary" disabled={uploading} onclick={() => fileInput?.click()}
							>{uploading ? 'Uploading…' : 'Upload G-code'}</button
						>{#if uploading}<div class="upload-status">
								<progress max="100" value={uploadProgress ?? undefined} aria-label="Upload progress"
								></progress><span
									>{uploadProgress === 100
										? 'Saving and inspecting…'
										: uploadProgress === null
											? 'Uploading…'
											: `${uploadProgress}%`}</span
								><button class="button secondary" onclick={() => uploadRequest?.abort()}
									>Cancel upload</button
								>
							</div>{/if}
					</div>{:else}<p class="muted">
						{live
							? 'Live file changes are disabled on this server.'
							: 'An operator account is needed to upload and start jobs.'}
					</p>{/if}
				{#if !catalog.metadataComplete}<p class="muted metadata-hint">
						Slicer details are loaded when you open a file. Material filtering and estimate sorting
						become available once all file details are known.
					</p>{/if}
				{#if catalog.total > 0 || search || material}<JobTable
						{catalog}
						selectedId={selected?.id}
					/>{:else}<p class="muted">
						Upload your first sliced file, or <a href="/account#integrations">connect your slicer</a
						>.
					</p>{/if}
			</section>
			<aside
				id="job-inspection"
				class="panel inspection"
				class:empty={!selected}
				aria-label="Job inspection"
			>
				{#if selected}<a class="back-library" href={listHref}>← Back to library</a>
					<p class="eyebrow">Before you print</p>
					<h2>{selected.name}</h2>
					{#if data.inspectionError}<p role="alert" class="muted">
							{data.inspectionError} Last known details are retained.
						</p>{/if}
					<div class="thumbnail">
						{#if thumbnail && !thumbnailFailed}<img
								src={thumbnail}
								alt={`Slicer preview of ${selected.name}`}
								onerror={() => {
									thumbnailFailed = true;
								}}
							/>{:else}<Icon name="jobs" size={56} />
							<p>No slicer thumbnail</p>{/if}
					</div>

					<JobInterventions inspection={selected.metadata?.manualInterventions} />
					<dl>
						<div>
							<dt>Estimated time</dt>
							<dd>{durationLabel(selected.metadata?.estimatedSeconds ?? null)}</dd>
						</div>
						<div>
							<dt>Material</dt>
							<dd>{selected.metadata?.material ?? 'Not reported'}</dd>
						</div>
						<div>
							<dt>Layer height</dt>
							<dd>
								{selected.metadata?.layerHeight
									? `${selected.metadata.layerHeight} mm`
									: 'Not reported'}
							</dd>
						</div>
						<div>
							<dt>Layers</dt>
							<dd>{selected.metadata?.layers ?? 'Not reported'}</dd>
						</div>
						<div>
							<dt>Filament</dt>
							<dd>
								{selected.metadata?.filamentGrams
									? `${selected.metadata.filamentGrams} g`
									: 'Not reported'}
							</dd>
						</div>
						<div>
							<dt>Slicer</dt>
							<dd>{selected.metadata?.slicer ?? 'Not reported'}</dd>
						</div>
						<div>
							<dt>File size</dt>
							<dd>{sizeLabel(selected.size)}</dd>
						</div>
					</dl>
					<p class="metadata-hint">
						These are slicer estimates, not a guarantee of printer compatibility. Missing details
						mean the file didn’t report them.
					</p>
					<div class="readiness">
						<h3>Ready to start?</h3>
						<p>
							{missing
								? 'This file is no longer in the library.'
								: (reason ??
									(live
										? 'The printer is ready for this job.'
										: 'The simulator is ready for this job.'))}
						</p>
						{#if !live}<p class="muted">
								Simulator jobs advance at 1% per second. Their timing does not represent a real
								print.
							</p>{/if}
					</div>
					{#if currentStart}<div class="start-result" role="status">
							<ActionFeedback receipt={currentStart} showCompleted /><a href="/"
								>View current print →</a
							>
						</div>{/if}
					<a
						role="button"
						href={`/actions?intent=start&fileId=${selected.id}`}
						class="button primary start-button"
						aria-disabled={Boolean(reason) || missing || submitting || stale || !catalog.available}
						onclick={(event) => {
							event.preventDefault();
							if (reason || missing || submitting || stale || !catalog.available) return;
							startOpen = true;
							failure = '';
						}}>Review & start {live ? 'print' : 'simulation'}</a
					>
					{#if canOperate && (!live || snapshot.liveControls)}<button
							class="button secondary start-button"
							disabled={submitting || missing}
							onclick={() => {
								removeOpen = true;
								failure = '';
							}}>Remove file…</button
						>{/if}
				{:else}<div class="empty-inspection">
						<p class="eyebrow">Before you print</p>
						<h2>
							{data.missingFile
								? 'This file is no longer available.'
								: 'A little preparation goes a long way.'}
						</h2>
						<p class="muted">
							{data.missingFile
								? 'It may have been removed by another operator. Choose another file from the library.'
								: 'Select a file to inspect its material, duration and slicer settings before starting.'}
						</p>
						<div class="inspection-orbit" aria-hidden="true">☾</div>
					</div>{/if}
			</aside>
		</div>
		<section class="panel history">
			<div class="section-top">
				<h2>Recent prints</h2>
				<span class="muted">Shared across users</span>
			</div>
			<p class="muted">Recent print outcomes and progress.</p>
			{#if !catalog.historyAvailable}<p role="alert" class="error-text">
					Print history storage is unavailable. Updates will retry automatically.
				</p>{/if}
			<div class="run-list">
				{#each historyExpanded ? catalog.runs : catalog.runs.slice(0, 5) as run (run.id)}<div
						class="run"
					>
						<span
							><strong>{run.filename}</strong><small>{new Date(run.started).toLocaleString()}</small
							></span
						><span class="run-state">{run.state}</span><span class="muted"
							>{run.progress === null ? '—' : `${Math.round(run.progress)}%`}</span
						>
					</div>{:else}<p>No recorded prints yet.</p>{/each}
			</div>
			{#if catalog.runs.length > 5}<button
					class="button secondary"
					onclick={() => {
						historyExpanded = !historyExpanded;
					}}
					>{historyExpanded
						? 'Show recent five'
						: `Show all ${catalog.runs.length} retained prints`}</button
				>{/if}
		</section>
		{#if canOperate}<p class="panel">
				<a href="/account#integrations">Connect your slicer in Account → Integrations</a>
			</p>{/if}
		<section class="panel action-history">
			<h2>Actions</h2>
			{#each snapshot.actions.slice(0, 8) as action (action.id)}<div class="run">
					<span
						>{action.label}{#if action.message}<small>{action.message}</small>{/if}</span
					><span class="run-state">{actionStatusLabel[action.status]}</span>
				</div>{:else}<p class="muted">No pending or recent actions.</p>{/each}
		</section>
	</div></AppShell
>
<Dialog.Root bind:open={startOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title"
				>{live ? 'Start this print?' : 'Start this simulated print?'}</Dialog.Title
			><Dialog.Description class="muted"
				>{selected?.name}. {live
					? 'This starts the job on your physical printer. Check that the bed and toolhead path are clear.'
					: 'This changes simulator state only. It will not move or heat your real printer.'}</Dialog.Description
			><JobInterventions inspection={selected?.metadata?.manualInterventions} />{#if reason}<p
					class="error-text"
				>
					{reason}
				</p>{/if}{#if failure}<p role="alert" class="error-text">
					{failure}
				</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep reviewing</Dialog.Close
				><button
					class="button primary"
					disabled={Boolean(reason) || submitting || missing}
					onclick={() => void start()}
					>{submitting ? 'Submitting…' : live ? 'Start print' : 'Start simulated print'}</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<Dialog.Root bind:open={removeOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content"
			><Dialog.Title class="dialog-title">Remove this file?</Dialog.Title><Dialog.Description
				class="muted"
				>Remove {selected?.name} from {live
					? 'the printer’s G-code library'
					: 'the simulator library'}. Its print history will remain.</Dialog.Description
			>{#if failure}<p role="alert" class="error-text">{failure}</p>{/if}
			<div class="dialog-actions">
				<Dialog.Close class="button secondary" disabled={submitting}>Keep file</Dialog.Close><button
					class="button danger"
					disabled={submitting}
					onclick={() => void remove()}>Remove file</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>
<CancelDialog
	available={updates.available &&
		snapshot.connection === 'connected' &&
		snapshot.klippy === 'ready'}
	bind:open={cancelOpen}
	bedTarget={snapshot.heaters.bed.target}
	nozzleTarget={snapshot.heaters.nozzle.target}
	onConfirm={(coolBed, coolNozzle) =>
		command({ type: 'cancel', coolBed, coolNozzle, expectedJob: stopJob })}
/>

<style>
	.jobs-page {
		max-width: 1500px;
		margin: auto;
		padding: clamp(1rem, 3vw, 2.5rem);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.8rem;
	}
	header h1 {
		margin: 0.3rem 0 0.7rem;
	}
	.mode-label {
		font-size: 0.78rem;
		color: var(--muted);
		max-width: 230px;
		text-align: right;
	}
	.panel {
		padding: 1.3rem;
		margin-bottom: 1.2rem;
	}
	.notice {
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.library-grid {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
		gap: 1.2rem;
	}
	.section-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h2 {
		font-size: 1.6rem;
	}
	.search-label {
		display: grid;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	input {
		min-width: 0;
		width: 100%;
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface);
		color: var(--text);
	}
	.upload-zone {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		border: 1px dashed var(--border);
		border-radius: 12px;
		padding: 1.1rem;
		margin: 1.1rem 0;
		background: var(--surface);
	}
	.upload-zone strong {
		font-size: 0.9rem;
	}
	.upload-zone p {
		font-size: 0.77rem;
		margin: 0.35rem 0;
	}
	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.upload-status {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		width: 100%;
		flex-wrap: wrap;
	}
	.upload-status progress {
		flex: 1;
		min-width: 100px;
	}
	.library-filters {
		display: flex;
		gap: 0.7rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.library-filters .search-label:first-child {
		flex: 1;
		min-width: 140px;
	}
	select {
		padding: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface);
		color: var(--text);
		max-width: 100%;
	}
	.back-library {
		display: inline-block;
		color: var(--accent);
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}
	.run small {
		display: block;
		color: var(--muted);
		margin-top: 0.4rem;
		font-size: 0.75rem;
	}
	.inspection h2 {
		overflow-wrap: anywhere;
		margin: 0.7rem 0 1rem;
	}
	.thumbnail {
		min-height: 170px;
		border-radius: 12px;
		background: var(--surface);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--muted);
		margin-bottom: 1rem;
	}
	.thumbnail img {
		max-width: 100%;
		max-height: 260px;
		object-fit: contain;
		padding: 1rem;
	}
	.thumbnail p {
		font-size: 0.8rem;
	}
	dl {
		margin: 0;
	}
	dl > div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.85rem;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		text-align: right;
		max-width: 65%;
		overflow-wrap: anywhere;
	}
	.metadata-hint {
		color: var(--muted);
		font-size: 0.76rem;
		line-height: 1.6;
	}
	.readiness {
		background: var(--surface);
		border-radius: 9px;
		padding: 1rem;
		margin: 1.2rem 0;
		font-size: 0.83rem;
	}
	.readiness h3 {
		margin: 0 0 0.7rem;
	}
	.start-button {
		width: 100%;
		margin-top: 0.6rem;
	}
	.empty-inspection {
		padding: 1rem;
	}
	.empty-inspection h2 {
		line-height: 1.3;
	}
	.empty-inspection p {
		line-height: 1.7;
	}
	.inspection-orbit {
		font-size: 100px;
		text-align: center;
		color: var(--accent);
		margin: 2rem;
	}
	.run {
		display: flex;
		gap: 1rem;
		justify-content: space-between;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--border);
		align-items: center;
		font-size: 0.85rem;
	}
	.run > span:first-child {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.run-state {
		color: var(--accent);
		font-size: 0.8rem;
	}
	.history > p {
		font-size: 0.8rem;
	}
	.start-result {
		margin: 1rem 0;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
	}
	@media (max-width: 850px) {
		.inspection.empty {
			display: none;
		}
	}
	@media (max-width: 850px) {
		.library-grid.detail .library {
			display: none;
		}
	}
	@media (max-width: 850px) {
		.library-grid {
			grid-template-columns: 1fr;
		}
		header {
			align-items: flex-start;
			flex-direction: column;
		}
		.mode-label {
			text-align: left;
			max-width: none;
		}
		.panel {
			padding: 1rem;
		}
		.run {
			gap: 0.5rem;
		}
		.jobs-page {
			padding: 1rem;
		}
	}
</style>
