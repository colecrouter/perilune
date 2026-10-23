import { MeshPersistence } from './mesh-persistence.js';
import { Option } from 'effect';
import { filamentChangeActive } from '#lib/domain/filament-change.js';
import { printerAdmission, printerInterlock } from './printer-admission.js';
import { Context, Effect, Layer, Schedule, SubscriptionRef } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { ActionStore } from './action-store.js';
import { ActionRejected, PrinterService } from './printer-service.js';
import { MoonrakerService } from './moonraker.js';
import { emptyMeshProbe, meshProbeActive, type MeshProbeState } from '#lib/domain/mesh-probe.js';
import { liveMeshReason, meshProfileReason, sameMesh } from '#lib/domain/live-mesh.js';
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
		const persistence = Option.getOrUndefined(yield* Effect.serviceOption(MeshPersistence));
		const configActor = (actor: CalibrationActor) => ({
			id: actor.id,
			name: actor.name,
			authorized: () => actor.role === 'owner' && authorized(actor)
		});
		const evidenceError = (e: Error) => new ActionRejected({ message: e.message });
		const targetName = (session: NonNullable<MeshProbeState['session']>) =>
			session.usual && !session.newProfile ? (session.target ?? 'default') : runName(session.id);
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
					result: restored.session!.result,
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
						session: mesh.session ? { ...mesh.session, stage: 'uncertain', message } : null
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
						if (!authorized(actor) || Date.now() - action.createdAt >= 30000)
							return yield* fail('Authorization ended or the queued action expired.');
						const outcome = yield* transport
							.command(
								operation,
								generation,
								() =>
									interlock.allows(job.epoch) &&
									authorized(actor) &&
									Date.now() - action.createdAt < 30000
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
					if (filamentChangeActive(snapshot.filamentChange))
						return yield* fail('Finish filament-change guidance first.');
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
					const reason =
						command.type === 'meshProbeProfile' || command.type === 'meshProbeReconcile'
							? meshProfileReason(checked, true)
							: liveMeshReason(checked, true);
					if (reason) return yield* fail(reason);
					if (fresh.motion.calibration) return yield* fail('Another probe calibration is active.');
					if (
						command.type !== 'meshProbeProfile' &&
						command.type !== 'meshProbeReconcile' &&
						JSON.stringify(fresh.liveMesh.plan) !== JSON.stringify(snapshot.meshProbe.session?.plan)
					)
						return yield* fail('The probing configuration changed. Review a new plan.');
					yield* store.setStatus(action.id, 'sending', null);
					yield* update((s) => ({
						...s,
						actions: s.actions.map((a) => (a.id === action.id ? { ...a, status: 'sending' } : a))
					}));
					const session = (yield* SubscriptionRef.get(printer.state)).meshProbe.session!;
					if (command.type === 'meshProbeReconcile') {
						let message = '';
						if (session.operation === 'load' || session.operation === 'clear') {
							if (
								session.operation === 'clear'
									? fresh.bedMesh.active !== null
									: !sameMesh(fresh.bedMesh.active, session.result) ||
										fresh.bedMesh.active?.name !== session.result?.name
							)
								return yield* fail(
									'Current compensation does not match the recorded operation. Verify it manually before recovery.'
								);
							message = 'Current compensation verified through a read-only check.';
						} else {
							if (!persistence) return yield* fail('Persistence verification is unavailable.');
							const resolution = yield* persistence
								.reconcile(session.id, configActor(actor))
								.pipe(Effect.mapError(evidenceError));
							if (
								session.newProfile &&
								session.discardStarted &&
								resolution === 'discarded' &&
								(session.previousMesh
									? !sameMesh(fresh.bedMesh.active, session.previousMesh)
									: fresh.bedMesh.active !== null)
							)
								return yield* fail(
									'Saved configuration is restored, but previous compensation still needs restoration. Choose Restore previous compensation; no command was replayed.'
								);
							message =
								resolution === 'saved'
									? 'Saved outcome verified through read-only reconciliation.'
									: 'Previous saved configuration verified. No printer command was replayed; choose a saved mesh to activate if needed.';
						}
						return {
							...snapshot.meshProbe,
							session: { ...session, stage: 'saved' as const, message }
						};
					}

					if (command.type === 'meshProbeProfile') {
						const target =
							command.operation === 'clear'
								? fresh.bedMesh.active
								: fresh.bedMesh.profiles.find((p) => p.name === command.name);
						if (JSON.stringify(target ?? null) !== command.expected)
							return yield* fail('The selected mesh changed before execution. Review it again.');
						if (command.operation === 'delete') {
							if (
								!persistence ||
								!target ||
								actor.role !== 'owner' ||
								fresh.bedMesh.active?.name === target.name
							)
								return yield* fail('Only an owner can delete an unused named mesh.');
							yield* persistence
								.capture(session.id, configActor(actor), target)
								.pipe(Effect.mapError(evidenceError));
							yield* persistence
								.prepareRemoval(session.id, configActor(actor), target.name)
								.pipe(Effect.mapError(evidenceError));
							yield* dispatch({ type: 'remove', name: target.name });
							yield* persistence
								.finish(
									session.id,
									configActor(actor),
									target,
									[],
									false,
									() =>
										interlock.allows(job.epoch) &&
										authorized(actor) &&
										Date.now() - action.createdAt < 30000,
									[target.name]
								)
								.pipe(Effect.mapError(evidenceError));
						} else {
							yield* dispatch({
								type: 'load',
								name: command.operation === 'clear' ? null : command.name!
							});
							const measured = yield* transport
								.refresh(generation)
								.pipe(
									Effect.mapError(
										() => new ActionRejected({ message: 'Could not verify active mesh.' })
									)
								);
							if (
								command.operation === 'clear'
									? measured.bedMesh.active !== null
									: !sameMesh(measured.bedMesh.active, target ?? null) ||
										measured.bedMesh.active?.name !== command.name
							)
								return yield* fail('Mesh activation could not be verified.');
						}
						return {
							...snapshot.meshProbe,
							session: {
								...session,
								stage: 'saved' as const,
								message:
									command.operation === 'delete'
										? 'Saved mesh deleted and verified after restart.'
										: command.operation === 'clear'
											? 'Mesh compensation cleared. Saved meshes are unchanged.'
											: 'Saved mesh is active now. Your print-start procedure may select a different mesh.'
							}
						};
					}

					if (command.type === 'meshProbeBegin') {
						const capacityReason = liveMeshReason({
							...checked,
							meshProbe: emptyMeshProbe(),
							motion: { ...checked.motion, calibration: false }
						});
						if (
							capacityReason ||
							((!session.usual || session.newProfile) &&
								fresh.bedMesh.profiles.some((p) => p.name === targetName(session)))
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
							((!session.usual || session.newProfile) &&
								afterHome.bedMesh.profiles.some((p) => p.name === targetName(session)))
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
						if (session.usual) {
							const existing =
								afterHome.bedMesh.profiles.find((p) => p.name === targetName(session)) ?? null;
							if (JSON.stringify(existing) !== JSON.stringify(session.previousTarget ?? null))
								return yield* fail('The replacement target changed before probing.');
							if (!persistence) return yield* fail('Mesh persistence is unavailable.');
							yield* persistence
								.capture(
									session.id,
									configActor(actor),
									session.previousMesh ?? null,
									session.previousTarget ?? null,
									targetName(session)
								)
								.pipe(Effect.mapError(evidenceError));
						}
						yield* dispatch({ type: 'probe', name: targetName(session) });
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
							mesh.name !== targetName(session) ||
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
						if (session.usual) {
							if (!persistence || !session.result)
								return yield* fail(
									'Recovery needs the recorded candidate. Review pending configuration manually; no restart was sent.'
								);
							let restoreOnly = false;
							if (session.newProfile) {
								const resolution = yield* persistence
									.reconcile(session.id, configActor(actor))
									.pipe(Effect.result);
								restoreOnly = resolution._tag === 'Success' && resolution.success === 'discarded';
							}
							if (!restoreOnly) {
								yield* persistence
									.check(
										session.id,
										configActor(actor),
										session.result,
										[targetName(session), ...(session.copyName ? [session.copyName] : [])],
										undefined,
										session.newProfile ? 'all' : true
									)
									.pipe(Effect.mapError(evidenceError));
								const discarding = {
									...snapshot.meshProbe,
									session: { ...session, discardStarted: true }
								};
								yield* write(discarding);
								yield* update((s) => ({ ...s, meshProbe: discarding }));
								sent = true;
								yield* persistence
									.finish(
										session.id,
										configActor(actor),
										session.result,
										[targetName(session), ...(session.copyName ? [session.copyName] : [])],
										true,
										() =>
											interlock.allows(job.epoch) &&
											authorized(actor) &&
											Date.now() - action.createdAt < 30000
									)
									.pipe(Effect.mapError(evidenceError));
							}
							const restorationDeadline = Date.now() + 30000;
							const resumed = yield* SubscriptionRef.get(transport.state);
							sent = true;
							yield* transport
								.command(
									{ type: 'load', name: session.previousProfile ?? null },
									resumed.generation,
									() =>
										interlock.allows(job.epoch) &&
										authorized(actor) &&
										Date.now() < restorationDeadline
								)
								.pipe(
									Effect.mapError(
										() =>
											new ActionRejected({
												message: 'Previous mesh activation could not be verified.'
											})
									)
								);
							const restored = yield* transport
								.refresh(resumed.generation)
								.pipe(
									Effect.mapError(
										() => new ActionRejected({ message: 'Could not verify restoration.' })
									)
								);
							if (
								session.previousMesh
									? !sameMesh(restored.bedMesh.active, session.previousMesh)
									: restored.bedMesh.active !== null
							)
								return yield* fail('Previous active mesh was not restored.');
							return {
								...snapshot.meshProbe,
								session: {
									...session,
									stage: 'cancelled' as const,
									result: null,
									message:
										'Calibration discarded. Saved configuration is unchanged; the previous active mesh was restored after restart.'
								}
							};
						}
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
							remove: targetName(session)
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
						fresh.bedMesh.active?.name !== targetName(session)
					)
						return yield* fail('The active mesh changed outside this workflow.');
					if (session.usual) {
						if (command.outcome !== 'save' || !persistence || !session.result)
							return yield* fail('Save the reviewed mesh, or discard it.');
						if (!session.newProfile && command.name !== undefined)
							return yield* fail('Replacement keeps its existing name.');
						if (session.newProfile && !command.name)
							return yield* fail('Choose a unique name for the new mesh.');
						yield* persistence
							.check(session.id, configActor(actor), session.result, [targetName(session)])
							.pipe(Effect.mapError(evidenceError));
						const names = [targetName(session)];
						if (session.newProfile && command.name) {
							yield* persistence
								.prepareName(session.id, configActor(actor), command.name)
								.pipe(Effect.mapError(evidenceError));
							if (
								fresh.bedMesh.profiles.some(
									(p) => p.name.toLowerCase() === command.name!.toLowerCase()
								)
							)
								return yield* fail('The named mesh already exists. Choose another name.');
							const staged = {
								...snapshot.meshProbe,
								session: { ...session, copyName: command.name }
							};
							yield* write(staged);
							yield* update((s) => ({ ...s, meshProbe: staged }));
							yield* dispatch({ type: 'copy', name: command.name });
							yield* dispatch({ type: 'remove', name: targetName(session) });
							const removed = yield* transport
								.refresh(generation)
								.pipe(
									Effect.mapError(
										() =>
											new ActionRejected({ message: 'Could not verify temporary profile cleanup.' })
									)
								);
							if (removed.bedMesh.profiles.some((p) => p.name === targetName(session)))
								return yield* fail('Temporary profile remains. No configuration save was sent.');
							names.splice(0, names.length, command.name);
						}
						// Persist the candidate before the single restart boundary, retaining evidence on failure.
						yield* write({
							...snapshot.meshProbe,
							session: { ...session, copyName: command.name, stage: 'saving' }
						});
						sent = true;
						yield* persistence
							.finish(
								session.id,
								configActor(actor),
								session.result,
								names,
								false,
								() =>
									interlock.allows(job.epoch) &&
									authorized(actor) &&
									Date.now() - action.createdAt < 30000
							)
							.pipe(Effect.mapError(evidenceError));
						return {
							...snapshot.meshProbe,
							session: {
								...session,
								stage: 'saved' as const,
								message: session.newProfile
									? `Saved ${command.name} and verified after restart. Existing saved meshes are unchanged.`
									: 'Replacement saved and verified after restart. Existing print-start configuration is unchanged.'
							}
						};
					}
					if (command.outcome === 'apply') {
						yield* dispatch({ type: 'keep', remove: targetName(session) });
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
						.command({ type: 'save', name: command.name!, remove: targetName(session) }, generation)
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
										: command.type === 'meshProbeBegin' || command.type === 'meshProbeProfile'
											? ('interrupted' as const)
											: initial.meshProbe.session!.stage,
									result: current.meshProbe.session.result,
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
										result: current.meshProbe.session.result,
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
						if (filamentChangeActive(snapshot.filamentChange))
							return yield* reject('Finish filament-change guidance first.');
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
						const reason =
							command.type === 'meshProbeReconcile'
								? meshProfileReason(snapshot, true)
								: command.type === 'meshProbeProfile'
									? meshProfileReason(snapshot)
									: liveMeshReason(snapshot, command.type !== 'meshProbeBegin');
						if (reason) return yield* reject(reason);
						const telemetry = yield* SubscriptionRef.get(transport.state);
						let mesh = snapshot.meshProbe;
						if (command.type === 'meshProbeReconcile') {
							if (
								actor.role !== 'owner' ||
								!command.confirmed ||
								mesh.session?.id !== command.probeId ||
								mesh.session.stage !== 'uncertain'
							)
								return yield* reject('An owner must review the current uncertain mesh workflow.');
						} else if (command.type === 'meshProbeProfile') {
							const target =
								command.operation === 'clear'
									? snapshot.bedMesh.active
									: snapshot.bedMesh.profiles.find((p) => p.name === command.name);
							if (
								!command.confirmed ||
								command.probeId !== request.id ||
								JSON.stringify(target ?? null) !== command.expected ||
								(command.operation !== 'clear' &&
									(!target || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(target.name)))
							)
								return yield* reject('Review the current saved mesh with a unique action ID.');
							if (
								command.operation === 'delete' &&
								(actor.role !== 'owner' ||
									snapshot.bedMesh.active?.name === target?.name ||
									!persistence)
							)
								return yield* reject(
									'An owner can delete unused named meshes. Clear or replace the active mesh first; check print-start references before deletion.'
								);
							mesh = {
								...mesh,
								session: {
									id: command.probeId,
									ownerId: actor.id,
									ownerName: actor.name,
									stage: 'saving',
									operation: command.operation,
									live: true,
									completedSamples: 0,
									startedAt: Date.now(),
									expiresAt: Date.now() + 600000,
									result: target ?? null,
									message: 'Updating the selected mesh.'
								}
							};
						} else if (command.type === 'meshProbeBegin') {
							if (snapshot.bedMesh.profiles.some((p) => p.name === runName(command.probeId)))
								return yield* reject('This internal profile name already exists. Start a new run.');
							if (
								command.usual &&
								(actor.role !== 'owner' || !persistence || snapshot.liveMesh.pendingConfig)
							)
								return yield* reject(
									'An owner and no pending configuration changes are required for usual-mesh calibration.'
								);
							if (
								command.newProfile &&
								(!command.usual ||
									command.target !== undefined ||
									command.expectedTarget !== undefined)
							)
								return yield* reject(
									'New calibration has no replacement target and requires owner-managed persistence.'
								);
							if (
								command.usual &&
								!command.newProfile &&
								((command.target && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(command.target)) ||
									command.expectedTarget !==
										JSON.stringify(
											snapshot.bedMesh.profiles.find(
												(p) => p.name === (command.target ?? 'default')
											) ?? null
										))
							)
								return yield* reject(
									'The replacement target changed. Review the saved mesh again.'
								);
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
									usual: command.usual,
									newProfile: command.newProfile,
									target: command.target,
									previousTarget: command.newProfile
										? null
										: (snapshot.bedMesh.profiles.find(
												(p) => p.name === (command.target ?? 'default')
											) ?? null),
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
								if (
									command.outcome === 'save' &&
									session.usual &&
									!session.newProfile &&
									command.name !== undefined
								)
									return yield* reject('Replacement keeps its existing name.');
								if (command.outcome === 'save' && session.newProfile && !command.name)
									return yield* reject('Choose a name for the new mesh.');
								if (command.outcome === 'save' && !canSaveProfile(snapshot.bedMesh))
									return yield* reject(
										'The full profile list could not be verified. No profile can be safely saved.'
									);
								if (
									command.outcome === 'save' &&
									(!(command.name || session.usual) ||
										(command.name !== undefined &&
											!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(command.name)) ||
										command.name?.toLowerCase() === 'default' ||
										command.name?.toLowerCase().startsWith('perilune_') ||
										(command.name !== undefined &&
											snapshot.bedMesh.profiles.some(
												(p) => p.name.toLowerCase() === command.name!.toLowerCase()
											)))
								)
									return yield* reject(
										'Choose a new profile name using letters, numbers, underscores or hyphens. Default and internal names are reserved.'
									);
							}
						}
						const action: ActionRecord = {
							id: request.id,
							label:
								command.type === 'meshProbeProfile'
									? command.operation === 'delete'
										? 'Delete saved mesh and restart'
										: command.operation === 'clear'
											? 'Clear active mesh'
											: 'Load saved mesh'
									: command.type === 'meshProbeBegin'
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
