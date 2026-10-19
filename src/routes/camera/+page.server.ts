import { requireIdentity } from '#lib/server/auth/index.js';
export const load = (event) => {
	requireIdentity(event, 'owner');
	return {};
};
