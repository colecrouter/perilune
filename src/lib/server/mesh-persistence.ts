import { configParts } from '#lib/domain/configuration.js';
import { createHash } from 'node:crypto';
import { Context, Data, Effect, Layer, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { ConfigurationService, ConfigurationSettings, type ConfigActor } from './config-service.js';
import { MoonrakerService } from './moonraker.js';
import { migrate } from './migrations.js';
import { pendingManifest, pendingConfigurationText } from './pending-configuration.js';
import type { ConfigSources } from '#lib/domain/config-sources.js';
import { meshParameters, type BedMesh } from '#lib/domain/bed-mesh.js';
import { sameMesh } from '#lib/domain/live-mesh.js';

export class MeshPersistenceError extends Data.TaggedError('MeshPersistenceError')<{
	message: string;
}> {}
const failure = (e: unknown) =>
	new MeshPersistenceError({
		message: e instanceof Error ? e.message : 'Mesh persistence verification failed.'
	});
interface Evidence {
	target: string;
	sources: ConfigSources;
	text: string;
	config: Record<string, unknown>;
	expected?: string;
	discard?: boolean;
	candidate?: BedMesh;
	savedNames?: string[];
	removedNames?: string[];
	uploaded?: boolean;
}
/** Private source evidence stays in SQLite, never in the dashboard/workflow snapshot. */
export class MeshPersistence extends Context.Service<
	MeshPersistence,
	{
		reconcile: (
			id: string,
			actor: ConfigActor
		) => Effect.Effect<'saved' | 'discarded', MeshPersistenceError>;
		prepareRemoval: (
			id: string,
			actor: ConfigActor,
			name: string
		) => Effect.Effect<void, MeshPersistenceError>;
		capture: (
			id: string,
			actor: ConfigActor,
			previous: BedMesh | null,
			target?: BedMesh | null,
			targetName?: string
		) => Effect.Effect<void, MeshPersistenceError>;
		check: (
			id: string,
			actor: ConfigActor,
			candidate: BedMesh,
			names: string[],
			removed?: string[],
			allowMissingCopy?: boolean
		) => Effect.Effect<void, MeshPersistenceError>;
		finish: (
			id: string,
			actor: ConfigActor,
			candidate: BedMesh,
			names: string[],
			discard: boolean,
			permit: () => boolean,
			removed?: string[]
		) => Effect.Effect<void, MeshPersistenceError>;
	}
>()('perilune/MeshPersistence') {}
const object = (v: unknown): Record<string, any> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const canonical = (value: unknown): string =>
	JSON.stringify(value, (_, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
			: v
	);
export function savedMesh(config: Record<string, unknown>, name: string): BedMesh | null {
	const p = object(config[`bed_mesh ${name}`]);
	const points =
		typeof p.points === 'string'
			? p.points
					.trim()
					.split('\n')
					.filter(Boolean)
					.map((r: string) => r.split(',').map(Number))
			: null;
	if (
		!points ||
		points.length < 2 ||
		points.some(
			(r: number[]) => r.length !== points[0].length || r.some((v: number) => !Number.isFinite(v))
		)
	)
		return null;
	const min: [number, number] = [Number(p.min_x), Number(p.min_y)],
		max: [number, number] = [Number(p.max_x), Number(p.max_y)];
	if (![...min, ...max].every(Number.isFinite)) return null;
	const parameters = meshParameters(p);
	return { name, min, max, points, ...(parameters ? { parameters } : {}) };
}
export function meshPending(value: unknown, candidate: BedMesh, names: string[]) {
	const manifest = pendingManifest(value);
	if (
		canonical(Object.keys(manifest).sort()) !== canonical(names.map((n) => `bed_mesh ${n}`).sort())
	)
		throw Error(
			'Unrelated pending settings appeared. Resolve them before saving or discarding this mesh.'
		);
	for (const name of names) {
		const p = manifest[`bed_mesh ${name}`]!;
		if (
			Object.keys(p).some(
				(k) =>
					![
						'version',
						'points',
						'min_x',
						'min_y',
						'max_x',
						'max_y',
						'x_count',
						'y_count',
						'mesh_x_pps',
						'mesh_y_pps',
						'algo',
						'tension'
					].includes(k)
			) ||
			(p.version !== undefined && p.version !== '1')
		)
			throw Error('Unsupported pending mesh parameters require manual review.');
		if (!sameMesh(candidate, savedMesh({ [`bed_mesh ${name}`]: p }, name)))
			throw Error('Pending mesh values no longer match the reviewed result.');
	}
	return manifest;
}
/** Eligibility uses every raw autosave section, including overridden definitions. */
function removalPlan(text: string, sources: ConfigSources, removedSections: string[]) {
	const parts = configParts(text);
	if (parts.warning) throw Error('The generated configuration block requires manual review.');
	const sections: string[] = [];
	for (const encoded of parts.generated.split('\n').slice(3)) {
		const line = (encoded.startsWith('#*# ') ? encoded.slice(4) : '').split('#', 1)[0]!.trimEnd();
		if (!line.trim() || line.trimStart().startsWith(';')) continue;
		if (line.trimStart().startsWith('[')) {
			const header = /^\s*\[([^\]]+)\]\s*(?:;.*)?$/.exec(line);
			if (!header) throw Error('Unrecognized generated section requires manual review.');
			sections.push(header[1]!);
		}
	}
	if (sections.length > 0 && sections.every((section) => removedSections.includes(section)))
		return { upload: true, expected: parts.editable + (parts.editable.endsWith('\n') ? '' : '\n') };

	try {
		return {
			upload: false,
			expected: pendingConfigurationText(text, sources, {}, removedSections)
		};
	} catch {
		throw Error(
			'Other generated configuration requires review before deleting this mesh. No removal was dispatched.'
		);
	}
}
export const MeshPersistenceLive = Layer.effect(
	MeshPersistence,
	Effect.gen(function* () {
		const files = yield* ConfigurationService,
			settings = yield* ConfigurationSettings,
			sql = yield* SqlClient,
			transport = yield* MoonrakerService;
		yield* migrate;
		const base = new URL(settings.moonrakerUrl);
		base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
		base.pathname = '/';
		base.search = '';
		base.hash = '';
		const call = async (path: string, signal: AbortSignal, method = 'GET', body?: unknown) => {
			const response = await fetch(new URL(path, base), {
				method,
				redirect: 'error',
				cache: 'no-store',
				headers: {
					...(settings.apiKey ? { 'X-Api-Key': settings.apiKey } : {}),
					...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
				},
				...(method === 'POST' && body
					? { body: body instanceof FormData ? body : JSON.stringify(body) }
					: {}),
				signal: AbortSignal.any([signal, AbortSignal.timeout(10000)])
			});
			const reader = response.body?.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				if (reader)
					while (true) {
						const p = await reader.read();
						if (p.done) break;
						size += p.value.length;
						if (size > 2 * 1024 * 1024)
							throw Error('Mesh verification response exceeds its limit.');
						chunks.push(p.value);
					}
			} finally {
				await reader?.cancel().catch(() => {});
			}
			if (!response.ok) throw Error('Mesh configuration verification failed.');
			return JSON.parse(Buffer.concat(chunks).toString()).result;
		};
		const idle = async (signal: AbortSignal) => {
			const result = await call(
					'/printer/objects/query?configfile&print_stats&idle_timeout&heaters&manual_probe&bed_mesh',
					signal
				),
				status = object(result.status);
			const inventory = status.heaters?.available_heaters;
			if (
				!Array.isArray(inventory) ||
				inventory.length > 64 ||
				inventory.some((n: unknown) => typeof n !== 'string' || !/^[a-zA-Z0-9_ ]+$/.test(n)) ||
				status.manual_probe?.is_active !== false ||
				!['standby', 'complete', 'cancelled'].includes(status.print_stats?.state) ||
				!['Ready', 'Idle'].includes(status.idle_timeout?.state)
			)
				throw Error('Cannot verify an idle printer and all configured heaters.');
			const heaters = inventory.length
				? await call(
						'/printer/objects/query?' + inventory.map(encodeURIComponent).join('&'),
						signal
					)
				: { status: {} };
			if (inventory.some((n: string) => heaters.status?.[n]?.target !== 0))
				throw Error('Turn off every heater before saving or discarding a mesh.');
			return object(status.configfile);
		};
		const targetKey = createHash('sha256').update(settings.moonrakerUrl).digest('hex');
		const read = async (id: string) => {
			const rows = await Effect.runPromise(
				sql<{ value: string }>`SELECT value FROM mesh_evidence WHERE id=${id}`
			);
			if (!rows[0]) throw Error('Mesh recovery evidence is unavailable.');
			const evidence = JSON.parse(rows[0].value) as Evidence;
			if (evidence.target !== targetKey)
				throw Error(
					'Mesh evidence belongs to a different configured printer. Manual recovery is required.'
				);
			return evidence;
		};
		const source = async (actor: ConfigActor) => {
			if (!actor.authorized()) throw Error('An authorized owner is required.');
			const sources = await Effect.runPromise(files.sources('@main', actor));
			const doc = await Effect.runPromise(files.read(sources.root, actor));
			return { sources, text: doc.text };
		};
		const check = async (
			id: string,
			actor: ConfigActor,
			candidate: BedMesh,
			names: string[],
			signal: AbortSignal,
			removed: string[] = [],
			allowMissingCopy = false
		) => {
			const before = await read(id),
				current = await source(actor),
				config = await idle(signal);
			if (
				current.sources.fingerprint !== before.sources.fingerprint ||
				current.text !== before.text ||
				canonical(config.config) !== canonical(before.config)
			)
				throw Error('Saved configuration changed during the workflow. Review it before recovery.');
			const manifest = removed.length
				? {}
				: meshPending(
						config.save_config_pending_items,
						candidate,
						allowMissingCopy
							? names.filter(
									(n, i) =>
										i === 0 ||
										Object.hasOwn(object(config.save_config_pending_items), 'bed_mesh ' + n)
								)
							: names
					);
			if (
				removed.length &&
				(canonical(Object.keys(object(config.save_config_pending_items)).sort()) !==
					canonical(removed.map((n) => 'bed_mesh ' + n).sort()) ||
					removed.some((n) => config.save_config_pending_items?.['bed_mesh ' + n] !== null))
			)
				throw Error('Pending deletion changed or unrelated settings appeared. No save was sent.');
			return { before, manifest };
		};
		return {
			reconcile: (id, actor) =>
				Effect.tryPromise({
					try: async (signal) => {
						const before = await read(id),
							current = await source(actor),
							config = await idle(signal);
						if (
							config.save_config_pending !== false ||
							canonical(config.save_config_pending_items) !== '{}'
						)
							throw Error('Pending settings remain. Inspect them before resolving this workflow.');
						if (
							before.sources.dependencies.some(
								(d) =>
									d.path !== before.sources.root &&
									!current.sources.dependencies.some(
										(n) => n.path === d.path && n.version === d.version
									)
							)
						)
							throw Error('Included configuration changed. Manual review is required.');
						if (before.expected && current.text === before.expected) {
							if (before.discard) {
								if (canonical(config.config) !== canonical(before.config))
									throw Error(
										'Loaded configuration differs from the recorded pre-calibration state.'
									);
								return 'discarded' as const;
							}
							if (
								before.uploaded &&
								canonical(config.config) !==
									canonical(
										Object.fromEntries(
											Object.entries(before.config).filter(
												([section]) =>
													!before.removedNames?.some((n) => section === 'bed_mesh ' + n)
											)
										)
									)
							)
								throw Error('Loaded configuration differs from the reviewed removal.');
							if (
								!before.candidate ||
								(before.savedNames ?? []).some(
									(n) => !sameMesh(before.candidate!, savedMesh(object(config.config), n))
								) ||
								(before.removedNames ?? []).some((n) =>
									Object.hasOwn(object(config.config), 'bed_mesh ' + n)
								)
							)
								throw Error('Loaded mesh parameters do not match the recorded saved outcome.');
							return 'saved' as const;
						}

						if (
							current.text === before.text &&
							canonical(config.config) === canonical(before.config)
						)
							return 'discarded' as const;
						throw Error(
							'The saved outcome does not match the recorded workflow. Manual configuration review is required.'
						);
					},
					catch: failure
				}),
			prepareRemoval: (id, actor, name) =>
				Effect.tryPromise({
					try: async () => {
						const before = await read(id);
						const current = await source(actor);
						if (current.sources.fingerprint !== before.sources.fingerprint)
							throw Error('Saved configuration changed.');
						const section = 'bed_mesh ' + name;
						if (before.sources.definitions.some((d) => d.section === section && !d.generated))
							throw Error(
								'A mesh defined in editable configuration must be removed through the configuration editor.'
							);
						removalPlan(before.text, before.sources, [section]);
						const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
						const reference = new RegExp(
							'(?:LOAD|PROFILE)\\s*=\\s*[\"\']?' + escaped + '(?:[\"\'\\s}]|$)',
							'i'
						);
						if (
							Object.entries(before.config).some(
								([s, v]) =>
									(s.startsWith('gcode_macro ') || s.startsWith('delayed_gcode ')) &&
									reference.test(String(object(v).gcode ?? ''))
							)
						)
							throw Error(
								'A configured macro refers to this mesh. Replace that reference before deleting it.'
							);
					},
					catch: failure
				}),
			capture: (id, actor, previous, target, targetName) =>
				Effect.tryPromise({
					try: async (signal) => {
						const sources = await source(actor),
							config = await idle(signal);
						if (
							config.save_config_pending !== false ||
							canonical(config.save_config_pending_items) !== '{}'
						)
							throw Error('Resolve existing pending settings before calibrating the usual mesh.');
						if (previous && !sameMesh(previous, savedMesh(object(config.config), previous.name)))
							throw Error(
								'The active mesh is not durably saved. Save or clear it before calibration.'
							);
						if (targetName) {
							const saved = savedMesh(object(config.config), targetName);
							if (target ? !sameMesh(target, saved) : saved !== null)
								throw Error(
									'The target mesh differs from its durably saved version. Resolve pending mesh changes first.'
								);
						}
						await Effect.runPromise(
							sql`DELETE FROM mesh_evidence WHERE id NOT IN (SELECT id FROM mesh_evidence ORDER BY rowid DESC LIMIT 19)`
						);
						await Effect.runPromise(
							sql`INSERT INTO mesh_evidence(id,value) VALUES(${id},${JSON.stringify({ target: targetKey, ...sources, config: object(config.config) })})`
						);
					},
					catch: failure
				}),
			check: (id, actor, candidate, names, removed, allowMissingCopy) =>
				Effect.tryPromise({
					try: async (signal) => {
						await check(id, actor, candidate, names, signal, removed, allowMissingCopy);
					},
					catch: failure
				}),
			finish: (id, actor, candidate, names, discard, permit, removed) =>
				Effect.tryPromise({
					try: async (signal) => {
						const { before, manifest } = await check(
							id,
							actor,
							candidate,
							names,
							signal,
							removed,
							discard
						);
						const removedSections = removed?.map((n) => 'bed_mesh ' + n) ?? [];
						const removal =
							!discard && removedSections.length
								? removalPlan(before.text, before.sources, removedSections)
								: null;
						const finalRemoval = removal?.upload === true;
						const expected = discard
							? before.text
							: (removal?.expected ??
								pendingConfigurationText(before.text, before.sources, manifest));

						before.uploaded = finalRemoval;

						before.expected = expected;
						before.discard = discard;
						before.candidate = candidate;
						before.savedNames = names;
						before.removedNames = removed ?? [];
						await Effect.runPromise(
							sql`UPDATE mesh_evidence SET value=${JSON.stringify(before)} WHERE id=${id}`
						);
						const baseline =
							(await Effect.runPromise(SubscriptionRef.get(transport.state))).restartSerial ?? 0;
						if (!permit() || !actor.authorized())
							throw Error('Authorization or safety state changed.');
						// Klipper's SAVE_CONFIG is a no-op when its final autosave section was removed.
						// Only that case uses an evidence-journaled, exact source upload, followed by RESTART.
						if (finalRemoval) {
							const form = new FormData();
							form.set('root', 'config');
							const path = before.sources.root.split('/');
							const filename = path.pop()!;
							if (path.length) form.set('path', path.join('/'));
							form.set('file', new Blob([expected], { type: 'text/plain' }), filename);
							try {
								await call('/server/files/upload', signal, 'POST', form);
							} catch {
								/* readback determines whether the single upload took effect */
							}
							const readback = await source(actor),
								latest = await idle(signal);
							if (
								readback.text !== expected ||
								canonical(latest.config) !== canonical(before.config) ||
								canonical(latest.save_config_pending_items) !==
									canonical(Object.fromEntries(removedSections.map((n) => [n, null]))) ||
								before.sources.dependencies.some(
									(d) =>
										d.path !== before.sources.root &&
										!readback.sources.dependencies.some(
											(n) => n.path === d.path && n.version === d.version
										)
								)
							)
								throw Error(
									'The removal upload or pending settings changed. No restart was sent; review the recorded source evidence.'
								);
							if (!permit() || !actor.authorized())
								throw Error('Authorization or safety state changed before restart.');
						}
						// Sending is recorded by the caller before this boundary. Never replay a lost acknowledgement.
						try {
							await call(
								discard || finalRemoval ? '/printer/restart' : '/printer/gcode/script',
								signal,
								'POST',
								discard || finalRemoval ? undefined : { script: 'SAVE_CONFIG' }
							);
						} catch {
							/* read-only reconciliation below */
						}

						const deadline = Date.now() + 90000;
						while (Date.now() < deadline && !signal.aborted) {
							const state = await Effect.runPromise(SubscriptionRef.get(transport.state));
							if (
								(state.restartSerial ?? 0) > baseline &&
								state.telemetryReady &&
								state.klippy === 'ready'
							) {
								const current = await source(actor),
									config = await idle(signal);
								if (
									current.text !== expected ||
									config.save_config_pending !== false ||
									canonical(config.save_config_pending_items) !== '{}'
								)
									throw Error(
										'Saved mesh or cleared pending settings could not be verified after restart.'
									);
								if (
									before.sources.dependencies.some(
										(d) =>
											d.path !== before.sources.root &&
											!current.sources.dependencies.some(
												(n) => n.path === d.path && n.version === d.version
											)
									)
								)
									throw Error('An included file changed during restart.');
								if (discard && canonical(config.config) !== canonical(before.config))
									throw Error(
										'Loaded configuration differs from the recorded pre-calibration state.'
									);
								if (
									finalRemoval &&
									canonical(config.config) !==
										canonical(
											Object.fromEntries(
												Object.entries(before.config).filter(
													([section]) => !removedSections.includes(section)
												)
											)
										)
								)
									throw Error('Loaded configuration differs from the reviewed removal.');
								if (removed?.some((n) => object(config.config)['bed_mesh ' + n]))
									throw Error('Deleted mesh is still present after restart.');
								if (
									!discard &&
									names.some((n) => !sameMesh(candidate, savedMesh(object(config.config), n)))
								)
									throw Error('Saved mesh readback differs from the reviewed result.');
								return;
							}
							await new Promise<void>((resolve) => {
								const timer = setTimeout(done, 250);
								function done() {
									clearTimeout(timer);
									signal.removeEventListener('abort', done);
									resolve();
								}
								signal.addEventListener('abort', done, { once: true });
							});
						}
						throw Error(
							'Fresh Klipper restart was not verified. Check the saved state; no command was replayed.'
						);
					},
					catch: failure
				})
		};
	})
);
