import { createHash, randomUUID } from 'node:crypto';
import webpush from 'web-push';
import {
	Context,
	Data,
	Effect,
	Layer,
	Queue,
	Schedule,
	Semaphore,
	Stream,
	SubscriptionRef
} from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { receivesNotice, type NoticeAudience } from '#lib/domain/notice-audience.js';
import { jobOwner } from './job-attribution.js';
import { migrate } from './migrations.js';
import { PrinterService } from './printer-service.js';
import { CameraService } from './camera.js';
import {
	checkNoticePreferences,
	noticeTransition,
	quietNow,
	type Notice
} from '#lib/domain/notifications.js';
import type { PrinterSnapshot } from '#lib/domain/printer.js';
export class NotificationError extends Data.TaggedError('NotificationError')<{
	message: string;
	cause?: unknown;
}> {}
const failure = (message: string, cause?: unknown) => new NotificationError({ message, cause });
export interface PushActor {
	id: string;
	epoch: number;
}
export interface PushDevice {
	id: string;
	owner: string;
	epoch: number;
	subscription: string;
	preferences: string;
}
export class NotificationSettings extends Context.Service<
	NotificationSettings,
	{
		origin: string;
		valid: (actor: PushActor) => boolean;
		send?: (
			subscription: webpush.PushSubscription,
			payload: string,
			keys: { publicKey: string; privateKey: string }
		) => Promise<unknown>;
	}
>()('perilune/NotificationSettings') {}
export class NotificationService extends Context.Service<
	NotificationService,
	{
		publicKey: string;
		manage: (actor: PushActor, body: Record<string, unknown>) => Effect.Effect<unknown, unknown>;
		image: (
			actor: PushActor,
			id: string
		) => Effect.Effect<{ bytes: Uint8Array; mime: string } | undefined, unknown>;
	}
