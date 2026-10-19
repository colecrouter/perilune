import { randomUUID } from 'node:crypto';
import { Context, Data, Effect, Layer, Schedule, Semaphore } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { CameraService } from './camera.js';
import { CameraCompanion, cameraProfiles, type CameraProfiles } from './camera-companion.js';
import { cameraInput, type CameraInput } from './camera-input.js';
import { migrate } from './migrations.js';

export class CameraSetupError extends Data.TaggedError('CameraSetupError')<{ message: string }> {}
const setupError = (message: string) => new CameraSetupError({ message });
interface SavedCamera {
	httpRemux?: boolean;
	width?: number;
	height?: number;
	id: string;
	input: CameraInput;
	profiles: CameraProfiles;
	original: string;
}
interface TestCamera extends SavedCamera {
	actor: string;
	revision: number;
	expires: number;
}
interface SetupStatus {
	enabled: boolean;
	revision: number;
	name: string | null;
	status: 'unconfigured' | 'ready' | 'reconnecting';
	message: string;
}
export class CameraSetupSettings extends Context.Service<
	CameraSetupSettings,
	{ baseUrl: string; webOrigin?: string; retryMs?: number }
>()('perilune/CameraSetupSettings') {}
export class CameraSetupService extends Context.Service<
	CameraSetupService,
	{
		status: Effect.Effect<SetupStatus>;
		reset: (expected: number, authorize: () => boolean) => Effect.Effect<SetupStatus, Error>;
		preview: (actor: string, token: string, request: Request) => Effect.Effect<Response, Error>;
		test: (
			actor: string,
			value: unknown,
			signal?: AbortSignal
		) => Effect.Effect<{ token: string; name: string; codec: string; revision: number }, Error>;
		save: (
			actor: string,
			token: string,
			authorize: () => boolean
		) => Effect.Effect<SetupStatus, Error>;
	}
