import { posix } from 'node:path';
import { resolveConfigSources } from './config-sources.js';
import type { ConfigSources } from '#lib/domain/config-sources.js';
import { createHash, randomUUID } from 'node:crypto';
import { Context, Data, Effect, Layer, Semaphore } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import {
	checkConfigChange,
	checkConfigText,
	validConfigPath,
	MAX_CONFIG_BYTES,
	type ConfigDocument,
	type ConfigFile,
	type ConfigSave,
	type ConfigSaved
} from '#lib/domain/configuration.js';
import { migrate } from './migrations.js';
export class ConfigurationError extends Data.TaggedError('ConfigurationError')<{
	message: string;
}> {}
export interface ConfigActor {
	id: string;
	name: string;
	authorized: () => boolean;
}
export class ConfigurationSettings extends Context.Service<
	ConfigurationSettings,
	{
		moonrakerUrl: string;
		apiKey?: string;
		requestTimeoutMs?: number;
		klipperWorkingDirectory?: string;
	}
>()('perilune/ConfigurationSettings') {}
export class ConfigurationService extends Context.Service<
	ConfigurationService,
	{
		sources: (root: string, actor: ConfigActor) => Effect.Effect<ConfigSources, ConfigurationError>;
		list: (actor: ConfigActor) => Effect.Effect<ConfigFile[], ConfigurationError>;
		read: (path: string, actor: ConfigActor) => Effect.Effect<ConfigDocument, ConfigurationError>;
		backup: (
			path: string,
			id: string,
			actor: ConfigActor
		) => Effect.Effect<string, ConfigurationError>;
		save: (
			request: ConfigSave,
			actor: ConfigActor
		) => Effect.Effect<ConfigSaved, ConfigurationError>;
	}
