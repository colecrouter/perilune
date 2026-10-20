import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = ({ url }) => {
	const section = url.searchParams.get('section');
	return {
		section:
			section && ['notifications', 'integrations', 'preferences'].includes(section)
				? section
				: 'access'
	};
};