>()('perilune/CameraSetupService') {}
export const CameraSetupServiceLive = Layer.effect(
	CameraSetupService,
	Effect.gen(function* () {
		const settings = yield* CameraSetupSettings;
		const camera = yield* CameraService;
		const sql = yield* SqlClient;
		yield* migrate;
		const lock = yield* Semaphore.make(1);
		const client = settings.baseUrl ? new CameraCompanion(settings.baseUrl) : null;
		yield* Effect.addFinalizer(() => Effect.sync(() => client?.dispose()));
		const rows = yield* sql<{
			revision: number;
			value: string | null;
		}>`SELECT revision,value FROM camera_settings WHERE id=1`;
		let revision = rows[0]?.revision ?? 0;
		let saved: SavedCamera | null = rows[0]?.value ? JSON.parse(rows[0].value) : null;
		let connected = false;
		let testsRunning = 0;
		const tested = new Map<string, TestCamera>();
		const status = (): SetupStatus => ({
			enabled: Boolean(client),
			revision,
			name: saved?.input.name ?? null,
			status: !saved ? 'unconfigured' : connected ? 'ready' : 'reconnecting',
			message: saved && !connected ? 'Camera connection is being restored.' : ''
		});
		const source = (value: SavedCamera) => ({
			source: value.original,
			baseUrl: settings.baseUrl,
			name: value.input.name,
			rotation: value.input.rotation,
			flipHorizontal: value.input.flipHorizontal,
			flipVertical: value.input.flipVertical,
			snapshotUrl:
				value.input.kind === 'snapshot' ? value.input.streamUrl : value.input.snapshotUrl,
			snapshotOnly: value.input.kind === 'snapshot',
			qualities:
				value.input.kind === 'snapshot'
					? undefined
					: {
							original: value.original,
							...(value.width && value.width > 640 ? { balanced: value.profiles.balanced } : {}),
							...(value.width && value.width > 320
								? { 'data-saver': value.profiles['data-saver'] }
								: {})
						}
		});
		const attempt = <A>(run: () => Promise<A>) =>
			Effect.tryPromise({
				try: run,
				catch: (cause) =>
					setupError(cause instanceof Error ? cause.message : 'Camera setup failed.')
			});
		const restore = Effect.gen(function* () {
			if (!client || !saved) return;
			const current = saved;
			if (current.input.kind === 'snapshot') {
				connected = true;
				yield* camera.setManagedSource(source(current));
				return;
			}
			const result = yield* attempt(async () => {
				await client.prepare(current.id, current.input, undefined, current.httpRemux);
			}).pipe(Effect.result);
			if (result._tag === 'Failure') {
				connected = false;
				return;
			}
			connected = true;
			yield* camera.setManagedSource(source(current));
		});
		// Re-register after startup; retries remain process-scoped and never own a browser lifetime.
		if (saved && client) yield* camera.setManagedSource(source(saved));
		const recover = Effect.gen(function* () {
			if (client && saved && connected && saved.input.kind !== 'snapshot') {
				const alive = yield* attempt(() => client.has(saved!.original)).pipe(
					Effect.orElseSucceed(() => false)
				);
				if (!alive) connected = false;
			}
			if (!connected) yield* restore;
			for (const [token, test] of tested) {
				if (test.expires > Date.now()) continue;
				tested.delete(token);
				if (client) yield* attempt(() => client.remove(test.profiles)).pipe(Effect.ignore);
			}
		});
		yield* recover.pipe(
			lock.withPermits(1),
			Effect.repeat(Schedule.spaced(settings.retryMs ?? 10_000)),
			Effect.forkScoped
		);
		return {
			status: Effect.sync(status),
			reset: (expected, authorize) =>
				Effect.gen(function* () {
					if (!authorize())
						return yield* Effect.fail(setupError('Owner access ended. Sign in again.'));
					if (expected !== revision)
						return yield* Effect.fail(
							setupError('Camera settings changed. Reload before disconnecting.')
						);
					yield* sql`INSERT INTO camera_settings(id,revision,value) VALUES(1,${revision + 1},NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=NULL`;
					const previous = saved;
					saved = null;
					revision++;
					connected = false;
					yield* camera.setManagedSource(null);
					if (client && previous)
						yield* attempt(() => client.remove(previous.profiles)).pipe(Effect.ignore);
					return status();
				}).pipe(lock.withPermits(1)),
			preview: (actor, token, request) =>
				Effect.gen(function* () {
					const candidate = tested.get(token);
					if (!candidate || candidate.actor !== actor || candidate.expires <= Date.now())
						return yield* Effect.fail(
							setupError('Camera test expired. Test the connection again.')
						);
					return yield* camera.proxyPreview(
						{ ...source(candidate), source: candidate.profiles.original },
						request
					);
				}),
			test: (actor, value, signal) =>
				Effect.gen(function* () {
					if (!client)
						return yield* Effect.fail(
							setupError('Enable the managed camera companion to add a camera.')
						);
					if (testsRunning >= 2 || tested.size + testsRunning >= 4)
						return yield* Effect.fail(
							setupError('Another camera test is pending. Try again shortly.')
						);
					let input: CameraInput;
					try {
						input = cameraInput(value, settings.webOrigin);
					} catch {
						return yield* Effect.fail(
							setupError(
								'Check the camera name, endpoint and orientation. Relative paths need the printer web origin.'
							)
						);
					}
					testsRunning++;
					const id = `perilune_${randomUUID().replaceAll('-', '')}`;
					const startingRevision = revision;
					return yield* attempt(async () => {
						const profiles = cameraProfiles(id);
						try {
							if (input.kind === 'snapshot') {
								const candidate: TestCamera = {
									id,
									input,
									profiles,
									original: id,
									actor,
									revision: startingRevision,
									expires: Date.now() + 300_000
								};
								const response = await Effect.runPromise(
									camera.proxyPreview(
										source(candidate),
										new Request('http://preview.invalid/api/camera/snapshot', { signal })
									)
								);
								const bytes = new Uint8Array(await response.arrayBuffer());
								if (!response.ok || bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216)
									throw setupError('Camera did not provide a JPEG image.');
								if (signal?.aborted) throw setupError('Camera test cancelled.');
								const token = randomUUID();
								tested.set(token, candidate);
								return { token, name: input.name, codec: 'JPEG', revision: startingRevision };
							}
							await client.prepare(id, input, signal);
							const probe = async () => {
								try {
									return {
										original: profiles.original,
										details: await client.probe(profiles.original, signal)
									};
								} catch (cause) {
									if (signal?.aborted) throw cause;
									return {
										original: profiles.compatible,
										details: await client.probe(profiles.compatible, signal)
									};
								}
							};
							let httpRemux = false;
							let media;
							try {
								media = await probe();
							} catch (cause) {
								if (signal?.aborted || !new URL(input.streamUrl).protocol.startsWith('http'))
									throw cause;
								httpRemux = true;
								await client.prepare(id, input, signal, true);
								media = await probe();
							}
							const { original, details } = media;
							if (signal?.aborted) throw setupError('Camera test cancelled.');
							const token = randomUUID();
							tested.set(token, {
								id,
								input,
								profiles,
								original,
								httpRemux,
								width: details.width,
								height: details.height,
								actor,
								revision: startingRevision,
								expires: Date.now() + 300_000
							});
							return { token, name: input.name, ...details, revision: startingRevision };
						} catch (cause) {
							await client.remove(profiles).catch(() => {});
							throw cause;
						}
					}).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								testsRunning--;
							})
						)
					);
				}),
			save: (actor, token, authorize) =>
				Effect.gen(function* () {
					if (!authorize())
						return yield* Effect.fail(setupError('Owner access ended. Sign in again.'));
					const candidate = tested.get(token);
					if (
						!candidate ||
						candidate.actor !== actor ||
						candidate.expires <= Date.now() ||
						candidate.revision !== revision
					)
						return yield* Effect.fail(
							setupError('Camera settings changed or this test expired. Test the camera again.')
						);
					const next: SavedCamera = {
						id: candidate.id,
						input: candidate.input,
						profiles: candidate.profiles,
						original: candidate.original,
						httpRemux: candidate.httpRemux,
						width: candidate.width,
						height: candidate.height
					};
					yield* sql`INSERT INTO camera_settings(id,revision,value) VALUES(1,${revision + 1},${JSON.stringify(next)}) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value`;
					const previous = saved;
					saved = next;
					revision++;
					connected = true;
					tested.delete(token);
					yield* camera.setManagedSource(source(next));
					if (client && previous)
						yield* attempt(() => client.remove(previous.profiles)).pipe(Effect.ignore);
					return status();
				}).pipe(lock.withPermits(1))
		};
	})
);