>()('perilune/NotificationService') {}
/** Endpoints are untrusted browser input. Never permit arbitrary outbound hosts/ports. */
export function checkPushSubscription(value: unknown): webpush.PushSubscription {
	if (!value || typeof value !== 'object') throw failure('Invalid push subscription.');
	const s = value as webpush.PushSubscription;
	const url = new URL(s.endpoint);
	const allowed =
		url.hostname === 'fcm.googleapis.com' ||
		url.hostname === 'updates.push.services.mozilla.com' ||
		url.hostname === 'push.services.mozilla.com' ||
		url.hostname === 'web.push.apple.com' ||
		/^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname) ||
		/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
	if (
		url.protocol !== 'https:' ||
		url.port ||
		url.username ||
		url.password ||
		url.hash ||
		!allowed ||
		s.endpoint.length > 2048 ||
		!s.keys ||
		!/^[\w-]{87}$/.test(s.keys.p256dh) ||
		!/^[\w-]{22}$/.test(s.keys.auth)
	)
		throw failure('This browser’s push provider is not supported.');
	return { endpoint: s.endpoint, keys: { auth: s.keys.auth, p256dh: s.keys.p256dh } };
}
export const NotificationServiceLive = Layer.effect(
	NotificationService,
	Effect.gen(function* () {
		const sql = yield* SqlClient;
		yield* migrate;
		const settings = yield* NotificationSettings;
		const printer = yield* PrinterService;
		const camera = yield* CameraService;
		const generated = webpush.generateVAPIDKeys();
		yield* sql`INSERT OR IGNORE INTO push_keys VALUES (1,${generated.publicKey},${generated.privateKey})`;
		const [stored] = yield* sql<{
			public_key: string;
			private_key: string;
		}>`SELECT * FROM push_keys WHERE id=1`;
		const keys = { publicKey: stored!.public_key, privateKey: stored!.private_key };
		const send =
			settings.send ??
			((subscription, payload, vapid) =>
				webpush.sendNotification(subscription, payload, {
					vapidDetails: { subject: settings.origin, ...vapid },
					TTL: 300,
					timeout: 8000,
					urgency: 'normal'
				}));
		const lock = yield* Semaphore.make(1);
		const authorize = (actor: PushActor) => {
			if (!settings.valid(actor)) throw failure('Please sign in again.');
		};
		const guard = <A>(f: () => A) =>
			Effect.try({
				try: f,
				catch: () =>
					failure('Invalid notification request. Check your subscription and preferences.')
			});
		type Capture = { bytes: Uint8Array; mime: string; ids: Map<string, string> };
		const capture = Effect.gen(function* () {
			const response = yield* camera.proxy(
				'snapshot',
				new Request(`${settings.origin}/api/camera/snapshot`)
			);
			const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
			if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) {
				yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve());
				return;
			}
			const bytes = yield* Effect.tryPromise(() => response.arrayBuffer()).pipe(
				Effect.catch(() => Effect.succeed(new ArrayBuffer(0)))
			);
			if (bytes.byteLength && bytes.byteLength <= 2_000_000)
				return { bytes: new Uint8Array(bytes), mime, ids: new Map<string, string>() };
		});
		const deliver = (
			device: PushDevice,
			notice: Notice,
			test = false,
			captured?: Capture,
			created = Date.now(),
			audience: NoticeAudience = { type: 'printer' }
		) =>
			Effect.gen(function* () {
				const [current] = yield* sql<PushDevice>`SELECT * FROM push_devices WHERE id=${device.id}`;
				if (!current || current.owner !== device.owner || current.epoch !== device.epoch) return;
				device = current;
				const actor = { id: device.owner, epoch: device.epoch };
				if (!settings.valid(actor)) {
					yield* sql`DELETE FROM push_devices WHERE id=${device.id}`;
					return;
				}
				const preferences = checkNoticePreferences(JSON.parse(device.preferences));
				if (
					!test &&
					(!receivesNotice(device.owner, notice.kind, audience, preferences) ||
						!preferences[notice.kind] ||
						quietNow(preferences, new Date(created)) ||
						quietNow(preferences) ||
						Date.now() - created > 60_000)
				)
					return;
				// Claim before sending: an ambiguous delivery is never blindly replayed after restart.
				const claimed =
					yield* sql`INSERT OR IGNORE INTO push_deliveries(event,device,created) VALUES(${notice.id},${device.id},${Date.now()}) RETURNING event`;
				if (!claimed.length) return;
				let image: string | undefined;
				if (preferences.snapshot && !test && captured) {
					const recipient = `${actor.id}:${actor.epoch}`;
					const id = captured.ids.get(recipient) ?? randomUUID();
					captured.ids.set(recipient, id);
					yield* sql`INSERT OR IGNORE INTO push_images VALUES(${id},${actor.id},${actor.epoch},${captured.bytes},${captured.mime},${Date.now() + 300_000})`;
					image = `/api/notifications?image=${id}`;
				}

				if (!settings.valid(actor)) return;
				yield* Effect.tryPromise({
					try: () =>
						send(JSON.parse(device.subscription), JSON.stringify({ ...notice, image }), keys),
					catch: (cause) => failure('Push delivery failed.', cause)
				}).pipe(
					Effect.catch((cause) =>
						Effect.gen(function* () {
							const source = cause.cause;
							const status =
								source && typeof source === 'object' && 'statusCode' in source
									? source.statusCode
									: null;
							if (status === 404 || status === 410)
								yield* sql`DELETE FROM push_devices WHERE id=${device.id}`;
							if (test)
								return yield* Effect.fail(
									failure('Push delivery failed. Try enabling notifications again.')
								);
						})
					)
				);
			});
		yield* Effect.gen(function* () {
			yield* sql`DELETE FROM push_images WHERE expires < ${Date.now()}`;
			yield* sql`DELETE FROM push_deliveries WHERE created < ${Date.now() - 7 * 86400_000}`;
			yield* sql`DELETE FROM push_devices WHERE updated < ${Date.now() - 180 * 86400_000}`;
		}).pipe(
			Effect.catch(() => Effect.void),
			Effect.repeat(Schedule.spaced('1 minute')),
			Effect.forkScoped
		);
		const events = yield* Queue.dropping<{
			notice: Notice;
			created: number;
			audience: NoticeAudience;
		}>(16);
		yield* Effect.addFinalizer(() => Queue.shutdown(events));
		let previous: PrinterSnapshot | undefined = yield* SubscriptionRef.get(printer.state);
		yield* SubscriptionRef.changes(printer.state).pipe(
			Stream.runForEach((next) =>
				Effect.gen(function* () {
					const notice = noticeTransition(previous, next);
					const active = previous && ['printing', 'paused'].includes(previous.job.state);
					const audience: NoticeAudience =
						notice && active
							? {
									type: 'job',
									owner: yield* jobOwner(previous!.job.runId, previous!.job.historyKey).pipe(
										Effect.provideService(SqlClient, sql),
										Effect.catch(() => Effect.succeed(null))
									)
								}
							: { type: 'printer' };
					// Do not infer a completion across a reconnect.
					previous = next.connection === 'connected' ? next : undefined;
					if (notice) yield* Queue.offer(events, { notice, created: Date.now(), audience });
				})
			),
			Effect.forkScoped
		);
		yield* Effect.gen(function* () {
			const { notice, created, audience } = yield* Queue.take(events);
			if (Date.now() - created > 60_000) return;
			const devices =
				yield* sql<PushDevice>`SELECT * FROM push_devices ORDER BY updated DESC LIMIT 200`;
			const needsCapture = devices.some((device) => {
				const p = checkNoticePreferences(JSON.parse(device.preferences));
				return (
					settings.valid({ id: device.owner, epoch: device.epoch }) &&
					receivesNotice(device.owner, notice.kind, audience, p) &&
					p.snapshot &&
					p[notice.kind] &&
					!quietNow(p, new Date(created)) &&
					!quietNow(p)
				);
			});
			const captured = needsCapture ? yield* capture : undefined;
			yield* Effect.forEach(
				devices,
				(device) =>
					deliver(device, notice, false, captured, created, audience).pipe(
						Effect.catch(() => Effect.logWarning('A device notification could not be delivered.'))
					),
				{ concurrency: 4, discard: true }
			);
		}).pipe(
			Effect.catch(() => Effect.logWarning('Notification event could not be delivered.')),
			Effect.forever,
			Effect.forkScoped
		);

		return {
			publicKey: keys.publicKey,
			manage: (actor, body) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						yield* guard(() => authorize(actor));
						const subscription = yield* guard(() => checkPushSubscription(body.subscription));
						const id = createHash('sha256').update(subscription.endpoint).digest('hex');
						const [existing] = yield* sql<PushDevice>`SELECT * FROM push_devices WHERE id=${id}`;
						if (existing && (existing.owner !== actor.id || existing.epoch !== actor.epoch)) {
							// A browser changing accounts must create a fresh browser subscription.
							return yield* Effect.fail(
								failure(
									'This device subscription belongs to another sign-in. Disable browser notifications, then enable them again.'
								)
							);
						}
						if (body.action === 'status')
							return {
								id: existing?.id,
								preferences: existing
									? checkNoticePreferences(JSON.parse(existing.preferences))
									: null
							};
						if (body.action === 'remove') {
							yield* sql`DELETE FROM push_devices WHERE id=${id} AND owner=${actor.id}`;
							return { ok: true };
						}
						if (body.action === 'test') {
							if (!existing) return yield* Effect.fail(failure('Enable notifications first.'));
							const recent =
								yield* sql`SELECT event FROM push_deliveries WHERE device=${id} AND created > ${Date.now() - 30_000}`;
							if (recent.length)
								return yield* Effect.fail(failure('Wait 30 seconds before another test.'));
							yield* deliver(
								existing,
								{
									id: randomUUID(),
									kind: 'complete',
									title: 'Perilune is in touch',
									body: 'Notifications are ready on this device.'
								},
								true
							);
							return { ok: true };
						}
						if (body.action !== 'save')
							return yield* Effect.fail(failure('Unknown notification action.'));
						const preferences = yield* guard(() => checkNoticePreferences(body.preferences));
						const count = yield* sql<{ total: number }>`SELECT COUNT(*) AS total FROM push_devices`;
						if (!existing && count[0]!.total >= 200)
							return yield* Effect.fail(
								failure('Device limit reached. Remove an existing notification subscription.')
							);
						yield* sql`INSERT INTO push_devices VALUES(${id},${actor.id},${actor.epoch},${subscription.endpoint},${JSON.stringify(subscription)},${JSON.stringify(preferences)},${Date.now()}) ON CONFLICT(id) DO UPDATE SET preferences=excluded.preferences,updated=excluded.updated`;
						return { id, preferences };
					})
				),
			image: (actor, id) =>
				Effect.gen(function* () {
					yield* guard(() => authorize(actor));
					const [image] = yield* sql<{
						bytes: Uint8Array;
						mime: string;
					}>`SELECT bytes,mime FROM push_images WHERE id=${id} AND owner=${actor.id} AND epoch=${actor.epoch} AND expires > ${Date.now()}`;
					return image;
				})
		};
	})
);
