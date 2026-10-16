import { error } from '@sveltejs/kit';
import { requireIdentity } from '#lib/server/auth/index.js';
import { ActionStore } from '#lib/server/action-store.js';
import { runtime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types.js';
export const load: PageServerLoad = async (event) => {
	const identity = requireIdentity(event, 'operator');
	if (!/^[a-f0-9-]{36}$/i.test(event.params.id)) error(404, 'Receipt not found.');
	const store = await runtime.runPromise(ActionStore);
	const found = await runtime.runPromise(store.find(event.params.id));
	if (!found || found.actorId !== identity.user.id) error(404, 'Receipt not found.');
	return { receipt: found.action };
};
