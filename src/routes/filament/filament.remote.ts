import { createHash } from 'node:crypto';
import { command, query, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { Effect, Schema, SubscriptionRef } from 'effect';
import { requireIdentity } from '#lib/server/auth/index.js';
import { runtime } from '#lib/server/runtime.js';
import { FilamentChangeStore } from '#lib/server/filament-change-settings.js';
import { MoonrakerService } from '#lib/server/moonraker.js';
import { PrinterService } from '#lib/server/printer-service.js';
import { FilamentChangeSettings, filamentSetupReason } from '#lib/domain/filament-change.js';
const target = createHash('sha256')
	.update(process.env.PERILUNE_MOONRAKER_URL?.trim() || 'simulator')
	.digest('hex');
async function discovery() {
	const printer = await runtime.runPromise(
		Effect.flatMap(PrinterService, (s) => SubscriptionRef.get(s.state))
	);
	if (printer.mode === 'simulator') return { capability: null, ready: false, mode: printer.mode };
	const telemetry = await runtime.runPromise(
		Effect.flatMap(MoonrakerService, (s) => SubscriptionRef.get(s.state))
	);
	const ready =
		telemetry.connection === 'connected' &&
		telemetry.klippy === 'ready' &&
		telemetry.telemetryReady;
	return {
		capability: ready ? (telemetry.filamentChange ?? null) : null,
		ready,
		mode: printer.mode
	};
}
export const getFilamentSetup = query(async () => {
	requireIdentity(getRequestEvent(), 'operator');
	const store = await runtime.runPromise(FilamentChangeStore);
	const [settings, discovered] = await Promise.all([
		runtime.runPromise(store.get(target)),
		discovery()
	]);
	requireIdentity(getRequestEvent(), 'operator');
	return { settings, ...discovered, reason: filamentSetupReason(settings, discovered.capability) };
});
export const saveFilamentSetup = command(
	Schema.toStandardSchemaV1(FilamentChangeSettings),
	async (value) => {
		requireIdentity(getRequestEvent(), 'owner');
		const { capability } = await discovery();
		if (value.mode !== 'disabled') {
			const reason = filamentSetupReason(value, capability);
			if (reason) error(409, reason);
		}
		const store = await runtime.runPromise(FilamentChangeStore);
		requireIdentity(getRequestEvent(), 'owner');
		if (!(await runtime.runPromise(store.put(target, value))))
			error(409, 'Setup changed in another tab. Reload before saving.');
		await getFilamentSetup().refresh();
	}
);