>()('perilune/ConfigurationService') {}
const fail = (message: string) => new ConfigurationError({ message });
const authorize = (actor: ConfigActor) => {
	if (!actor.authorized()) throw fail('An authorized owner account is required.');
};
const pathCheck = (path: string) => {
	if (!validConfigPath(path))
		throw fail('Choose a supported text file within the configuration folder.');
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const guarded = <A>(f: () => A) =>
	Effect.try({
		try: f,
		catch: (cause) =>
			cause instanceof ConfigurationError
				? cause
				: fail(cause instanceof Error ? cause.message : 'Invalid configuration request.')
	});
const storageError = () =>
	fail(
		'Configuration storage is unavailable. Keep your draft and reload the saved version before trying again.'
	);
export const sampleConfigs: Record<string, string> = {
	'printer.cfg':
		'# Perilune simulator — example configuration, not hardware settings\n[include macros.cfg]\n\n[printer]\nkinematics: cartesian\nmax_velocity: 200 # mm/s\nmax_accel: 2500\nsquare_corner_velocity: 5\n\n[extruder]\nrotation_distance: 7.5\nnozzle_diameter: 0.4\nfilament_diameter: 1.75\npressure_advance: 0.04\nmin_extrude_temp: 170\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.\n#*#\n#*# [probe]\n#*# z_offset = 1.200\n',
	'macros.cfg':
		'# Includes and Jinja remain raw source.\n[gcode_macro EXAMPLE_STATUS]\ndescription: Report an example message\ngcode:\n    {% set message = "Ready for another orbit" %}\n    RESPOND MSG="{message}"\n',
	'material-notes.yaml':
		'# Example notes; this file is not loaded by Klipper.\nmaterials:\n  PLA:\n    note: "Check the spool temperature guidance"\n'
};
interface StoredFile {
	path: string;
	text: string;
	version: string;
	updated_at: number;
}
export const ConfigurationServiceLive = Layer.effect(
	ConfigurationService,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		const settings = yield* ConfigurationSettings;
		yield* migrate;
		const lock = yield* Semaphore.make(1);
		let activeSaves = 0;
		if (!settings.moonrakerUrl)
			for (const [path, text] of Object.entries(sampleConfigs))
				yield* sql`INSERT OR IGNORE INTO config_files(path,text,version,updated_at) VALUES(${path},${text},${randomUUID()},${Date.now()})`;
		let base: URL | undefined;
		if (settings.moonrakerUrl) {
			base = new URL(settings.moonrakerUrl);
			base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
			base.pathname = '/';
			base.search = '';
			base.hash = '';
		}
		const upstream = (path: string, maximum: number, actor: ConfigActor) =>
			Effect.tryPromise({
				try: async (signal) => {
					authorize(actor);
					const timeout = AbortSignal.timeout(settings.requestTimeoutMs ?? 10_000);
					const combined = AbortSignal.any([signal, timeout]);
					const response = await fetch(new URL(path, base!), {
						headers: settings.apiKey ? { 'X-Api-Key': settings.apiKey } : {},
						redirect: 'error',
						signal: combined,
						cache: 'no-store'
					});
					if (!response.ok)
						throw fail('The configuration file service is unavailable or refused access.');
					const reader = response.body?.getReader();
					if (!reader) throw fail('No configuration response was received.');
					let size = 0;
					const chunks: Uint8Array[] = [];
					try {
						while (true) {
							const part = await reader.read();
							if (part.done) break;
							size += part.value.length;
							if (size > maximum)
								throw fail('The configuration response exceeds the supported size.');
							chunks.push(part.value);
						}
					} finally {
						await reader.cancel().catch(() => {});
						reader.releaseLock();
					}
					authorize(actor);
					return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
						Buffer.concat(chunks)
					);
				},
				catch: (cause) =>
					cause instanceof ConfigurationError
						? cause
						: fail(
								'The configuration file service could not be reached. Keep any open draft and try again.'
							)
			});
		const list = (actor: ConfigActor) =>
			Effect.gen(function* () {
				yield* guarded(() => authorize(actor));
				if (base) {
					const raw = yield* upstream('/server/files/list?root=config', 512 * 1024, actor);
					return yield* guarded(() => {
						let body;
						try {
							body = JSON.parse(raw);
						} catch {
							throw fail('The configuration file listing could not be decoded.');
						}
						const rows = Array.isArray(body) ? body : body.result;
						if (!Array.isArray(rows) || rows.length > 2000)
							throw fail('The configuration file listing is unsupported or too large.');
						const files: ConfigFile[] = [];
						const seen = new Set<string>();
						for (const row of rows) {
							if (
								!row ||
								typeof row !== 'object' ||
								typeof row.path !== 'string' ||
								!validConfigPath(row.path) ||
								typeof row.size !== 'number' ||
								!Number.isFinite(row.size) ||
								row.size < 0 ||
								row.size > MAX_CONFIG_BYTES ||
								!['r', 'rw'].includes(row.permissions)
							)
								continue;
							if (seen.has(row.path)) continue;
							seen.add(row.path);
							files.push({
								path: row.path,
								version: '',
								updatedAt:
									typeof row.modified === 'number' && Number.isFinite(row.modified)
										? row.modified * 1000
										: 0
							});
						}
						return files.sort((a, b) => a.path.localeCompare(b.path));
					});
				}
				return yield* sql<StoredFile>`SELECT path,version,updated_at FROM config_files ORDER BY path`.pipe(
					Effect.map((rows) =>
						rows.map((row) => ({ path: row.path, version: row.version, updatedAt: row.updated_at }))
					),
					Effect.mapError(storageError)
				);
			});
		const read = (path: string, actor: ConfigActor) =>
			Effect.gen(function* () {
				yield* guarded(() => {
					authorize(actor);
					pathCheck(path);
				});
				if (base) {
					const files = yield* list(actor);
					if (!files.some((f) => f.path === path))
						return yield* Effect.fail(fail('That supported configuration file is not available.'));
					const text = yield* upstream(
						'/server/files/config/' + path.split('/').map(encodeURIComponent).join('/'),
						MAX_CONFIG_BYTES,
						actor
					);
					yield* guarded(() => checkConfigText(text));
					return {
						path,
						text,
						version: digest(text),
						updatedAt: files.find((f) => f.path === path)!.updatedAt,
						source: 'moonraker' as const,
						backups: []
					};
				}
				return yield* Effect.gen(function* () {
					const rows = yield* sql<StoredFile>`SELECT * FROM config_files WHERE path=${path}`;
					const row = rows[0];
					if (!row) return yield* Effect.fail(fail('Configuration file was not found.'));
					const backups = yield* sql<{
						id: string;
						created_at: number;
						actor: string;
					}>`SELECT id,created_at,actor FROM config_backups WHERE path=${path} ORDER BY created_at DESC,rowid DESC LIMIT 20`;
					yield* guarded(() => authorize(actor));
					return {
						path,
						text: row.text,
						version: row.version,
						updatedAt: row.updated_at,
						source: 'simulator' as const,
						backups: backups.map((b) => ({ id: b.id, createdAt: b.created_at, actor: b.actor }))
					};
				}).pipe(
					Effect.mapError((cause) => (cause instanceof ConfigurationError ? cause : storageError()))
				);
			});
		return {
			list,
			read,
			sources: (root, actor) =>
				Effect.tryPromise({
					try: async (signal) => {
						const listing = await Effect.runPromise(list(actor), { signal });
						let main = root;
						if (root === '@main') {
							if (base) {
								const raw = await Effect.runPromise(upstream('/printer/info', 64 * 1024, actor), {
									signal
								});
								let config = JSON.parse(raw)?.result?.config_file;
								if (typeof config === 'string' && !config.startsWith('/')) {
									const cwd = settings.klipperWorkingDirectory;
									if (
										!cwd ||
										!cwd.startsWith('/') ||
										/[\0\r\n\\]/.test(cwd) ||
										/[\0\r\n\\]/.test(config)
									)
										throw fail(
											'A relative Klipper config path requires a valid server-side Klipper working directory.'
										);
									config = posix.resolve(cwd, config);
								}
								const roots = JSON.parse(
									await Effect.runPromise(upstream('/server/files/roots', 64 * 1024, actor), {
										signal
									})
								)?.result;
								const configRoots = Array.isArray(roots)
									? roots.filter((item) => item?.name === 'config' && typeof item.path === 'string')
									: [];
								if (
									typeof config !== 'string' ||
									!config.startsWith('/') ||
									configRoots.length !== 1 ||
									!configRoots[0].path.startsWith('/')
								)
									throw fail(
										'Cannot verify the main configuration within Moonraker’s config folder.'
									);
								const relative = posix.relative(
									posix.normalize(configRoots[0].path),
									posix.normalize(config)
								);
								if (!validConfigPath(relative) || !listing.some((file) => file.path === relative))
									throw fail(
										'The main configuration is outside Moonraker’s supported config folder. Review it manually.'
									);
								main = relative;
							} else main = 'printer.cfg';
						}
						const sources = await resolveConfigSources(
							main,
							listing.map((file) => file.path),
							(path) => Effect.runPromise(read(path, actor), { signal })
						);
						authorize(actor);
						return sources;
					},
					catch: (cause) =>
						cause instanceof ConfigurationError
							? cause
							: fail(
									cause instanceof Error
										? cause.message
										: 'Could not resolve configuration sources.'
								)
				}),
			backup: (path, id, actor) =>
				Effect.gen(function* () {
					yield* guarded(() => {
						authorize(actor);
						pathCheck(path);
					});
					if (base) return yield* Effect.fail(fail('Live backup access is not enabled.'));
					const rows = yield* sql<{
						text: string;
					}>`SELECT text FROM config_backups WHERE path=${path} AND id=${id}`.pipe(
						Effect.mapError(storageError)
					);
					yield* guarded(() => authorize(actor));
					if (!rows[0]) return yield* Effect.fail(fail('That backup is no longer available.'));
					return rows[0].text;
				}),
			save: (request, actor) =>
				Effect.suspend(() => {
					if (activeSaves >= 10)
						return Effect.fail(
							fail('Configuration save queue is full. Keep your draft and wait for pending saves.')
						);
					activeSaves++;
					return lock
						.withPermits(1)(
							Effect.gen(function* () {
								yield* guarded(() => {
									authorize(actor);
									pathCheck(request.path);
									checkConfigText(request.text);
									if (
										!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
											request.id
										) ||
										request.expectedVersion.length > 80
									)
										throw fail('Invalid configuration revision or save ID.');
								});
								if (base)
									return yield* Effect.fail(
										fail('Live configuration writes are not enabled. Export a draft for review.')
									);
								const fingerprint = digest(JSON.stringify(request));
								return yield* sql
									.withTransaction(
										Effect.gen(function* () {
											yield* guarded(() => authorize(actor));
											const receipt = (yield* sql<{
												actor_id: string;
												fingerprint: string;
												result: string;
											}>`SELECT actor_id,fingerprint,result FROM config_saves WHERE id=${request.id}`)[0];
											if (receipt) {
												if (receipt.actor_id !== actor.id || receipt.fingerprint !== fingerprint)
													return yield* Effect.fail(
														fail('This save ID belongs to another request.')
													);
												return JSON.parse(receipt.result) as ConfigSaved;
											}
											const row =
												(yield* sql<StoredFile>`SELECT * FROM config_files WHERE path=${request.path}`)[0];
											if (!row)
												return yield* Effect.fail(fail('Configuration file was not found.'));
											if (row.version !== request.expectedVersion)
												return yield* Effect.fail(
													fail(
														'The saved file changed. Your draft is intact; reload the saved version and compare before saving.'
													)
												);
											yield* guarded(() => checkConfigChange(row.text, request.text));
											if (row.text === request.text)
												return yield* Effect.fail(fail('There are no changes to save.'));
											const result = {
												path: request.path,
												version: randomUUID(),
												updatedAt: Date.now()
											};
											yield* sql`INSERT INTO config_backups(id,path,text,created_at,actor) VALUES(${randomUUID()},${request.path},${row.text},${result.updatedAt},${actor.name.slice(0, 120)})`;
											yield* sql`UPDATE config_files SET text=${request.text},version=${result.version},updated_at=${result.updatedAt} WHERE path=${request.path} AND version=${request.expectedVersion}`;
											yield* sql`INSERT INTO config_saves(id,actor_id,fingerprint,result,created_at) VALUES(${request.id},${actor.id},${fingerprint},${JSON.stringify(result)},${result.updatedAt})`;
											yield* sql`DELETE FROM config_backups WHERE path=${request.path} AND id NOT IN (SELECT id FROM config_backups WHERE path=${request.path} ORDER BY created_at DESC,rowid DESC LIMIT 20)`;
											yield* sql`DELETE FROM config_saves WHERE id NOT IN (SELECT id FROM config_saves ORDER BY created_at DESC,rowid DESC LIMIT 100)`;
											yield* guarded(() => authorize(actor));
											return result;
										})
									)
									.pipe(
										Effect.mapError((cause) =>
											cause instanceof ConfigurationError ? cause : storageError()
										)
									);
							})
						)
						.pipe(
							Effect.ensuring(
								Effect.sync(() => {
									activeSaves--;
								})
							),
							Effect.uninterruptible
						);
				})
		};
	})
);
