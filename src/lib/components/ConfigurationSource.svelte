<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { WorkspaceDocument, Location, Problem } from '../editor/config-analysis.js';
	import type { EditorSessions } from '../editor/sessions.js';
	import type { ReferenceCatalogue } from '#lib/domain/klipper-reference.js';
	let {
		value,
		path,
		disabled = false,
		onChange,
		reference = null,
		jump = null,
		workspace = [],
		paths = [],
		onNavigate,
		sessions,
		historyVersion = 0,
		onHistoryLimit,
		onAnalysis
	}: {
		value: string;
		path: string;
		disabled?: boolean;
		onChange: (value: string) => void;
		reference?: ReferenceCatalogue | null;
		jump?: { line: number; token: number } | null;
		workspace?: WorkspaceDocument[];
		paths?: string[];
		onNavigate?: (target: Location) => void;
		sessions?: EditorSessions;
		historyVersion?: number;
		onHistoryLimit?: () => void;
		onAnalysis?: (result: { path: string; text: string; problems: Problem[] }) => void;
	} = $props();
	let host: HTMLDivElement;
	let problems = $state<Problem[]>([]),
		analysedText = $state(''),
		assistanceMessage = $state('');
	const context = () => ({
		documents: [{ path, text: value }, ...workspace.filter((document) => document.path !== path)],
		paths,
		reference,
		onNavigate,
		onProblems: (text: string, next: Problem[]) => {
			if (text === value.replace(/\r\n/g, '\n')) {
				analysedText = text;
				problems = next;
				onAnalysis?.({ path, text, problems: next });
			}
		},
		onMessage: (message: string) => {
			assistanceMessage = message;
		}
	});
	const normalizedValue = $derived(value.replace(/\r\n/g, '\n'));
	let seenHistoryVersion = untrack(() => historyVersion);
	let ready = $state(false),
		failed = $state(false);
	let editor:
		ReturnType<typeof import('../editor/config-editor.js').createConfigEditor> | undefined;
	onMount(() => {
		let disposed = false;
		void import('../editor/config-editor.js')
			.then(({ createConfigEditor }) => {
				if (disposed) return;
				untrack(() => {
					editor = createConfigEditor(
						host,
						value,
						path,
						disabled,
						(next) => onChange(next),
						reference,
						context(),
						sessions,
						onHistoryLimit
					);
				});
				ready = true;
			})
			.catch(() => {
				if (!disposed) failed = true;
			});
		return () => {
			disposed = true;
			editor?.destroy();
		};
	});
	$effect(() => {
		const next = value,
			version = historyVersion;
		if (ready) {
			editor?.setValue(next, version !== seenHistoryVersion);
			seenHistoryVersion = version;
		}
	});
	$effect(() => {
		const locked = disabled;
		if (ready) editor?.setDisabled(locked);
	});
	$effect(() => {
		const next = context();
		if (ready) editor?.setContext(next);
	});
	$effect(() => {
		const next = reference;
		if (ready) editor?.setReference(next);
	});
	$effect(() => {
		const target = jump;
		if (ready && target && editor) {
			const line = editor.view.state.doc.line(
				Math.max(1, Math.min(target.line, editor.view.state.doc.lines))
			);
			editor.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
			editor.view.focus();
			host.scrollIntoView({ block: 'nearest' });
		}
	});
</script>

<p id="config-editor-help" class="help">
	Search with Ctrl/⌘ F. Use Esc, then Tab to leave the editor. Formatting stays yours. Hover a
	property for help, or use Ctrl/⌘ Shift Space. Complete with Ctrl Space; use F12 on a macro command
	or include to find its definition.
</p>
<div class="source" bind:this={host}></div>
{#if /\.(cfg|conf|ini)$/i.test(path) && ready}
	<div class="language-tools">
		<button class="button secondary" {disabled} onclick={() => editor?.complete()}
			>Suggestions</button
		>
		<button
			class="button secondary"
			onclick={() => {
				if (!editor) return;
				editor.findDefinition();
			}}>Find definition at cursor</button
		>
		<p class="help">
			Assistance covers {workspace.length || 1} loaded drafts (up to 32 files and 2 MiB). Open a file
			to add its definitions. It does not validate firmware behavior or include precedence.
		</p>
	</div>
	{#if assistanceMessage}<p class="help" role="status">{assistanceMessage}</p>{/if}
	<details class="problems" open={problems.length > 0}>
		<summary
			>Problems in this file ({analysedText === normalizedValue
				? problems.length
				: 'checking…'})</summary
		>
		{#if analysedText === normalizedValue}
			{#each problems as problem}
				<button
					class="problem"
					onclick={() => {
						if (!editor || analysedText !== normalizedValue) return;
						editor.view.dispatch({
							selection: { anchor: Math.min(problem.from, editor.view.state.doc.length) },
							scrollIntoView: true
						});
						editor.view.focus();
					}}
					><strong>{problem.severity} · line {problem.line}</strong><span>{problem.message}</span
					></button
				>
			{:else}<p class="help">
					No problems found by the supported checks. Klipper remains authoritative.
				</p>{/each}
		{/if}
	</details>
{/if}

{#if !ready}<textarea
		aria-label="Editable configuration source"
		spellcheck="false"
		value={value.replace(/\r\n/g, '\n')}
		disabled={disabled || !failed}
		oninput={(event) => onChange(event.currentTarget.value)}></textarea>
	<p class="help" role="status">
		{failed
			? 'Enhanced editor unavailable. Plain text editing is available.'
			: 'Loading source editor…'}
	</p>{/if}

<style>
	.language-tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.language-tools .help {
		flex: 1;
		min-width: 14rem;
	}
	.problems {
		border: 1px solid var(--border);
		border-radius: 0.65rem;
		margin-top: 1rem;
		padding: 0.75rem;
	}
	.problems summary {
		cursor: pointer;
		min-height: 44px;
		align-content: center;
		font-weight: 600;
	}
	.problem {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		text-align: left;
		width: 100%;
		border: 0;
		border-top: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		padding: 0.75rem;
	}
	.problem span {
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.source {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border-strong);
		border-radius: 0.65rem;
		--code-heading: #5966a0;
		--code-property: #176c68;
		--code-keyword: #80568d;
		--code-number: #96562b;
		--code-string: #4c703c;
		--code-comment: #72766f;
		--code-active: #7d829a0d;
		--code-selection: #a9b1e055;
	}
	:global([data-theme='dark']) .source {
		--code-heading: #c5c7f4;
		--code-property: #83c7c0;
		--code-keyword: #d5a9df;
		--code-number: #e5b68d;
		--code-string: #b4c991;
		--code-comment: #a0a9b6;
		--code-active: #c1c7eb0c;
		--code-selection: #8c95d755;
	}
	@media (prefers-color-scheme: dark) {
		.source {
			--code-heading: #c5c7f4;
			--code-property: #83c7c0;
			--code-keyword: #d5a9df;
			--code-number: #e5b68d;
			--code-string: #b4c991;
			--code-comment: #a0a9b6;
			--code-active: #c1c7eb0c;
			--code-selection: #8c95d755;
		}
	}
	.help {
		font-size: 0.75rem;
		color: var(--muted);
		line-height: 1.6;
		margin: 0.6rem 0;
	}
	textarea {
		width: 100%;
		min-height: 420px;
		background: var(--canvas);
		color: var(--text);
		font: 0.85rem/1.7 monospace;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 0.65rem;
	}
</style>
