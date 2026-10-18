import { expect, it } from 'vite-plus/test';
import { emptyMetadata, type JobFile } from './jobs.js';
import { parseJobQuery, queryJobCatalog, jobQueryString } from './job-query.js';
const files: JobFile[] = Array.from({ length: 31 }, (_, index) => ({
	id: String(index).padStart(2, '0'),
	name: `part-${String(index).padStart(2, '0')}.gcode`,
	size: index,
	modified: index,
	source: 'local',
	metadata: {
		...emptyMetadata(),
		material: index % 2 ? 'PLA' : 'PETG',
		estimatedSeconds: index === 0 ? null : index * 60
	}
}));
const catalog = { files, available: true, updatedAt: 0, runs: [], historyAvailable: true };
it('bounds untrusted query parameters and round-trips links', () => {
	const query = parseJobQuery(
		new URLSearchParams('sort=sql&direction=bad&page=Infinity&size=100000&q=' + 'x'.repeat(200))
	);
	expect(query).toMatchObject({ sort: 'uploaded', direction: 'desc', page: 1, pageSize: 10 });
	expect(query.q).toHaveLength(180);
	expect(parseJobQuery(new URLSearchParams(jobQueryString(query)))).toEqual(query);
});
it('filters the whole catalog before sorting and paginating without mutating it', () => {
	const result = queryJobCatalog(
		catalog,
		parseJobQuery(new URLSearchParams('material=PLA&sort=name&direction=asc&size=10&page=2'))
	);
	expect(result.matched).toBe(15);
	expect(result.files.map((file) => file.id)).toEqual(['21', '23', '25', '27', '29']);
	expect(result.materials).toEqual(['PETG', 'PLA']);
	expect(catalog.files).toEqual(files);
});
it('clamps a page after deletion and keeps missing metadata last in both directions', () => {
	for (const direction of ['asc', 'desc']) {
		const result = queryJobCatalog(
			catalog,
			parseJobQuery(new URLSearchParams(`sort=duration&direction=${direction}&size=50&page=999`))
		);
		expect(result.query.page).toBe(1);
		expect(result.files.at(-1)?.id).toBe('00');
	}
	const result = queryJobCatalog(
		catalog,
		parseJobQuery(new URLSearchParams('q=DOES-NOT-EXIST&page=2'))
	);
	expect(result).toMatchObject({ matched: 0, pages: 1, files: [], query: { page: 1 } });
});
it('uses a deterministic id tie-breaker across repeated requests', () => {
	const tied = { ...catalog, files: files.map((file) => ({ ...file, size: 1 })) };
	const first = queryJobCatalog(tied, parseJobQuery(new URLSearchParams('sort=size&size=10')));
	const second = queryJobCatalog({ ...tied, files: [...tied.files].reverse() }, first.query);
	expect(second.files).toEqual(first.files);
});

it('does not silently filter uninspected live files by incomplete metadata', () => {
	const incomplete = {
		...catalog,
		files: files.map((file, index) => (index === 0 ? { ...file, metadata: null } : file))
	};
	const result = queryJobCatalog(
		incomplete,
		parseJobQuery(new URLSearchParams('material=PLA&sort=duration'))
	);
	expect(result).toMatchObject({
		metadataComplete: false,
		matched: 31,
		query: { material: '', sort: 'uploaded' }
	});
});
