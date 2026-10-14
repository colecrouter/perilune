import type { JobFile, PrintRun } from './jobs.js';
export const jobSorts = ['name', 'material', 'duration', 'size', 'uploaded'] as const;
export type JobSort = (typeof jobSorts)[number];
export interface JobQuery {
	q: string;
	material: string;
	sort: JobSort;
	direction: 'asc' | 'desc';
	page: number;
	pageSize: number;
}
export function parseJobQuery(params: URLSearchParams): JobQuery {
	const sort = params.get('sort');
	const size = Number(params.get('size'));
	const page = Number(params.get('page'));
	return {
		q: (params.get('q') ?? '').trim().slice(0, 180),
		material: (params.get('material') ?? '').slice(0, 120),
		sort: jobSorts.includes(sort as JobSort) ? (sort as JobSort) : 'uploaded',
		direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
		page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
		pageSize: [10, 25, 50].includes(size) ? size : 25
	};
}
export interface JobCatalog {
	files: JobFile[];
	available: boolean;
	updatedAt: number | null;
	runs: PrintRun[];
	historyAvailable: boolean;
}
export interface JobPage extends Omit<JobCatalog, 'files'> {
	files: JobFile[];
	query: JobQuery;
	total: number;
	matched: number;
	pages: number;
	materials: string[];
	metadataComplete: boolean;
}
/** Runs against the process-owned catalog on the server, including the bounded Moonraker mirror. */
export function queryJobCatalog(catalog: JobCatalog, input: JobQuery): JobPage {
	const metadataComplete = catalog.files.every((file) => file.metadata !== null);
	input = metadataComplete
		? input
		: {
				...input,
				material: '',
				sort: input.sort === 'material' || input.sort === 'duration' ? 'uploaded' : input.sort
			};
	const filtered = catalog.files.filter(
		(file) =>
			file.name.toLowerCase().includes(input.q.toLowerCase()) &&
			(!input.material || file.metadata?.material === input.material)
	);
	const value = (file: JobFile): string | number | null => {
		switch (input.sort) {
			case 'name':
				return file.name.toLowerCase();
			case 'material':
				return file.metadata?.material?.toLowerCase() ?? null;
			case 'duration':
				return file.metadata?.estimatedSeconds ?? null;
			case 'size':
				return file.size;
			case 'uploaded':
				return file.modified;
		}
	};
	filtered.sort((a, b) => {
		const av = value(a),
			bv = value(b);
		// Missing slicer metadata stays at the end in either direction.
		if (av === null && bv !== null) return 1;
		if (bv === null && av !== null) return -1;
		const order = av === bv ? 0 : av! < bv! ? -1 : 1;
		return order * (input.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
	});
	const pages = Math.max(1, Math.ceil(filtered.length / input.pageSize));
	const query = { ...input, page: Math.min(input.page, pages) };
	return {
		...catalog,
		files: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
		query,
		total: catalog.files.length,
		matched: filtered.length,
		pages,
		metadataComplete,
		materials: [
			...new Set(
				catalog.files.flatMap((file) => (file.metadata?.material ? [file.metadata.material] : []))
			)
		].sort()
	};
}
export function jobQueryString(query: JobQuery, change: Partial<JobQuery> = {}): string {
	const next = { ...query, ...change };
	const params = new URLSearchParams();
	if (next.q) params.set('q', next.q);
	if (next.material) params.set('material', next.material);
	params.set('sort', next.sort);
	params.set('direction', next.direction);
	params.set('page', String(next.page));
	params.set('size', String(next.pageSize));
	return '?' + params.toString();
}
