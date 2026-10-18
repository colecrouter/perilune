import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from 'effect';
import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import { SqlClient } from 'effect/sql/SqlClient';
import {
	NotificationService,
	NotificationServiceLive,
	NotificationSettings,
	checkPushSubscription
} from './notification-service.js';
import { PrinterService, PrinterServiceLive } from './printer-service.js';
import { ActionStoreLive } from './action-store.js';
import { CameraService, CameraConfig, CameraServiceLive } from './camera.js';
import { recordJobOwner } from './job-attribution.js';
import { defaultNoticePreferences } from '#lib/domain/notifications.js';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});
const subscription = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/fixture',
	keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }
};
async function fixture() {
	let valid = true;
	const send = vi.fn(async (_subscription: unknown, _payload: string) => {});
	const db = SqliteClient.layer({ filename: ':memory:' });
	const printer = PrinterServiceLive.pipe(Layer.provide(ActionStoreLive.pipe(Layer.provide(db))));
	const capture = vi.fn(() =>
		Effect.succeed(
			new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } })
		)
	);
	const camera = Layer.effect(
		CameraService,
		Effect.map(CameraService, (service) => ({ ...service, proxy: capture }))
	).pipe(
		Layer.provide(
			CameraServiceLive.pipe(Layer.provide(Layer.succeed(CameraConfig, { baseUrl: '' })))
		)
	);
	const runtime = ManagedRuntime.make(
		NotificationServiceLive.pipe(
			Layer.provideMerge(printer),
			Layer.provide(camera),
			Layer.provideMerge(db),
			Layer.provide(
				Layer.succeed(NotificationSettings, {
					origin: 'https://printer.example',
					valid: () => valid,
					send
				})
			)
		)
	);
	cleanups.push(() => runtime.dispose());
	const service = await runtime.runPromise(NotificationService);
	const state = (await runtime.runPromise(PrinterService)).state;
	const actor = { id: 'owner', epoch: 0 };
	const manage = (action: string, preferences = defaultNoticePreferences) =>
		runtime.runPromise(service.manage(actor, { action, subscription, preferences }));
	await manage('save');
	const initial = await runtime.runPromise(SubscriptionRef.get(state));
	await runtime.runPromise(recordJobOwner(initial.job.runId!, 'fixture-start', actor.id));
	return {
		runtime,
		service,
		state,
		manage,
		capture,
		register: (id: string, account: string, preferences = defaultNoticePreferences) =>
			runtime.runPromise(
				service.manage(
					{ id: account, epoch: 0 },
					{
						action: 'save',
						subscription: { ...subscription, endpoint: subscription.endpoint + id },
						preferences
					}
				)
			),
		send,
		actor,
		revoke: () => {
			valid = false;
		}
	};
}
it('rejects private, lookalike, credentialed and non-HTTPS push destinations', () => {
	for (const endpoint of [
		'http://fcm.googleapis.com/x',
		'https://127.0.0.1/x',
		'https://fcm.googleapis.com.evil.test/x',
		'https://user:pass@fcm.googleapis.com/x',
		'https://fcm.googleapis.com:444/x'
	])
		expect(() => checkPushSubscription({ ...subscription, endpoint })).toThrow();
	expect(checkPushSubscription(subscription).endpoint).toBe(subscription.endpoint);
});
it('sends one generic completion, persists claims, and skips reconnect ambiguity', async () => {
	const f = await fixture();
	const printing = await f.runtime.runPromise(SubscriptionRef.get(f.state));
	const complete = { ...printing, job: { ...printing.job, state: 'complete' as const } };
	await f.runtime.runPromise(SubscriptionRef.set(f.state, complete));
	await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
	expect(JSON.parse(f.send.mock.calls[0]![1] as string).body).not.toContain(printing.job.filename);
	await f.runtime.runPromise(SubscriptionRef.set(f.state, printing));
	await f.runtime.runPromise(SubscriptionRef.set(f.state, complete));
	await new Promise((resolve) => setTimeout(resolve, 40));
	expect(f.send).toHaveBeenCalledTimes(1);
	const sql = await f.runtime.runPromise(SqlClient);
	expect((await f.runtime.runPromise(sql`SELECT * FROM push_deliveries`)).length).toBe(1);
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, { ...printing, job: { ...printing.job, runId: undefined } })
	);
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, { ...printing, connection: 'reconnecting' as const })
	);
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, { ...complete, job: { ...complete.job, runId: undefined } })
	);
	await new Promise((resolve) => setTimeout(resolve, 40));
	expect(f.send).toHaveBeenCalledTimes(1);
});
it('checks revocation at delivery time and separates device ownership', async () => {
	const f = await fixture();
	await expect(
		f.runtime.runPromise(
			f.service.manage({ id: 'other', epoch: 0 }, { action: 'status', subscription })
		)
	).rejects.toThrow();
	f.revoke();
	const printing = await f.runtime.runPromise(SubscriptionRef.get(f.state));
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, {
			...printing,
			job: { ...printing.job, state: 'complete' as const }
		})
	);
	await new Promise((resolve) => setTimeout(resolve, 80));
	expect(f.send).not.toHaveBeenCalled();
});
it('quiet hours suppress events but allow a deliberate test, and enforce test rate limits', async () => {
	const f = await fixture();
	await f.manage('save', {
		...defaultNoticePreferences,
		quiet: true,
		quietStart: '00:00',
		quietEnd: '00:00'
	});
	const printing = await f.runtime.runPromise(SubscriptionRef.get(f.state));
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, {
			...printing,
			job: { ...printing.job, state: 'complete' as const }
		})
	);
	await new Promise((resolve) => setTimeout(resolve, 50));
	expect(f.send).not.toHaveBeenCalled();
	await f.manage('test');
	expect(f.send).toHaveBeenCalledTimes(1);
	await expect(f.manage('test')).rejects.toThrow();
});
it('removes expired subscriptions instead of retrying them', async () => {
	const f = await fixture();
	f.send.mockRejectedValueOnce({ statusCode: 410 });
	await expect(f.manage('test')).rejects.toThrow();
	const sql = await f.runtime.runPromise(SqlClient);
	expect((await f.runtime.runPromise(sql`SELECT * FROM push_devices`)).length).toBe(0);
	expect(f.send).toHaveBeenCalledTimes(1);
});
it('requires ownership and current epoch for private snapshots and refuses expired captures', async () => {
	const f = await fixture();
	const sql = await f.runtime.runPromise(SqlClient);
	const bytes = new Uint8Array([1, 2, 3]);
	await f.runtime.runPromise(
		sql`INSERT INTO push_images VALUES('fixture','owner',0,${bytes},'image/jpeg',${Date.now() + 300000})`
	);
	expect((await f.runtime.runPromise(f.service.image(f.actor, 'fixture')))?.bytes).toEqual(bytes);
	expect(
		await f.runtime.runPromise(f.service.image({ id: 'other', epoch: 0 }, 'fixture'))
	).toBeUndefined();
	expect(
		await f.runtime.runPromise(f.service.image({ id: 'owner', epoch: 1 }, 'fixture'))
	).toBeUndefined();
	await f.runtime.runPromise(sql`UPDATE push_images SET expires=0`);
	expect(await f.runtime.runPromise(f.service.image(f.actor, 'fixture'))).toBeUndefined();
});

