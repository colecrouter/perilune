import type { PageServerLoad } from './$types.js';
import { authService } from '#lib/server/auth/index.js';
export const load: PageServerLoad = ({ url }) => ({
	reauthenticate: url.searchParams.get('reauth') === '1',
	mailEnabled: authService?.mailEnabled ?? false
});
