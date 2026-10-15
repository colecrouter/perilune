<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { isHttpError } from '@sveltejs/kit';
	import type { ConsoleSnapshot, ConsoleReceipt } from '#lib/domain/console.js';
	import { consoleScript } from '#lib/domain/console.js';
	let {
		snapshot,
		connected,
		onSubmit,
		onFind,
		onPin
	}: {
		snapshot: ConsoleSnapshot & { pins: string[] };
		connected: boolean;
		onSubmit: (request: { id: string; script: string }) => Promise<ConsoleReceipt>;
		onFind: (id: string) => Promise<ConsoleReceipt | null>;
		onPin: (request: { name: string; pinned: boolean }) => Promise<unknown>;
	} = $props();
	let draft = $state(''),
		search = $state(''),
		filter = $state('all'),
		showInternal = $state(false),
		follow = $state(true);
	let message = $state(''),
		pending = $state(false),
		pinPending = $state(''),
		reviewOpen = $state(false);
	let request = $state<{ id: string; script: string } | null>(null),
		uncertain = $state<{ id: string; script: string } | null>(null);
	let log = $state<HTMLDivElement | null>(null);
	const reason = $derived(
		!connected ? 'Reconnecting to Perilune. Your input is kept.' : snapshot.reason
	);
	const macros = $derived(
		snapshot.macros
			.filter(
				(m) =>
					(showInternal || !m.name.startsWith('_')) &&
					`${m.name} ${m.description}`.toLowerCase().includes(search.toLowerCase())
			)
			.sort(
				(a, b) =>
					Number(snapshot.pins.includes(b.name)) - Number(snapshot.pins.includes(a.name)) ||
					a.name.localeCompare(b.name)
			)
	);
	const lines = $derived(
		[
			...snapshot.responses.map((r) => ({ ...r, detail: 'Printer response' })),
			...snapshot.receipts.map((r) => ({
				id: r.id,
				at: r.createdAt,
				kind: r.status === 'failed' || r.status === 'unknown' ? 'error' : 'command',
				text: r.script,
				detail: `Simulator · ${r.status}`,
				receipt: r
			}))
		]
			.filter(
				(line) =>
					filter === 'all' ||
					(filter === 'errors' ? line.kind === 'error' : line.kind === 'command')
			)
			.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
	);
	$effect(() => {
		void snapshot.revision;
		void filter;
		if (follow && log) log.scrollTop = log.scrollHeight;
	});
	$effect(() => {
		if (!uncertain) return;
		const found = snapshot.receipts.find((receipt) => receipt.id === uncertain!.id);
		if (found) {
			accepted(found);
			uncertain = null;
			message = 'Submission found in shared history. It was not sent again.';
		}
	});
	function accepted(receipt: ConsoleReceipt) {
		if (draft.trim() === receipt.script) draft = '';
	}
	function review(script = draft) {
		message = '';
		if (reason || pending || uncertain) return;
		try {
			request = { id: crypto.randomUUID(), script: consoleScript(script) };
			reviewOpen = true;
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Check the command.';
		}
	}
	async function send() {
		if (!request || reason || pending || uncertain) return;
		const current = request;
		pending = true;
		message = '';
		try {
			const receipt = await onSubmit(current);
			accepted(receipt);
			reviewOpen = false;
			request = null;
		} catch (cause) {
			if (isHttpError(cause)) {
				message =
					typeof cause.body?.message === 'string'
						? cause.body.message
						: 'Command rejected. Your input is kept.';
			} else {
				uncertain = current;
				message =
					'Submission outcome is uncertain. Check its receipt before sending another command. Nothing will be resent automatically.';
			}
			reviewOpen = false;
		} finally {
			pending = false;
		}
	}
	async function check() {
		if (!uncertain || pending) return;
		pending = true;
		try {
			const receipt = await onFind(uncertain.id);
			if (receipt) {
				accepted(receipt);
				uncertain = null;
				message = 'Submission found. Check its status in history.';
			} else
				message =
					'No receipt found yet. Keep this request ID and check again; absence does not prove the original request cannot arrive.';
		} catch {
			message = 'Could not check the receipt. Your input and request ID are kept.';
		} finally {
			pending = false;
		}
	}
	function stopTracking() {
		if (!uncertain || pending) return;
		if (
			window.confirm(
				`Stop tracking request ${uncertain.id}? This does not cancel it; it may still appear in history. A new submission could run again.`
			)
		) {
			uncertain = null;
			message =
				'Stopped tracking the request. It was not cancelled or resent; check shared history before submitting it again.';
		}
	}
	async function pin(name: string) {
		if (pinPending) return;
		pinPending = name;
		try {
			await onPin({ name, pinned: !snapshot.pins.includes(name) });
		} catch {
			message = 'Could not update this shortcut.';
		} finally {
			pinPending = '';
		}
	}
