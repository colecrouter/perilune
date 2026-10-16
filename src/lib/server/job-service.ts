import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Context, Data, Effect, Layer, Schedule, Semaphore, Stream } from 'effect';
import * as SubscriptionRef from 'effect/SubscriptionRef';
import { SqlClient } from 'effect/sql/SqlClient';
import {
	MAX_GCODE_BYTES,
	emptyMetadata,
	parseGcode,
	safeRelativePath,
	validGcodeName,
	type JobFile,
	type JobMetadata,
	type PrintRun
} from '#lib/domain/jobs.js';
import { PrinterService } from './printer-service.js';
import { migrate } from './migrations.js';
import { printerAdmission, printerInterlock } from './printer-admission.js';
import { startReason } from '#lib/domain/jobs.js';

export class JobError extends Data.TaggedError('JobError')<{ message: string }> {}
export interface KeySummary {
	id: string;
	name: string;
	suffix: string;
	created: number;
	expires: number;
	canPrint: boolean;
}
export class JobsConfig extends Context.Service<
	JobsConfig,
	{
		moonrakerUrl: string;
		apiKey?: string;
		liveFiles?: boolean;
		checkUser: (id: string, epoch: number) => boolean;
		checkPrintKey?: (id: string, owner: string, epoch: number) => boolean;
	}
>()('perilune/JobsConfig') {}
export class JobService extends Context.Service<
	JobService,
	{
		state: SubscriptionRef.SubscriptionRef<{
			files: JobFile[];
			available: boolean;
			updatedAt: number | null;
			runs: PrintRun[];
			historyAvailable: boolean;
		}>;
		upload: (
			name: string,
			bytes: Uint8Array,
			authorized?: Effect.Effect<boolean, JobError>
		) => Effect.Effect<JobFile, JobError>;
		refresh?: Effect.Effect<void, JobError>;
		inspect: (id: string) => Effect.Effect<JobFile, JobError>;
		remove: (
			id: string,
			authorized?: Effect.Effect<boolean, JobError>
		) => Effect.Effect<void, JobError>;
		thumbnail: (id: string) => Effect.Effect<Uint8Array, JobError>;
		keys: (owner: string) => Effect.Effect<KeySummary[], JobError>;
		issueKey: (
			owner: string,
			epoch: number,
			name: string,
			canPrint?: boolean
		) => Effect.Effect<{ token: string; key: KeySummary }, JobError>;
		revokeKey: (owner: string, id: string) => Effect.Effect<void, JobError>;
		printKey: (
			token: string
		) => Effect.Effect<
			{ id: string; owner: string; canPrint: boolean; authorized: () => boolean } | null,
			JobError
		>;
		validateKey: (token: string) => Effect.Effect<boolean, JobError>;
		beginUpload: Effect.Effect<() => void, JobError>;
		readBody: (
			request: Request,
			signal: AbortSignal,
			maximum?: number
		) => Effect.Effect<Uint8Array, JobError>;
	}
>()('perilune/JobService') {}
const failure = (message: string) => new JobError({ message });
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const number = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown): string | null =>
	typeof value === 'string' ? value.slice(0, 120) : null;
