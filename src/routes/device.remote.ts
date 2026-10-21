import { remoteRecord } from '#lib/server/remote-input.js';
import { command, query, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { requireIdentity } from '#lib/server/auth/index.js';
import { runtime } from '#lib/server/runtime.js';
import { NotificationService } from '#lib/server/notification-service.js';
import { PreferenceService } from '#lib/server/preference-service.js';
import { preferencePatch } from '#lib/domain/preferences.js';
const record = remoteRecord(8192);
export const getNotificationKey = query(async () => {
	requireIdentity(getRequestEvent());
	return { publicKey: (await runtime.runPromise(NotificationService)).publicKey };
});
export const manageNotifications = command(record, async (body) => {
	const identity = requireIdentity(getRequestEvent());
	const service = await runtime.runPromise(NotificationService);
	try {
		return await runtime.runPromise(
			service.manage({ id: identity.user.id, epoch: identity.user.authVersion }, body)
		);
	} catch {
		error(
			400,
			'Could not update notifications. Re-enable notifications or check your preferences and try again. Test messages are limited to one every 30 seconds.'
		);
	}
});
export const savePreferences = command(record, async (input) => {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	let patch;
	try {
		patch = preferencePatch(input);
	} catch {
		error(400, 'Choose valid display preferences.');
	}
	const service = await runtime.runPromise(PreferenceService);
	requireIdentity(event);
	const preferences = await runtime.runPromise(service.patch(identity.user.id, patch));
	requireIdentity(event);
	return { preferences };
});

export const getPreferences = query(async () => {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	const service = await runtime.runPromise(PreferenceService);
	const preferences = await runtime.runPromise(service.get(identity.user.id));
	requireIdentity(event);
	return { preferences };
});