</script>

<div class="console-grid">
	<section class="panel macros">
		<h2>Printer macros</h2>
		<p class="muted">Descriptions come from the printer. Pin the ones you reach for often.</p>
		<label class="search"
			>Find a macro<input
				type="search"
				bind:value={search}
				placeholder="Name or description"
			/></label
		>
		<label class="check"
			><input type="checkbox" bind:checked={showInternal} />Show internal macros</label
		>
		{#each macros as macro}<article>
				<div class="macro-title">
					<h3>{macro.name}</h3>
					<button
						class="pin"
						disabled={!!pinPending || !connected}
						aria-label={`${snapshot.pins.includes(macro.name) ? 'Unpin' : 'Pin'} ${macro.name}`}
						aria-pressed={snapshot.pins.includes(macro.name)}
						onclick={() => pin(macro.name)}>{snapshot.pins.includes(macro.name) ? '★' : '☆'}</button
					>
				</div>
				<p>{macro.description}</p>
				<button
					disabled={!!reason || pending || !!uncertain}
					onclick={() => {
						review(macro.name);
					}}>Review {macro.name}</button
				>
			</article>{:else}<p class="muted">
				{search
					? 'No matching macros.'
					: snapshot.mode === 'moonraker'
						? 'No macros discovered yet. They appear when Klipper is ready.'
						: 'No macros to show.'}
			</p>{/each}
		<a href="https://www.klipper3d.org/Command_Templates.html" target="_blank" rel="noreferrer"
			>Understanding Klipper macros ↗</a
		>
	</section>
	<section class="panel console">
		<div class="console-heading">
			<div>
				<h2>Command log</h2>
				<p class="muted">
					{snapshot.mode === 'simulator'
						? 'Simulator diagnostics · no physical commands'
						: 'Live responses · execution disabled'}
				</p>
			</div>
			<span class="connection"
				>{connected && snapshot.connection === 'connected' ? 'Connected' : 'Reconnecting'}</span
			>
		</div>
		{#if reason}<p class="notice" role="status">{reason}</p>{/if}
		<div class="log-tools">
			<label
				>Show<select bind:value={filter}
					><option value="all">All activity</option><option value="errors"
						>Errors & unknown outcomes</option
					><option value="commands">Submitted commands</option></select
				></label
			><label class="check"><input type="checkbox" bind:checked={follow} />Follow latest</label>
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to focus and scroll retained output.) -->
		<div class="log" bind:this={log} role="region" aria-label="Console history" tabindex="0">
			{#each lines as line (line.id)}<div class:error={line.kind === 'error'} class="log-entry">
					<div class="meta">
						<time>{new Date(line.at).toLocaleTimeString()}</time><span>{line.detail}</span>
					</div>
					<pre>{line.text}</pre>
					{#if 'receipt' in line && line.receipt}<div class="output">
							{#each line.receipt.output as output}<pre>{output}</pre>{/each}{#if line.receipt.message}<p
								>
									{line.receipt.message}
								</p>{/if}{#if ['queued', 'sending'].includes(line.receipt.status)}<p role="status">
									{line.receipt.status === 'queued'
										? 'Waiting for backend execution…'
										: 'Executing in the simulator…'}
								</p>{/if}
						</div>{/if}
				</div>{:else}<p class="empty">
					{filter === 'errors'
						? 'No errors in retained history.'
						: 'Responses and submitted commands will appear here.'}
				</p>{/each}
		</div>
		<p class="muted small">
			Shared with operators and owners. Latest 100 commands and 200 live responses; older entries
			may be omitted. Unknown outcomes are never replayed.
		</p>
		<label class="composer"
			>Command<textarea
				bind:value={draft}
				rows="3"
				maxlength="2048"
				placeholder={snapshot.mode === 'simulator'
					? 'Try HELP, M105, or PERILUNE_STATUS'
					: 'Prepare a command for review; live execution is not enabled.'}
				spellcheck="false"></textarea></label
		>
		<p class="muted small">
			{snapshot.mode === 'simulator'
				? 'The simulator supports M105, M114, HELP and the listed example macros. Other commands produce a clear error.'
				: 'Parameters are not inferred from macro source. Review the printer configuration before using a macro.'}
		</p>
		<button
			class="button primary"
			disabled={!!reason || pending || !!uncertain || !draft.trim()}
			onclick={() => review()}>Review command…</button
		>
		{#if uncertain}<div class="notice">
				<p>Unconfirmed request: <code>{uncertain.id}</code></p>
				<button disabled={pending} onclick={check}>Check receipt</button><button
					disabled={pending}
					onclick={stopTracking}>Stop tracking…</button
				>
			</div>{/if}
		{#if message}<p role="status" class="notice">{message}</p>{/if}
	</section>
</div>
<Dialog.Root bind:open={reviewOpen}
	><Dialog.Portal
		><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content console-review"
			><Dialog.Title>Review simulator command</Dialog.Title><Dialog.Description
				>The backend runs this diagnostic once. No physical movement or heating is performed.</Dialog.Description
			>{#if request}<pre>{request.script}</pre>{/if}{#if reason}<p role="status">{reason}</p>{/if}
			<div class="review-actions">
				<Dialog.Close disabled={pending}>Keep editing</Dialog.Close><button
					class="button primary"
					disabled={!!reason || pending || !!uncertain}
					onclick={send}>{pending ? 'Submitting…' : 'Run in simulator'}</button
				>
			</div></Dialog.Content
		></Dialog.Portal
	></Dialog.Root
>

<style>
	.console-grid {
		display: grid;
		grid-template-columns: minmax(250px, 340px) minmax(0, 1fr);
		gap: 1.2rem;
		align-items: start;
	}
	.panel {
		padding: 1.4rem;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--surface);
		min-width: 0;
	}
	h2 {
		font-size: 1.7rem;
		margin: 0 0 0.5rem;
	}
	h3 {
		font-size: 0.95rem;
		overflow-wrap: anywhere;
		margin: 0;
	}
	p {
		line-height: 1.6;
	}
	article {
		padding: 1rem 0;
		border-top: 1px solid var(--border);
	}
	article p {
		font-size: 0.85rem;
		color: var(--muted);
		margin: 0.6rem 0;
	}
	.macro-title,
	.console-heading,
	.log-tools {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: center;
	}
	.console-heading {
		align-items: start;
	}
	.connection {
		font-size: 0.75rem;
		color: var(--muted);
		white-space: nowrap;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: 0.78rem;
	}
	.search,
	.composer {
		display: grid;
		gap: 0.5rem;
		font-weight: 600;
	}
	.search {
		margin: 1rem 0;
	}
	.check {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		min-height: 44px;
		font-size: 0.85rem;
	}
	.check input {
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
	}
	input[type='search'],
	textarea,
	select {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		font: inherit;
		padding: 0.6rem;
		min-height: 44px;
		max-width: 100%;
	}
	textarea {
		width: 100%;
		resize: vertical;
		font:
			0.9rem/1.6 ui-monospace,
			monospace;
	}
	button {
		min-height: 44px;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.pin {
		font-size: 1.3rem;
		padding: 0.2rem 0.7rem;
		flex-shrink: 0;
	}
	.log-tools {
		flex-wrap: wrap;
		margin: 1rem 0;
	}
	.log-tools > label:first-child {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.85rem;
	}
	.log {
		height: clamp(240px, 45vh, 480px);
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--canvas);
	}
	.log-entry {
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.meta {
		display: flex;
		gap: 1rem;
		color: var(--muted);
		font-size: 0.7rem;
	}
	.log-entry.error {
		border-left: 3px solid #b97154;
	}
	.log pre,
	:global(.console-review) pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font:
			0.83rem/1.6 ui-monospace,
			monospace;
		margin: 0.5rem 0;
	}
	.output {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.empty {
		padding: 1rem;
		color: var(--muted);
	}
	.notice {
		background: var(--canvas);
		border-left: 3px solid var(--border-strong);
		padding: 0.8rem;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.review-actions {
		display: flex;
		gap: 0.7rem;
		justify-content: flex-end;
		margin-top: 1rem;
	}
	:global(.console-review) {
		max-width: 36rem;
	}
	a {
		color: var(--accent);
		font-size: 0.85rem;
	}
	@media (max-width: 850px) {
		.console-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.console {
			grid-row: 1;
		}
		.panel {
			padding: 1rem;
		}
		.console-heading {
			flex-wrap: wrap;
		}
	}
</style>