it('limits default delivery and captures to the initiating account across multiple devices', async () => {
	const f = await fixture();
	await f.register('second', 'owner', { ...defaultNoticePreferences, snapshot: true });
	await f.register('other', 'other', { ...defaultNoticePreferences, snapshot: true });
	const printing = await f.runtime.runPromise(SubscriptionRef.get(f.state));
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, {
			...printing,
			job: { ...printing.job, state: 'complete' as const }
		})
	);
	await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
	expect(f.capture).toHaveBeenCalledTimes(1);
	expect(f.send.mock.calls.map((c) => (c[0] as typeof subscription).endpoint)).not.toContain(
		subscription.endpoint + 'other'
	);
	const sql = await f.runtime.runPromise(SqlClient);
	expect(await f.runtime.runPromise(sql`SELECT DISTINCT owner FROM push_images`)).toEqual([
		{ owner: 'owner' }
	]);
});
it('skips unattributed prints without taking a capture unless a device opts in to all prints', async () => {
	const f = await fixture();
	await f.manage('save', { ...defaultNoticePreferences, snapshot: true });
	const printing = await f.runtime.runPromise(SubscriptionRef.get(f.state));
	const unknown = { ...printing, job: { ...printing.job, runId: 'external' } };
	await f.runtime.runPromise(SubscriptionRef.set(f.state, unknown));
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, {
			...unknown,
			job: { ...unknown.job, state: 'complete' as const }
		})
	);
	await new Promise((resolve) => setTimeout(resolve, 80));
	expect(f.send).not.toHaveBeenCalled();
	expect(f.capture).not.toHaveBeenCalled();
	await f.register('all', 'other', {
		...defaultNoticePreferences,
		allPrints: true,
		snapshot: true
	});
	const second = { ...unknown, job: { ...unknown.job, runId: 'external-two' } };
	await f.runtime.runPromise(SubscriptionRef.set(f.state, second));
	await f.runtime.runPromise(
		SubscriptionRef.set(f.state, { ...second, job: { ...second.job, state: 'complete' as const } })
	);
	await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
	expect(f.capture).toHaveBeenCalledTimes(1);
	expect((f.send.mock.calls[0]![0] as typeof subscription).endpoint).toBe(
		subscription.endpoint + 'all'
	);
});
it('requires a separate opt-in for shared printer errors without an active job', async () => {
	const f = await fixture();
	await f.register('shared', 'other', { ...defaultNoticePreferences, sharedErrors: true });
	const initial = await f.runtime.runPromise(SubscriptionRef.get(f.state));
	const idle = { ...initial, job: { ...initial.job, state: 'complete' as const } };
	await f.runtime.runPromise(SubscriptionRef.set(f.state, idle));
	await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
	f.send.mockClear();
	await f.runtime.runPromise(SubscriptionRef.set(f.state, { ...idle, klippy: 'error' }));
	await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
	expect((f.send.mock.calls[0]![0] as typeof subscription).endpoint).toBe(
		subscription.endpoint + 'shared'
	);
});
