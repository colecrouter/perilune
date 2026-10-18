import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireIdentity, sameOrigin } from '#lib/server/auth/index.js';
import { preferencePatch } from '#lib/domain/preferences.js';
import { readBoundedBody } from '#lib/server/action-body.js';
import { PreferenceService } from '#lib/server/preference-service.js';
import { runtime } from '#lib/server/runtime.js';
export async function GET(event: RequestEvent) {
	const identity = requireIdentity(event);
	const service = await runtime.runPromise(PreferenceService);
	const preferences = await runtime.runPromise(service.get(identity.user.id));
	requireIdentity(event);
	return json({ preferences }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PATCH(event: RequestEvent) {
	requireIdentity(event);
	sameOrigin(event.request);
	const bytes = await readBoundedBody(event.request, 2048);
	let patch;
	try {
		patch = preferencePatch(JSON.parse(new TextDecoder().decode(bytes)));
	} catch {
		error(400, 'Choose valid display preferences.');
	}
	const identity = requireIdentity(event);
	const service = await runtime.runPromise(PreferenceService);
	requireIdentity(event);
	const preferences = await runtime.runPromise(service.patch(identity.user.id, patch));
	requireIdentity(event);
	return json({ preferences }, { headers: { 'Cache-Control': 'no-store' } });
}
