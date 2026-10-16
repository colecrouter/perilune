import { printerAdmission, printerInterlock } from './printer-admission.js';
import { Context, Effect, Layer, Schedule, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { ActionStore } from './action-store.js';
import { ActionRejected, PrinterService } from './printer-service.js';
import { MoonrakerService } from './moonraker.js';
import { emptyMeshProbe, meshProbeActive, type MeshProbeState } from '#lib/domain/mesh-probe.js';
import { liveMeshReason, sameMesh } from '#lib/domain/live-mesh.js';
import type { CalibrationActor } from '#lib/domain/calibration.js';
import type {
	ActionRecord,
	ActionRequest,
	ActionStatus,
	PrinterSnapshot
} from '#lib/domain/printer.js';

export class LiveMeshService extends Context.Service<
	LiveMeshService,
	{
		submit: (
			request: ActionRequest,
			actor: CalibrationActor
		) => Effect.Effect<ActionRecord, ActionRejected>;
	}
>()('perilune/LiveMeshService') {}
export const LiveMeshDisabled = Layer.succeed(LiveMeshService, {
	submit: () => Effect.fail(new ActionRejected({ message: 'Live mesh commands are disabled.' }))
});
const canSaveProfile = (mesh: PrinterSnapshot['bedMesh']) =>
	mesh.omittedProfiles === 0 &&
	mesh.profiles.length < 32 &&
	mesh.active !== null &&
	mesh.profiles.reduce((sum, p) => sum + p.points.length * p.points[0].length, 0) +
		2 * mesh.active.points.length * mesh.active.points[0].length <=
		32768;
const runName = (id: string) => `perilune_${id.replaceAll('-', '')}`;
const authorized = (actor: CalibrationActor) =>
	['owner', 'operator'].includes(actor.role ?? '') && actor.authorized?.() !== false;

export const LiveMeshServiceLive = Layer.effect(
	LiveMeshService,
	Effect.gen(function* () {
		const printer = yield* PrinterService,
			transport = yield* MoonrakerService,
			store = yield* ActionStore,
			sql = yield* SqlClient;
		const lock = printerAdmission(printer.state);
		const interlock = printerInterlock(printer.state);
		const write = (mesh: MeshProbeState) =>
			sql`INSERT INTO live_mesh_workflow(id,state) VALUES(1,${JSON.stringify(mesh)}) ON CONFLICT(id) DO UPDATE SET state=excluded.state`.pipe(
				Effect.asVoid
			);
		const stored = yield* sql<{ state: string }>`SELECT state FROM live_mesh_workflow WHERE id=1`;
		let restored = stored[0] ? (JSON.parse(stored[0].state) as MeshProbeState) : emptyMeshProbe();
		if (meshProbeActive(restored))
			restored = {
				...restored,
				session: {
					...restored.session!,
					stage: 'uncertain',
					result: null,
					message:
						'Backend restarted. No command was replayed. Verify that the printer is stopped before clearing this workflow.'
				}
			};
		yield* write(restored);
		const update = (f: (s: PrinterSnapshot) => PrinterSnapshot) =>
			SubscriptionRef.update(printer.state, (s) => ({
				...f(s),
				revision: s.revision + 1,
				updatedAt: Date.now()
			}));
		yield* update((s) => ({ ...s, meshProbe: restored, actions: [] }));
		const history = yield* store.list;
		yield* update((s) => ({ ...s, actions: history }));
		const queue: Array<{
			request: ActionRequest;
			actor: CalibrationActor;
			action: ActionRecord;
			generation: number;
			epoch: number;
		}> = [];
		let working = false;
		const unwritten = new Map<string, { status: ActionStatus; message: string | null }>();
		let progress: { id: string; baseline: number; counts: Map<string, number> } | undefined;
		const finish = (
			action: ActionRecord,
			status: ActionStatus,
			message: string | null,
			mesh: MeshProbeState
		) =>
			Effect.gen(function* () {
				const saved = yield* sql
					.withTransaction(
						Effect.gen(function* () {
							yield* write(mesh);
							yield* store.setStatus(action.id, status, message);
						})
					)
					.pipe(Effect.result);
				if (saved._tag === 'Failure') {
					status = 'unknown';
					message = 'Storage failed after submission. No physical command will be retried.';
					unwritten.set(action.id, { status, message });
					mesh = {
						...mesh,
						session: mesh.session
							? { ...mesh.session, stage: 'uncertain', message, result: null }
							: null
					};
				}
				yield* update((s) => ({
					...s,
					storage: saved._tag === 'Failure' ? 'degraded' : s.storage,
					meshProbe: mesh,
					motion: { ...s.motion, calibration: meshProbeActive(mesh) },
					actions: s.actions.map((a) => (a.id === action.id ? { ...a, status, message } : a))
				}));
			});
		const process = (job: (typeof queue)[number]) =>
			Effect.gen(function* () {
				const { request, actor, action, generation } = job;
				let sent = false;
				const command = request.command;
				const initial = yield* SubscriptionRef.get(printer.state);
				const fail = (message: string) => Effect.fail(new ActionRejected({ message }));
				const dispatch = (operation: Parameters<typeof transport.command>[0]) =>
					Effect.gen(function* () {
						if (!authorized(actor))
							return yield* fail('The operator account is no longer authorized.');
						const outcome = yield* transport
							.command(
								operation,
								generation,
								() => interlock.allows(job.epoch) && authorized(actor)
							)
							.pipe(Effect.result);
						if (outcome._tag === 'Failure') {
							sent ||= outcome.failure.sent;
							return yield* fail('Printer command failed or its acknowledgement was lost.');
						}
						sent = true;
					});
				const outcome = yield* Effect.gen(function* () {
					if (Date.now() - action.createdAt >= 30000)
						return yield* fail('The queued command expired before dispatch.');
					if (!authorized(actor))
						return yield* fail('The operator account is no longer authorized.');
					const fresh = yield* transport
						.refresh(generation)
						.pipe(
							Effect.mapError(
								() =>
									new ActionRejected({ message: 'Fresh printer state could not be established.' })
							)
						);
					const snapshot = yield* SubscriptionRef.get(printer.state);
					const checked = {
						...snapshot,
						connection: fresh.connection,
						klippy: fresh.klippy,
						telemetryReady: fresh.telemetryReady,
						job: fresh.job,
						heaters: fresh.heaters,
						motion: fresh.motion,
						bedMesh: fresh.bedMesh,
						liveMesh: fresh.liveMesh,
						actions: snapshot.actions.filter((a) => a.id !== action.id)
					};
					const reason = liveMeshReason(checked, true);
					if (reason) return yield* fail(reason);
					if (fresh.motion.calibration) return yield* fail('Another probe calibration is active.');
					if (
						JSON.stringify(fresh.liveMesh.plan) !== JSON.stringify(snapshot.meshProbe.session?.plan)
					)
						return yield* fail('The probing configuration changed. Review a new plan.');
					yield* store.setStatus(action.id, 'sending', null);
					yield* update((s) => ({
						...s,
						actions: s.actions.map((a) => (a.id === action.id ? { ...a, status: 'sending' } : a))
					}));
					const session = (yield* SubscriptionRef.get(printer.state)).meshProbe.session!;
					if (command.type === 'meshProbeBegin') {
						const capacityReason = liveMeshReason({
							...checked,
							meshProbe: emptyMeshProbe(),
							motion: { ...checked.motion, calibration: false }
						});
						if (
							capacityReason ||
							fresh.bedMesh.profiles.some((p) => p.name === runName(session.id))
						)
							return yield* fail(
								capacityReason ?? 'This internal profile name already exists. Start a new run.'
							);
						if (
							(fresh.bedMesh.active &&
								!sameMesh(fresh.bedMesh.active, session.previousMesh ?? null)) ||
							(!fresh.bedMesh.active && session.previousMesh) ||
							(session.previousProfile &&
								!sameMesh(
									session.previousMesh ?? null,
									fresh.bedMesh.profiles.find((p) => p.name === session.previousProfile) ?? null
								))
						)
							return yield* fail(
								'The active or previous saved mesh changed before dispatch. Review a new run.'
							);
						if (!['x', 'y', 'z'].every((a) => fresh.motion.homed.includes(a as 'x' | 'y' | 'z')))
							yield* dispatch({ type: 'home' });
						let afterHome = yield* transport
							.refresh(generation)
							.pipe(
								Effect.mapError(() => new ActionRejected({ message: 'Could not verify homing.' }))
							);
						if (
							!['x', 'y', 'z'].every((a) => afterHome.motion.homed.includes(a as 'x' | 'y' | 'z'))
						)
							return yield* fail('Homing did not establish all axes.');
						for (let attempt = 0; afterHome.motion.busy && attempt < 10; attempt++) {
							yield* Effect.sleep('500 millis');
							afterHome = yield* transport
								.refresh(generation)
								.pipe(
									Effect.mapError(
										() =>
											new ActionRejected({ message: 'Could not verify idle state after homing.' })
									)
								);
						}
						if (
							(afterHome.bedMesh.active &&
								!sameMesh(afterHome.bedMesh.active, session.previousMesh ?? null)) ||
							(!afterHome.bedMesh.active && session.previousMesh) ||
							(session.previousProfile &&
								!sameMesh(
									session.previousMesh ?? null,
									afterHome.bedMesh.profiles.find((p) => p.name === session.previousProfile) ?? null
								))
						)
							return yield* fail(
								'The previous mesh changed during homing. Probing was not dispatched.'
							);
						if (
							afterHome.bedMesh.omittedProfiles > 0 ||
							afterHome.bedMesh.profiles.some((p) => p.name === runName(session.id))
						)
							return yield* fail(
								'The profile list changed during homing. Probing was not dispatched.'
							);
						if (afterHome.motion.calibration)
							return yield* fail(
								'Another probe calibration started during homing. Probing was not dispatched.'
							);
						const beforeProbe = {
							...checked,
							job: afterHome.job,
							heaters: afterHome.heaters,
							motion: afterHome.motion,
							bedMesh: afterHome.bedMesh,
							liveMesh: afterHome.liveMesh
						};
						const changed = liveMeshReason({
							...beforeProbe,
							meshProbe: emptyMeshProbe(),
							motion: { ...beforeProbe.motion, calibration: false }
						});
						if (changed || JSON.stringify(afterHome.liveMesh.plan) !== JSON.stringify(session.plan))
							return yield* fail(changed ?? 'The probing plan changed during homing.');
						progress = {
							id: session.id,
							baseline: afterHome.probeResponses.at(-1)?.sequence ?? 0,
							counts: new Map()
						};
						yield* dispatch({ type: 'probe', name: runName(session.id) });
						progress = undefined;
						const measured = yield* transport
							.refresh(generation)
							.pipe(
								Effect.mapError(
									() => new ActionRejected({ message: 'Could not verify the completed mesh.' })
								)
							);
						const mesh = measured.bedMesh.active,
							plan = session.plan!;
						if (
							!mesh ||
							mesh.name !== runName(session.id) ||
							JSON.stringify(mesh.min) !== JSON.stringify(plan.min) ||
							JSON.stringify(mesh.max) !== JSON.stringify(plan.max) ||
							mesh.points.length !== plan.rows ||
							mesh.points[0]?.length !== plan.columns
						)
							return yield* fail(
								'The acknowledged run did not produce the expected measured mesh.'
							);
						if (!authorized(actor))
							return yield* fail(
								'Authorization ended during probing. Verify the printer before clearing this workflow.'
							);
						return {
							...snapshot.meshProbe,
							session: {
								...session,
								stage: 'review' as const,
								result: mesh,
								completedSamples: plan.rows * plan.columns,
								message: 'Probing completed. Klipper has already activated this mesh.'
							}
						};
					}
					if (command.type === 'meshProbeCancel') {
						if (
							session.previousProfile &&
							!sameMesh(
								session.previousMesh ?? null,
								fresh.bedMesh.profiles.find((p) => p.name === session.previousProfile) ?? null
							)
						)
							return yield* fail(
								'The previous saved mesh changed. Review it before restoring manually.'
							);
						yield* dispatch({
							type: 'restore',
							name: session.previousProfile ?? null,
							remove: runName(session.id)
						});
						const measured = yield* transport
							.refresh(generation)
							.pipe(
								Effect.mapError(
									() => new ActionRejected({ message: 'Could not verify restoration.' })
								)
							);
						if (
							(session.previousProfile &&
								(measured.bedMesh.active?.name !== session.previousProfile ||
									!sameMesh(measured.bedMesh.active, session.previousMesh ?? null))) ||
							(!session.previousProfile && measured.bedMesh.active)
						)
							return yield* fail('Previous mesh restoration could not be verified.');
						return {
							...snapshot.meshProbe,
							session: {
								...session,
								stage: 'cancelled' as const,
								result: null,
								message: 'The previous mesh was restored. No configuration was written.'
							}
						};
					}
					if (command.type !== 'meshProbeFinish') return yield* fail('Unsupported live command.');
					if (
						!sameMesh(session.result, fresh.bedMesh.active) ||
						fresh.bedMesh.active?.name !== runName(session.id)
					)
						return yield* fail('The active mesh changed outside this workflow.');
					if (command.outcome === 'apply') {
						yield* dispatch({ type: 'keep', remove: runName(session.id) });
						const measured = yield* transport
							.refresh(generation)
							.pipe(
								Effect.mapError(
									() => new ActionRejected({ message: 'Could not verify temporary mesh.' })
								)
							);
						if (!sameMesh(measured.bedMesh.active, session.result))
							return yield* fail('Temporary application could not be verified.');
						return {
							...snapshot.meshProbe,
							session: {
								...session,
								stage: 'applied' as const,
								message:
									'The mesh remains active until Klipper restarts or another mesh is loaded. Your start macro may load a different profile.'
							}
						};
					}
					// SAVE_CONFIG deliberately restarts Klipper. Lost acknowledgement is expected but never replayed.
					yield* update((s) => ({
						...s,
						meshProbe: {
							...s.meshProbe,
							session: {
								...session,
								stage: 'saving',
								message: 'Writing pending configuration and waiting for Klipper to restart.'
							}
						}
					}));
					if (!authorized(actor))
						return yield* fail('The operator account is no longer authorized.');
					const latest = yield* transport
						.refresh(generation)
						.pipe(
							Effect.mapError(
								() => new ActionRejected({ message: 'Could not revalidate profile storage.' })
							)
						);
					if (
						!canSaveProfile(latest.bedMesh) ||
						latest.bedMesh.profiles.some(
							(p) => p.name.toLowerCase() === command.name!.toLowerCase()
						) ||
						!sameMesh(latest.bedMesh.active, session.result) ||
						latest.motion.busy !== false ||
						latest.job.state === 'printing' ||
						latest.job.state === 'paused'
					)
						return yield* fail('The printer or profile storage changed. Nothing was saved.');
					const saveResult = yield* transport
						.command({ type: 'save', name: command.name!, remove: runName(session.id) }, generation)
						.pipe(Effect.result);
					sent ||= saveResult._tag === 'Success' || saveResult.failure.sent;
					if (!sent) return yield* fail('Save was not dispatched.');
					const deadline = Date.now() + 90000;
					while (Date.now() < deadline) {
						const current = yield* SubscriptionRef.get(transport.state);
						if (
							current.generation !== generation &&
							current.connection === 'connected' &&
							current.klippy === 'ready' &&
							current.telemetryReady
						) {
							const verified = yield* transport.refresh(current.generation).pipe(Effect.result);
							if (
								verified._tag === 'Success' &&
								!verified.success.liveMesh.pendingConfig &&
								sameMesh(
									verified.success.bedMesh.profiles.find((p) => p.name === command.name) ?? null,
									session.result
								)
							)
								return {
									...snapshot.meshProbe,
									session: {
										...session,
										stage: 'saved' as const,
										message: `Saved ${command.name} and verified it after Klipper restarted. Your start macro must load this profile to use it.`
									}
								};
						}
						yield* Effect.sleep('500 millis');
					}
					return yield* fail(
						'The saved profile could not be verified after restart. Do not repeat the save automatically.'
					);
				}).pipe(Effect.result);
				progress = undefined;
				if (outcome._tag === 'Success') yield* finish(action, 'completed', null, outcome.success);
				else {
					const current = yield* SubscriptionRef.get(printer.state);
					const message = sent
						? `${outcome.failure.message} Outcome is uncertain; no command was replayed. Verify that movement has stopped before restoring the previous mesh.`
						: outcome.failure.message;
					const mesh = {
						...current.meshProbe,
						session: current.meshProbe.session
							? {
									...current.meshProbe.session,
									stage: sent
										? ('uncertain' as const)
										: command.type === 'meshProbeBegin'
											? ('interrupted' as const)
											: initial.meshProbe.session!.stage,
									result:
										sent || command.type === 'meshProbeBegin'
											? null
											: initial.meshProbe.session!.result,
									message
								}
							: null
					};
					yield* finish(action, sent ? 'unknown' : 'failed', message, mesh);
				}
			});
		yield* Effect.gen(function* () {
			if (working || !queue.length) return;
			working = true;
			const job = queue.shift()!;
			yield* process(job).pipe(
				Effect.catchCause(() =>
					Effect.gen(function* () {
						const current = yield* SubscriptionRef.get(printer.state);
						const mesh = {
							...current.meshProbe,
							session: current.meshProbe.session
								? {
										...current.meshProbe.session,
										stage: 'uncertain' as const,
										result: null,
										message:
											'Unexpected backend failure. Verify the printer has stopped; no command was replayed.'
									}
								: null
						};
						yield* finish(
							job.action,
							'unknown',
							'Unexpected backend failure. No command was replayed.',
							mesh
						);
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						working = false;
					})
				)
			);
		}).pipe(Effect.repeat(Schedule.spaced('100 millis')), Effect.forkScoped);
		yield* Effect.gen(function* () {
			if (!unwritten.size || working) return;
			const snapshot = yield* SubscriptionRef.get(printer.state);
			const repaired = yield* sql
				.withTransaction(
					Effect.gen(function* () {
						yield* write(snapshot.meshProbe);
						for (const [id, record] of unwritten)
							yield* store.setStatus(id, record.status, record.message);
					})
				)
				.pipe(Effect.result);
			if (repaired._tag === 'Success') {
				unwritten.clear();
				yield* update((s) => ({ ...s, storage: 'healthy' }));
			}
		}).pipe(Effect.repeat(Schedule.spaced('1 second')), Effect.forkScoped);
		// Progress is independently observed while the dispatch worker awaits long acknowledgements.
		yield* Effect.gen(function* () {
			if (!progress) return;
			const telemetry = yield* SubscriptionRef.get(transport.state),
				snapshot = yield* SubscriptionRef.get(printer.state);
			const session = snapshot.meshProbe.session,
				plan = session?.plan;
			if (!session || session.id !== progress.id || !plan) return;
			for (const p of telemetry.probeResponses) {
				if (p.sequence <= progress.baseline) continue;
				progress.baseline = p.sequence;
				const col = Math.round(
					((p.x + (p.space === 'probe' ? 0 : plan.offset[0]) - plan.min[0]) /
						(plan.max[0] - plan.min[0])) *
						(plan.columns - 1)
				);
				const row = Math.round(
					((p.y + (p.space === 'probe' ? 0 : plan.offset[1]) - plan.min[1]) /
						(plan.max[1] - plan.min[1])) *
						(plan.rows - 1)
				);
				if (col < 0 || col >= plan.columns || row < 0 || row >= plan.rows) continue;
				const x =
						plan.min[0] +
						(col * (plan.max[0] - plan.min[0])) / (plan.columns - 1) -
						(p.space === 'probe' ? 0 : plan.offset[0]),
					y =
						plan.min[1] +
						(row * (plan.max[1] - plan.min[1])) / (plan.rows - 1) -
						(p.space === 'probe' ? 0 : plan.offset[1]);
				if (Math.abs(x - p.x) > 0.05 || Math.abs(y - p.y) > 0.05) continue;
				const key = `${col},${row}`;
				progress.counts.set(key, (progress.counts.get(key) ?? 0) + 1);
			}
			const completed = [...progress.counts.values()].filter((n) => n >= plan.samples).length;
			yield* update((s) => ({
				...s,
				meshProbe: {
					...s.meshProbe,
					session:
						s.meshProbe.session?.id === session.id
							? { ...s.meshProbe.session, completedSamples: completed }
							: s.meshProbe.session
				}
			}));
		}).pipe(Effect.repeat(Schedule.spaced('200 millis')), Effect.forkScoped);
		return {
			submit: (request, actor) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						const existing = yield* store.find(request.id);
						if (existing) {
							if (
								existing.payload !== JSON.stringify(request.command) ||
								existing.actorId !== actor.id
							)
								return yield* Effect.fail(
									new ActionRejected({
										message: 'Action ID belongs to another command or account.'
									})
								);
							return existing.action;
						}
						const snapshot = yield* SubscriptionRef.get(printer.state),
							command = request.command;
						const reject = (message: string) => Effect.fail(new ActionRejected({ message }));
						if (!authorized(actor)) return yield* reject('An authorized operator is required.');
						if (interlock.halted) return yield* reject('Emergency stop interlock is active.');
						if (!command.type.startsWith('meshProbe'))
							return yield* reject(
								'Only the reviewed bed mesh workflow is enabled for live commands.'
							);
						if (
							working ||
							queue.length ||
							snapshot.actions.some((a) => ['queued', 'sending'].includes(a.status))
						)
							return yield* reject('Another action is pending.');
						const reason = liveMeshReason(snapshot, command.type !== 'meshProbeBegin');
						if (reason) return yield* reject(reason);
						const telemetry = yield* SubscriptionRef.get(transport.state);
						let mesh = snapshot.meshProbe;
						if (command.type === 'meshProbeBegin') {
							if (snapshot.bedMesh.profiles.some((p) => p.name === runName(command.probeId)))
								return yield* reject('This internal profile name already exists. Start a new run.');
							if (!command.confirmed || command.probeId !== request.id)
								return yield* reject('Confirm the reviewed plan with a unique run ID.');
							const previous = snapshot.bedMesh.active;
							if (
								previous &&
								(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(previous.name) ||
									!sameMesh(
										previous,
										snapshot.bedMesh.profiles.find((p) => p.name === previous.name) ?? null
									))
							)
								return yield* reject(
									'The active mesh is not a restorable saved profile. Load a saved profile or clear it first.'
								);
							mesh = {
								...mesh,
								session: {
									id: command.probeId,
									ownerId: actor.id,
									ownerName: actor.name,
									stage: 'probing',
									live: true,
									plan: snapshot.liveMesh.plan!,
									previousProfile: previous?.name ?? null,
									previousMesh: previous,
									completedSamples: 0,
									startedAt: Date.now(),
									expiresAt: Date.now() + 600000,
									result: null,
									message: null
								}
							};
						} else if (command.type === 'meshProbeFinish' || command.type === 'meshProbeCancel') {
							const session = mesh.session;
							if (!session || command.probeId !== session.id || !meshProbeActive(mesh))
								return yield* reject('This workflow changed. Review the current run.');
							const force =
								command.type === 'meshProbeCancel' && command.force && actor.role === 'owner';
							if (session.ownerId !== actor.id && !force)
								return yield* reject('This workflow belongs to another operator.');
							if (command.type === 'meshProbeCancel') {
								if (!command.confirmed || !['review', 'uncertain'].includes(session.stage))
									return yield* reject(
										'Probing cannot be cancelled through the normal command queue. Wait for completion or use the printer emergency stop.'
									);
								if (telemetry.motion.busy !== false || telemetry.motion.calibration)
									return yield* reject(
										'Verify the printer has stopped before restoring the previous mesh.'
									);
							} else {
								if (
									session.stage !== 'review' ||
									!session.result ||
									session.expiresAt <= Date.now()
								)
									return yield* reject('The mesh result is unavailable or its review expired.');
								if (command.outcome === 'save' && !canSaveProfile(snapshot.bedMesh))
									return yield* reject(
										'The full profile list could not be verified. No profile can be safely saved.'
									);
								if (
									command.outcome === 'save' &&
									(!command.name ||
										!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(command.name) ||
										command.name === 'default' ||
										command.name.startsWith('perilune_') ||
										snapshot.bedMesh.profiles.some(
											(p) => p.name.toLowerCase() === command.name!.toLowerCase()
										))
								)
									return yield* reject(
										'Choose a new profile name using letters, numbers, underscores or hyphens. Default and internal names are reserved.'
									);
							}
						}
						const action: ActionRecord = {
							id: request.id,
							label:
								command.type === 'meshProbeBegin'
									? 'Probe live bed mesh'
									: command.type === 'meshProbeCancel'
										? 'Restore previous bed mesh'
										: command.type === 'meshProbeFinish' && command.outcome === 'save'
											? 'Save pending configuration and restart'
											: 'Keep temporary bed mesh',
							status: 'queued',
							createdAt: Date.now(),
							message: null
						};
						const stored = yield* sql
							.withTransaction(
								Effect.gen(function* () {
									yield* store.insert(action, command, actor.id);
									yield* write(mesh);
								})
							)
							.pipe(Effect.result);
						if (stored._tag === 'Failure')
							return yield* reject('Could not persist the command. Nothing was dispatched.');
						yield* update((s) => ({
							...s,
							meshProbe: mesh,
							motion: { ...s.motion, calibration: true },
							actions: [action, ...s.actions].slice(0, 20)
						}));
						queue.push({
							request,
							actor,
							action,
							generation: telemetry.generation,
							epoch: interlock.epoch
						});
						return action;
					}).pipe(
						Effect.mapError((cause) =>
							cause instanceof ActionRejected
								? cause
								: new ActionRejected({ message: 'Action storage failed.' })
						),
						Effect.uninterruptible
					)
				)
		};
	})
);
