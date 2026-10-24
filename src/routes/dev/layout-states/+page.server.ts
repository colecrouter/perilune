import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import { requireIdentity } from '#lib/server/auth/index.js';
export const load = (event: import('./$types.js').RequestEvent) => {
	if (!dev) error(404, 'Not found.');
	requireIdentity(event, 'owner');
	return {};
};
