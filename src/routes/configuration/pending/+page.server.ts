import { requireIdentity } from '#lib/server/auth/index.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => {
	requireIdentity(event, 'owner');
	return {};
};