export function checkedPng(bytes: Uint8Array): Uint8Array {
	const data = Buffer.from(bytes);
	if (
		data.length < 24 ||
		data.length > 256 * 1024 ||
		data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
		data.toString('ascii', 12, 16) !== 'IHDR' ||
		data.readUInt32BE(16) > 2048 ||
		data.readUInt32BE(20) > 2048 ||
		data.readUInt32BE(16) === 0 ||
		data.readUInt32BE(20) === 0
	)
		throw failure('Thumbnail is not a supported PNG.');
	return bytes;
}
async function boundedBody(
	response: Response | Request,
	maximum: number,
	signal: AbortSignal
): Promise<Uint8Array> {
	if (Number(response.headers.get('content-length') ?? 0) > maximum)
		throw failure('File exceeds the upload or response limit.');
	const reader = response.body?.getReader();
	if (!reader) throw failure('The request has no file content.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	const abort = () => {
		void reader.cancel();
	};
	signal.addEventListener('abort', abort, { once: true });
	try {
		while (!signal.aborted) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > maximum) throw failure('File exceeds the upload or response limit.');
			chunks.push(part.value);
		}
		if (signal.aborted) throw failure('Transfer interrupted. Retry the upload if needed.');
		return Buffer.concat(chunks, size);
	} finally {
		signal.removeEventListener('abort', abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
interface FileRow {
	id: string;
	name: string;
	size: number;
	modified: number;
	metadata: string;
	hash: string;
	content: Uint8Array;
}
const fromRow = (row: Omit<FileRow, 'content'>): JobFile => ({
	id: row.id,
	name: row.name,
	size: row.size,
	modified: row.modified,
	source: 'local',
	metadata: (() => {
		const metadata = JSON.parse(row.metadata) as JobMetadata;
		return {
			...metadata,
			thumbnail: metadata.thumbnail ? `/api/jobs/thumbnail?id=${row.id}` : null
		};
	})()
});
export const JobServiceLive = Layer.effect(
	JobService,
	Effect.gen(function* () {
		const config = yield* JobsConfig;
		const sql = yield* SqlClient;
		const printer = yield* PrinterService;
		yield* migrate;
		const live = Boolean(config.moonrakerUrl);
		const state = yield* SubscriptionRef.make<{
			files: JobFile[];
			available: boolean;
			updatedAt: number | null;
			runs: PrintRun[];
			historyAvailable: boolean;
		}>({ files: [], available: !live, updatedAt: null, runs: [], historyAvailable: true });
		const lock = yield* Semaphore.make(1);
		const transfers = yield* Semaphore.make(2);
		let activeUploads = 0;
		const controllers = new Set<AbortController>();
		const metadataCache = new Map<string, JobFile>();
		const thumbnailPaths = new Map<string, string>();
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (const controller of controllers) controller.abort();
			})
		);
		let base: URL | undefined;
		if (live) {
			base = new URL(config.moonrakerUrl);
			base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
			base.pathname = '/';
		}
		const upstream = (path: string, maximum = 2 * 1024 * 1024) =>
			Effect.tryPromise({
				try: async (signal) => {
					const controller = new AbortController();
					controllers.add(controller);
					const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(8000)]);
					try {
						const response = await fetch(new URL(path, base!), {
							signal: combined,
							redirect: 'error',
							headers: config.apiKey ? { 'X-Api-Key': config.apiKey } : {}
						});
						if (!response.ok) throw failure('Moonraker file information is unavailable.');
						return await boundedBody(response, maximum, combined);
					} finally {
						controllers.delete(controller);
						controller.abort();
					}
				},
				catch: () => failure('Moonraker file information is unavailable. Retry when connected.')
			});
		const refreshRuns = Effect.gen(function* () {
			const rows = yield* sql<{
				id: string;
				filename: string;
				started: number;
				ended: number | null;
				state: string;
				progress: number | null;
			}>`SELECT * FROM print_runs ORDER BY started DESC LIMIT 50`;
			yield* SubscriptionRef.update(state, (s) => ({
				...s,
				runs: [...rows],
				historyAvailable: true
			}));
		});
		const loadFiles = Effect.gen(function* () {
			let files: JobFile[];
			if (live) {
				const bytes = yield* upstream('/server/files/list?root=gcodes');
				const body = yield* Effect.try({
					try: () => JSON.parse(new TextDecoder().decode(bytes)) as { result: unknown },
					catch: () => failure('Invalid file list from Moonraker.')
				});
				if (!Array.isArray(body.result))
					return yield* Effect.fail(failure('Invalid file list from Moonraker.'));
				files = body.result.slice(0, 500).flatMap((item: unknown) => {
					if (!item || typeof item !== 'object') return [];
					const row = item as Record<string, unknown>;
					if (
						typeof row.path !== 'string' ||
						!safeRelativePath(row.path) ||
						!/\.gcode$/i.test(row.path)
					)
						return [];
					const modified = (number(row.modified) ?? 0) * 1000;
					const size = number(row.size) ?? 0;
					const id = digest(`${row.path}:${modified}:${size}`);
					return [
						{
							id,
							name: row.path,
							size,
							modified,
							source: 'moonraker' as const,
							metadata: metadataCache.get(id)?.metadata ?? null
						}
					];
				});
				const ids = new Set(files.map((f) => f.id));
				for (const id of metadataCache.keys())
					if (!ids.has(id)) {
						metadataCache.delete(id);
						thumbnailPaths.delete(id);
					}
			} else {
				const rows = yield* sql<
					Omit<FileRow, 'content'>
				>`SELECT id,name,size,modified,hash,metadata FROM job_files ORDER BY modified DESC`;
				files = rows.map(fromRow);
			}
			yield* SubscriptionRef.update(state, (s) => ({
				...s,
				files,
				available: true,
				updatedAt: Date.now()
			}));
		});
		const refresh = lock.withPermits(1)(loadFiles);
		yield* sql`UPDATE print_runs SET state = 'interrupted', ended = ${Date.now()} WHERE ended IS NULL`;
		yield* refreshRuns;
		if (!live) yield* refresh;
		if (live)
			yield* refresh.pipe(
				Effect.catch(() => SubscriptionRef.update(state, (s) => ({ ...s, available: false }))),
				Effect.repeat(Schedule.spaced('30 seconds')),
				Effect.forkScoped
			);
		let runId: string | null = null;
		let lastFilename = '';
		let lastStatus = '';
		let lastWrite = 0;
		yield* SubscriptionRef.changes(printer.state).pipe(
			Stream.runForEach((snapshot) =>
				Effect.gen(function* () {
					const active = snapshot.job.state === 'printing' || snapshot.job.state === 'paused';
					const ready = snapshot.connection === 'connected' && snapshot.klippy === 'ready';
					if (
						runId &&
						((live && !ready) || (ready && active && lastFilename !== snapshot.job.filename))
					) {
						yield* sql`UPDATE print_runs SET state='interrupted', ended=${Date.now()} WHERE id=${runId}`;
						runId = null;
						yield* refreshRuns;
					}
					if (!runId && ready && active && snapshot.job.filename) {
						const id = snapshot.job.runId ?? randomUUID();
						yield* sql`INSERT OR IGNORE INTO print_runs (id,filename,started,state,progress) VALUES (${id},${snapshot.job.filename},${Date.now()},${snapshot.job.state},${snapshot.job.progress})`;
						runId = id;
						lastStatus = '';
						lastFilename = snapshot.job.filename;
						yield* sql`DELETE FROM print_runs WHERE ended IS NOT NULL AND id NOT IN (SELECT id FROM print_runs ORDER BY started DESC LIMIT 500)`;
					}
					if (!runId) return;
					const status = ready ? snapshot.job.state : 'disconnected';
					if (status !== lastStatus || Date.now() - lastWrite >= 5000) {
						const ended = ready && !active && snapshot.job.state !== 'unknown' ? Date.now() : null;
						yield* sql`UPDATE print_runs SET state=${status}, progress=${snapshot.job.progress}, ended=${ended} WHERE id=${runId}`;
						if (ended) runId = null;
						lastStatus = status;
						lastWrite = Date.now();
						yield* refreshRuns;
					}
				}).pipe(
					Effect.catchCause(() =>
						SubscriptionRef.update(state, (s) => ({ ...s, historyAvailable: false }))
					)
				)
			),
			Effect.forkScoped
		);
		let operations = 0;
		const mapErrors = <A, E>(effect: Effect.Effect<A, E>) =>
			Effect.acquireUseRelease(
				Effect.suspend(() => {
					if (operations >= 20)
						return Effect.fail(failure('Job service is busy. Try again shortly.'));
					operations++;
					return Effect.void;
				}),
				() => effect,
				() =>
					Effect.sync(() => {
						operations--;
					})
			).pipe(
				Effect.mapError((cause) =>
					cause instanceof JobError ? cause : failure('Job storage is unavailable.')
				)
			);
		const admission = printerAdmission(printer.state);
		const interlock = printerInterlock(printer.state);
		const mutationLock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			live ? admission.withPermits(1)(lock.withPermits(1)(effect)) : lock.withPermits(1)(effect);
		const fileRequest = (path: string, init: RequestInit = {}, maximum = 256 * 1024) =>
			Effect.tryPromise({
				try: async (signal) => {
					const combined = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
					const response = await fetch(new URL(path, base!), {
						...init,
						redirect: 'error',
						signal: combined,
						headers: { ...init.headers, ...(config.apiKey ? { 'X-Api-Key': config.apiKey } : {}) }
					});
					if (!response.ok)
						throw failure(
							'Moonraker refused the file operation. Refresh the library before trying again.'
						);
					return boundedBody(response, maximum, combined);
				},
				catch: () =>
					failure(
						'File operation outcome is uncertain. Refresh the library; no operation was automatically repeated.'
					)
			});
		const readyForFiles = (authorized: Effect.Effect<boolean, JobError>) =>
			Effect.gen(function* () {
				if (!config.liveFiles)
					return yield* Effect.fail(failure('Live files are read-only on this server.'));
				const snapshot = yield* SubscriptionRef.get(printer.state);
				const reason = startReason(snapshot);
				if (reason || interlock.halted)
					return yield* Effect.fail(failure(reason ?? 'Emergency interlock is active.'));
				if (!(yield* authorized))
					return yield* Effect.fail(failure('File operation authorization ended.'));
				return interlock.epoch;
			});
		const checkedFile = (name: string) =>
			Effect.gen(function* () {
				yield* loadFiles;
				return (yield* SubscriptionRef.get(state)).files.find((file) => file.name === name);
			});
		const contentMatches = (file: JobFile, hash: string) =>
			Effect.gen(function* () {
				if (file.size > MAX_GCODE_BYTES) return false;
				const content = yield* fileRequest(
					`/server/files/gcodes/${file.name.split('/').map(encodeURIComponent).join('/')}`,
					{},
					MAX_GCODE_BYTES
				);
				return digest(content) === hash;
			});
		const uploadLive = (
			name: string,
			bytes: Uint8Array,
			authorized: Effect.Effect<boolean, JobError>
		) =>
			Effect.gen(function* () {
				const epoch = yield* readyForFiles(authorized);
				const hash = digest(bytes);
				// Content-addressed names isolate different uploads without overwriting the owner's existing files.
				const destination = `${name.slice(0, -6).slice(0, 100)}--${hash}.gcode`;
				const key = digest(`${config.moonrakerUrl}:upload:${destination}`);
				const existing = yield* checkedFile(destination);
				if (existing) {
					if (yield* contentMatches(existing, hash)) return existing;
					return yield* Effect.fail(
						failure(
							'The upload destination contains different content. Rename the file and investigate the external change.'
						)
					);
				}
				const [prior] = yield* sql<{
					status: string;
				}>`SELECT status FROM file_mutations WHERE id=${key}`;
				if (prior)
					return yield* Effect.fail(
						failure(
							'A previous upload used this destination. Its outcome is not replayed. Rename the file for a deliberate new upload.'
						)
					);
				if ((yield* SubscriptionRef.get(state)).files.length >= 500)
					return yield* Effect.fail(
						failure('The live library has reached the 500-file browsing limit.')
					);
				const form = new FormData();
				form.set('root', 'gcodes');
				form.set('print', 'false');
				form.set('file', new Blob([Buffer.from(bytes)]), destination);
				yield* readyForFiles(authorized);
				yield* sql`INSERT INTO file_mutations(id,status) VALUES(${key},'unknown')`;
				if (!interlock.allows(epoch)) {
					yield* sql`DELETE FROM file_mutations WHERE id=${key}`;
					return yield* Effect.fail(
						failure('File operation authorization or safety state changed.')
					);
				}
				yield* fileRequest('/server/files/upload', { method: 'POST', body: form });
				const result = yield* checkedFile(destination);
				if (!result || !(yield* contentMatches(result, hash)))
					return yield* Effect.fail(
						failure(
							'Upload could not be verified. Refresh the library before taking another action.'
						)
					);
				yield* sql`UPDATE file_mutations SET status='verified' WHERE id=${key}`;
				return result;
			});
		const removeLive = (id: string, authorized: Effect.Effect<boolean, JobError>) =>
			Effect.gen(function* () {
				const epoch = yield* readyForFiles(authorized);
				const expected = (yield* SubscriptionRef.get(state)).files.find((file) => file.id === id);
				if (!expected)
					return yield* Effect.fail(failure('Refresh the library before removing this file.'));
				const fresh = yield* checkedFile(expected.name);
				if (!fresh || fresh.id !== id)
					return yield* Effect.fail(
						failure('The file changed or disappeared. Review the refreshed library.')
					);
				const key = digest(`${config.moonrakerUrl}:delete:${id}`);
				const [prior] = yield* sql`SELECT id FROM file_mutations WHERE id=${key}`;
				if (prior)
					return yield* Effect.fail(
						failure(
							'This deletion was already submitted. Refresh the library; it will not be replayed.'
						)
					);
				yield* readyForFiles(authorized);
				yield* sql`INSERT INTO file_mutations(id,status) VALUES(${key},'unknown')`;
				if (!interlock.allows(epoch)) return yield* Effect.fail(failure('Safety state changed.'));
				yield* fileRequest(
					`/server/files/gcodes/${fresh.name.split('/').map(encodeURIComponent).join('/')}`,
					{ method: 'DELETE' }
				);
				if (yield* checkedFile(fresh.name))
					return yield* Effect.fail(failure('Deletion was not verified. Refresh the library.'));
				yield* sql`UPDATE file_mutations SET status='verified' WHERE id=${key}`;
			});

		return {
			state,
			beginUpload: Effect.suspend(() => {
				if (activeUploads >= 2)
					return Effect.fail(failure('Two uploads are already in progress. Try again shortly.'));
				activeUploads++;
				let released = false;
				return Effect.succeed(() => {
					if (!released) {
						released = true;
						activeUploads--;
					}
				});
			}),
			readBody: (request, signal, maximum = MAX_GCODE_BYTES + 64 * 1024) =>
				mapErrors(
					transfers.withPermits(1)(
						Effect.tryPromise({
							try: () =>
								boundedBody(
									request,
									maximum,
									AbortSignal.any([signal, AbortSignal.timeout(60_000)])
								),
							catch: (cause) => (cause instanceof JobError ? cause : failure('Upload interrupted.'))
						})
					)
				),
			upload: (name, bytes, authorized = Effect.succeed(true)) =>
				mapErrors(
					mutationLock(
						Effect.gen(function* () {
							if (!validGcodeName(name) || bytes.length === 0 || bytes.length > MAX_GCODE_BYTES)
								return yield* Effect.fail(
									failure('Use a .gcode filename without folders, up to 20 MiB.')
								);
							const metadata = yield* Effect.try({
								try: () => parseGcode(bytes),
								catch: () =>
									failure(
										'Choose a valid UTF-8 text G-code file. Binary G-code and 3MF are not supported yet.'
									)
							});
							if (live) {
								if (
									!safeRelativePath(name) ||
									Buffer.byteLength(name.slice(0, -6).slice(0, 100)) > 180
								)
									return yield* Effect.fail(failure('Use a filename without URL delimiters.'));
								return yield* uploadLive(name, bytes, authorized);
							}
							if (metadata.thumbnail) {
								try {
									checkedPng(Buffer.from(metadata.thumbnail.split(',')[1]!, 'base64'));
								} catch {
									metadata.thumbnail = null;
								}
							}
							if (!(yield* authorized))
								return yield* Effect.fail(failure('Upload authorization ended.'));
							const hash = digest(bytes);
							const existing = yield* sql<
								Omit<FileRow, 'content'>
							>`SELECT id,name,size,modified,hash,metadata FROM job_files WHERE name=${name}`;
							if (existing[0]) {
								if (existing[0].hash === hash) return fromRow(existing[0]);
								return yield* Effect.fail(
									failure('A different file already has this name. Rename it before uploading.')
								);
							}
							const usage = yield* sql<{
								count: number;
								bytes: number;
							}>`SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM job_files`;
							if (usage[0]!.count >= 100 || usage[0]!.bytes + bytes.length > 200 * 1024 * 1024)
								return yield* Effect.fail(
									failure('Library limit reached (100 files / 200 MiB). Remove unused files first.')
								);
							const file: JobFile = {
								id: randomUUID(),
								name,
								size: bytes.length,
								modified: Date.now(),
								source: 'local',
								metadata: { ...metadata, thumbnail: metadata.thumbnail ? '' : null }
							};
							if (metadata.thumbnail)
								file.metadata!.thumbnail = `/api/jobs/thumbnail?id=${file.id}`;
							// Once committed, publish even if the HTTP caller disconnects.
							yield* Effect.gen(function* () {
								if (!(yield* authorized))
									return yield* Effect.fail(failure('Upload authorization ended.'));
								yield* sql`INSERT INTO job_files (id,name,size,modified,hash,metadata,content) VALUES (${file.id},${name},${file.size},${file.modified},${hash},${JSON.stringify(metadata)},${bytes})`;
								yield* SubscriptionRef.update(state, (s) => ({
									...s,
									files: [file, ...s.files],
									updatedAt: Date.now()
								}));
							}).pipe(Effect.uninterruptible);
							return file;
						})
					)
				),
			refresh: mapErrors(refresh),
			inspect: (id) =>
				mapErrors(
					lock.withPermits(1)(
						Effect.gen(function* () {
							const current = yield* SubscriptionRef.get(state);
							const file = current.files.find((f) => f.id === id);
							if (!file)
								return yield* Effect.fail(failure('This file is no longer in the library.'));
							if (!live) return file;
							const cached = metadataCache.get(id);
							if (cached) return cached;
							const bytes = yield* upstream(
								`/server/files/metadata?filename=${encodeURIComponent(file.name)}`,
								512 * 1024
							);
							const body = yield* Effect.try({
								try: () =>
									JSON.parse(new TextDecoder().decode(bytes)) as {
										result: Record<string, unknown>;
									},
								catch: () => failure('File metadata is unavailable.')
							});
							const m = body.result;
							if (!m || typeof m !== 'object')
								return yield* Effect.fail(failure('File metadata is unavailable.'));
							const metadata: JobMetadata = {
								...emptyMetadata(),
								slicer: text(m.slicer),
								material: text(m.filament_type),
								estimatedSeconds: number(m.estimated_time),
								layerHeight: number(m.layer_height),
								layers: number(m.layer_count),
								filamentGrams: number(m.filament_weight_total)
							};
							if (Array.isArray(m.thumbnails)) {
								const thumb = m.thumbnails.find(
									(t: Record<string, unknown>) =>
										typeof t.relative_path === 'string' &&
										safeRelativePath(t.relative_path) &&
										t.relative_path.endsWith('.png')
								);
								if (thumb) {
									const path = posix.join(posix.dirname(file.name), thumb.relative_path as string);
									if (safeRelativePath(path)) {
										thumbnailPaths.set(id, path);
										metadata.thumbnail = `/api/jobs/thumbnail?id=${id}`;
									}
								}
							}
							const inspected = { ...file, metadata };
							metadataCache.set(id, inspected);
							yield* SubscriptionRef.update(state, (s) => ({
								...s,
								files: s.files.map((f) => (f.id === id ? inspected : f))
							}));
							return inspected;
						})
					)
				),
			thumbnail: (id) =>
				mapErrors(
					transfers.withPermits(1)(
						Effect.gen(function* () {
							if (!live) {
								const rows = yield* sql<{
									metadata: string;
								}>`SELECT metadata FROM job_files WHERE id=${id}`;
								const thumbnail = rows[0]
									? (JSON.parse(rows[0].metadata) as JobMetadata).thumbnail
									: null;
								if (!thumbnail) return yield* Effect.fail(failure('Thumbnail unavailable.'));
								return yield* Effect.try({
									try: () => checkedPng(Buffer.from(thumbnail.split(',')[1]!, 'base64')),
									catch: () => failure('Thumbnail unavailable.')
								});
							}
							const path = thumbnailPaths.get(id);
							if (!path) return yield* Effect.fail(failure('Thumbnail unavailable.'));
							const bytes = yield* upstream(
								`/server/files/gcodes/${path.split('/').map(encodeURIComponent).join('/')}`,
								256 * 1024
							);
							return yield* Effect.try({
								try: () => checkedPng(bytes),
								catch: () => failure('Thumbnail unavailable.')
							});
						})
					)
				),
			remove: (id, authorized = Effect.succeed(true)) =>
				mapErrors(
					mutationLock(
						Effect.gen(function* () {
							if (live) return yield* removeLive(id, authorized);
							const file = (yield* SubscriptionRef.get(state)).files.find((f) => f.id === id);
							if (!file) return;
							const snapshot = yield* SubscriptionRef.get(printer.state);
							const pending = yield* sql<{
								id: string;
							}>`SELECT id FROM actions WHERE status IN ('queued','sending') AND json_extract(payload,'$.fileId')=${id}`;
							if (
								pending.length ||
								((snapshot.job.state === 'printing' || snapshot.job.state === 'paused') &&
									snapshot.job.filename === file.name)
							)
								return yield* Effect.fail(
									failure('This file is in use by an active or pending print.')
								);
							yield* Effect.gen(function* () {
								if (!(yield* authorized))
									return yield* Effect.fail(failure('File operation authorization ended.'));
								yield* sql`DELETE FROM job_files WHERE id=${id}`;
								yield* SubscriptionRef.update(state, (s) => ({
									...s,
									files: s.files.filter((f) => f.id !== id),
									updatedAt: Date.now()
								}));
							}).pipe(Effect.uninterruptible);
						})
					)
				),
			keys: (owner) =>
				mapErrors(
					sql<KeySummary>`SELECT id,name,suffix,created,expires,can_print AS canPrint FROM slicer_keys WHERE owner=${owner} AND expires>${Date.now()} ORDER BY created DESC`.pipe(
						Effect.map((rows) => rows.map((row) => ({ ...row, canPrint: Boolean(row.canPrint) })))
					)
				),
			issueKey: (owner, epoch, name, canPrint = false) =>
				mapErrors(
					lock.withPermits(1)(
						Effect.gen(function* () {
							if (!config.checkUser(owner, epoch))
								return yield* Effect.fail(failure('An active operator account is required.'));
							const keys =
								yield* sql`SELECT id FROM slicer_keys WHERE owner=${owner} AND expires>${Date.now()}`;
							if (keys.length >= 10)
								return yield* Effect.fail(failure('Revoke an unused key first (10-key limit).'));
							const token = randomBytes(32).toString('base64url');
							const key = {
								id: randomUUID(),
								name: name.trim().slice(0, 80) || 'Slicer',
								canPrint,
								suffix: token.slice(-4),
								created: Date.now(),
								expires: Date.now() + 90 * 86400_000
							};
							yield* sql`INSERT INTO slicer_keys (id,owner,epoch,hash,name,suffix,created,expires,can_print) VALUES (${key.id},${owner},${epoch},${digest(token)},${key.name},${key.suffix},${key.created},${key.expires},${canPrint ? 1 : 0})`;
							return { token, key };
						})
					)
				),
			revokeKey: (owner, id) =>
				mapErrors(
					sql`DELETE FROM slicer_keys WHERE owner=${owner} AND id=${id}`.pipe(Effect.asVoid)
				),
			printKey: (token) =>
				mapErrors(
					Effect.gen(function* () {
						if (token.length !== 43) return null;
						const rows = yield* sql<{
							id: string;
							owner: string;
							epoch: number;
							can_print: number;
						}>`SELECT id,owner,epoch,can_print FROM slicer_keys WHERE hash=${digest(token)} AND expires>${Date.now()}`;
						const key = rows[0];
						if (!key || !config.checkUser(key.owner, key.epoch)) return null;
						return {
							id: key.id,
							owner: key.owner,
							canPrint: Boolean(key.can_print),
							authorized: () => config.checkPrintKey?.(key.id, key.owner, key.epoch) === true
						};
					})
				),
			validateKey: (token) =>
				mapErrors(
					Effect.gen(function* () {
						if (token.length !== 43) return false;
						const rows = yield* sql<{
							owner: string;
							epoch: number;
						}>`SELECT owner,epoch FROM slicer_keys WHERE hash=${digest(token)} AND expires>${Date.now()}`;
						return Boolean(rows[0] && config.checkUser(rows[0].owner, rows[0].epoch));
					})
				)
		};
	})
);
