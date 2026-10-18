<script lang="ts">
	import {
		createTable,
		tableFeatures,
		columnVisibilityFeature,
		rowPaginationFeature
	} from '@tanstack/svelte-table';
	import { preferencesContext } from '#lib/client/preferences.svelte.js';
	import { resolve } from '$app/paths';
	import Icon from './Icon.svelte';
	import { durationLabel, type JobFile } from '#lib/domain/jobs.js';
	import { jobQueryString, type JobPage, type JobSort } from '#lib/domain/job-query.js';
	let { catalog, selectedId }: { catalog: JobPage; selectedId?: string } = $props();
	const labels: Record<JobSort, string> = {
		name: 'File',
		material: 'Material',
		duration: 'Est. time',
		size: 'Size',
		uploaded: 'Uploaded'
	};
	const columns = [
		{ id: 'name', accessorFn: (file: JobFile) => file.name, enableHiding: false },
		{ id: 'material', accessorFn: (file: JobFile) => file.metadata?.material },
		{ id: 'duration', accessorFn: (file: JobFile) => file.metadata?.estimatedSeconds },
		{ id: 'size', accessorFn: (file: JobFile) => file.size },
		{ id: 'uploaded', accessorFn: (file: JobFile) => file.modified }
	];
	const preferences = preferencesContext();
	let visibility = $state<Record<string, boolean>>({});
	const currentVisibility = () =>
		preferences
			? {
					material: preferences.values.jobsMaterial,
					duration: preferences.values.jobsDuration,
					size: preferences.values.jobsSize,
					uploaded: preferences.values.jobsUploaded
				}
			: visibility;
	const table = createTable({
		features: tableFeatures({ columnVisibilityFeature, rowPaginationFeature }),
		columns,
		get data() {
			return catalog.files;
		},
		get rowCount() {
			return catalog.matched;
		},
		getRowId: (file) => file.id,
		manualPagination: true,
		onColumnVisibilityChange: (updater) => {
			const before = currentVisibility();
			const next = typeof updater === 'function' ? updater(before) : updater;
			visibility = next;
			const fields = {
				material: 'jobsMaterial',
				duration: 'jobsDuration',
				size: 'jobsSize',
				uploaded: 'jobsUploaded'
			} as const;
			const patch: Partial<Record<(typeof fields)[keyof typeof fields], boolean>> = {};
			for (const [column, field] of Object.entries(fields)) {
				if ((before[column as keyof typeof before] !== false) !== (next[column] !== false))
					patch[field] = next[column] !== false;
			}
			if (Object.keys(patch).length) preferences?.update(patch);
		},
		state: {
			get columnVisibility() {
				return currentVisibility();
			},
			get pagination() {
				return { pageIndex: catalog.query.page - 1, pageSize: catalog.query.pageSize };
			}
		}
	});
	const href = (change: Partial<JobPage['query']>) =>
		resolve('/jobs') + jobQueryString(catalog.query, change);
	const thumbnail = (file: JobFile) =>
		file.metadata?.thumbnail?.startsWith('/api/')
			? resolve('/api/jobs/[operation]', { operation: 'thumbnail' }) +
				'?id=' +
				encodeURIComponent(file.id)
			: file.metadata?.thumbnail;
	const sortable = (id: string) =>
		catalog.metadataComplete || !['material', 'duration'].includes(id);
	const fileHref = (id: string) => resolve('/jobs/[id]', { id }) + jobQueryString(catalog.query);
	const sortHref = (sort: JobSort) =>
		href({
			sort,
			direction: catalog.query.sort === sort && catalog.query.direction === 'asc' ? 'desc' : 'asc',
			page: 1
		});
	function value(file: JobFile, column: string) {
		if (column === 'material') return file.metadata?.material ?? 'Not reported';
		if (column === 'duration') return durationLabel(file.metadata?.estimatedSeconds ?? null);
		if (column === 'size')
			return file.size >= 1024 * 1024
				? `${(file.size / 1024 / 1024).toFixed(1)} MiB`
				: `${Math.max(1, Math.round(file.size / 1024))} KiB`;
		return new Date(file.modified).toLocaleDateString('en-CA', { timeZone: 'UTC' });
	}
</script>

<div class="table-tools">
	<span class="muted" role="status"
		>{catalog.matched}
		{catalog.matched === 1 ? 'match' : 'matches'}{catalog.query.q || catalog.query.material
			? ` of ${catalog.total} files`
			: ''}</span
	>
	<details class="columns">
		<summary>Columns</summary>
		<div class="column-options">
			{#each table.getAllLeafColumns().filter((column) => column.getCanHide()) as column}<label
					><input
						type="checkbox"
						checked={column.getIsVisible()}
						onchange={() => column.toggleVisibility()}
					/>{labels[column.id as JobSort]}</label
				>{/each}
		</div>
	</details>
</div>
<div class="desktop-table">
	<table>
		<caption class="sr-only">G-code file library</caption>
		<thead
			>{#each table.getHeaderGroups() as group}<tr
					>{#each group.headers as header}<th
							scope="col"
							aria-sort={catalog.query.sort === header.column.id
								? catalog.query.direction === 'asc'
									? 'ascending'
									: 'descending'
								: 'none'}
							>{#if sortable(header.column.id)}<a
									data-sveltekit-reset="false"
									href={sortHref(header.column.id as JobSort)}
									>{labels[
										header.column.id as JobSort
									]}{#if catalog.query.sort === header.column.id}<span aria-hidden="true"
											>{catalog.query.direction === 'asc' ? '↑' : '↓'}</span
										>{/if}</a
								>{:else}<span class="unsortable">{labels[header.column.id as JobSort]}</span
								>{/if}</th
						>{/each}</tr
				>{/each}</thead
		>
		<tbody
			>{#each table.getRowModel().rows as row (row.id)}<tr class:selected={row.id === selectedId}
					>{#each row.getVisibleCells() as cell}<td
							>{#if cell.column.id === 'name'}<a
									class="file-link"
									data-sveltekit-reset="false"
									href={fileHref(row.id)}
									aria-current={row.id === selectedId ? 'page' : undefined}
									><span class="mini-preview"
										>{#if row.original.metadata?.thumbnail}<img
												src={thumbnail(row.original)}
												alt=""
												loading="lazy"
											/>{:else}<Icon name="jobs" size={20} />{/if}</span
									><span class="filename" title={row.original.name}>{row.original.name}</span></a
								>{:else}{value(row.original, cell.column.id)}{/if}</td
						>{/each}</tr
				>{/each}</tbody
		>
	</table>
</div>
<div class="mobile-files">
	<form method="GET" action={resolve('/jobs')} class="mobile-sort" data-sveltekit-reset="false">
		<input type="hidden" name="q" value={catalog.query.q} /><input
			type="hidden"
			name="material"
			value={catalog.query.material}
		/><input type="hidden" name="size" value={catalog.query.pageSize} />
		<label
			>Sort files<select name="sort" value={catalog.query.sort}
				>{#each Object.entries(labels) as [key, label]}<option value={key} disabled={!sortable(key)}
						>{label}</option
					>{/each}</select
			></label
		>
		<label
			>Order<select name="direction" value={catalog.query.direction}
				><option value="asc">Ascending</option><option value="desc">Descending</option></select
			></label
		><button class="button secondary" type="submit">Apply</button>
	</form>
	{#each catalog.files as file (file.id)}<a
			class="mobile-file"
			class:selected={file.id === selectedId}
			href={fileHref(file.id)}
			aria-current={file.id === selectedId ? 'page' : undefined}
			><span class="mini-preview"
				>{#if file.metadata?.thumbnail}<img
						src={thumbnail(file)}
						alt=""
						loading="lazy"
					/>{:else}<Icon name="jobs" size={22} />{/if}</span
			><span
				><strong title={file.name}>{file.name}</strong><small
					>{file.metadata?.material ?? 'Material not reported'} · {durationLabel(
						file.metadata?.estimatedSeconds ?? null
					)}<br />{value(file, 'size')} · {value(file, 'uploaded')}</small
				></span
			><span aria-hidden="true">↗</span></a
		>{/each}
</div>
{#if !catalog.files.length}<div class="empty">
		<Icon name="jobs" size={36} />
		<h3>
			{catalog.query.q || catalog.query.material ? 'No matching files' : 'Room for your next idea'}
		</h3>
		<p class="muted">
			{catalog.query.q || catalog.query.material
				? 'Try another filename or material.'
				: 'Upload a sliced G-code file to see its details here.'}
		</p>
		{#if catalog.query.q || catalog.query.material}<a
				data-sveltekit-reset="false"
				href={href({ q: '', material: '', page: 1 })}>Clear filters</a
			>{/if}
	</div>{/if}
<nav class="pagination" aria-label="Library pages">
	{#if table.getCanPreviousPage()}<a
			class="button secondary"
			data-sveltekit-reset="false"
			href={href({ page: catalog.query.page - 1 })}>Previous</a
		>{:else}<span class="button secondary disabled" aria-disabled="true">Previous</span>{/if}
	<span>Page {catalog.query.page} of {catalog.pages}</span>
	{#if table.getCanNextPage()}<a
			class="button secondary"
			data-sveltekit-reset="false"
			href={href({ page: catalog.query.page + 1 })}>Next</a
		>{:else}<span class="button secondary disabled" aria-disabled="true">Next</span>{/if}
</nav>
<div class="page-sizes">
	<span>Rows per page</span>{#each [10, 25, 50] as size}<a
			data-sveltekit-reset="false"
			href={href({ pageSize: size, page: 1 })}
			onclick={() => preferences?.update({ jobsPageSize: size as 10 | 25 | 50 })}
			aria-current={catalog.query.pageSize === size ? 'true' : undefined}>{size}</a
		>{/each}
</div>

<style>
	.table-tools {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin: 1.25rem 0 0.75rem;
		font-size: 0.8rem;
	}
	.columns {
		position: relative;
	}
	summary {
		cursor: pointer;
		color: var(--accent);
	}
	.column-options {
		position: absolute;
		right: 0;
		top: 1.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.8rem;
		box-shadow: 0 8px 24px #0002;
		z-index: 2;
		min-width: 140px;
	}
	.column-options label {
		display: flex;
		gap: 0.6rem;
		padding: 0.35rem;
	}
	.desktop-table {
		width: 100%;
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.8rem;
	}
	th {
		text-align: left;
		font-weight: 500;
		background: var(--surface);
		white-space: nowrap;
	}
	.unsortable {
		display: block;
		padding: 0.8rem 0.6rem;
		color: var(--muted);
	}
	th a {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		color: var(--muted);
		padding: 0.8rem 0.6rem;
		text-decoration: none;
	}
	td {
		border-bottom: 1px solid var(--border);
		padding: 0.35rem 0.6rem;
	}
	td:not(:first-child) {
		white-space: nowrap;
		color: var(--muted);
	}
	.selected {
		background: var(--surface);
		box-shadow: inset 3px 0 var(--accent);
	}
	.file-link {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		color: var(--text);
		text-decoration: none;
		min-width: 150px;
		max-width: 320px;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.filename {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file-link:hover,
	.mobile-file:hover strong {
		color: var(--accent);
	}
	.mini-preview {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: var(--surface);
		color: var(--accent);
		flex-shrink: 0;
	}
	.mini-preview img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.mobile-files {
		display: none;
	}
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 1.1rem;
		font-size: 0.8rem;
	}
	.pagination .button {
		padding: 0.55rem 0.7rem;
		font-size: 0.8rem;
	}
	.disabled {
		opacity: 0.45;
	}
	.page-sizes {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		font-size: 0.75rem;
		margin-top: 0.9rem;
		color: var(--muted);
	}
	.page-sizes a {
		color: var(--accent);
		padding: 0.3rem;
	}
	.page-sizes a[aria-current] {
		background: var(--surface);
		border-radius: 5px;
		font-weight: 700;
	}
	.empty {
		text-align: center;
		padding: 2.5rem 1rem;
		color: var(--muted);
	}
	.empty h3 {
		margin: 1rem 0 0.5rem;
		color: var(--text);
	}
	.empty a {
		color: var(--accent);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	@media (max-width: 700px) {
		.desktop-table,
		.columns {
			display: none;
		}
		.mobile-files {
			display: block;
		}
		.mobile-sort {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			margin-bottom: 0.5rem;
		}
		.mobile-sort .button {
			padding: 0.5rem;
			font-size: 0.8rem;
		}
		.mobile-files label {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			font-size: 0.8rem;
			color: var(--muted);
		}
		select {
			min-width: 0;
			flex: 1;
			padding: 0.5rem;
			background: var(--surface);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 7px;
		}
		.mobile-file {
			display: flex;
			align-items: center;
			gap: 0.7rem;
			padding: 0.55rem 0.5rem;
			color: var(--text);
			text-decoration: none;
			border-bottom: 1px solid var(--border);
			border-radius: 7px;
		}
		.mobile-file > span:nth-child(2) {
			flex: 1;
			min-width: 0;
		}
		strong {
			display: block;
			overflow: hidden;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow-wrap: anywhere;
			font-size: 0.9rem;
		}
		small {
			display: block;
			color: var(--muted);
			font-size: 0.75rem;
			line-height: 1.6;
			margin-top: 0.3rem;
		}
	}
</style>
