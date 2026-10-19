import { authService } from '#lib/server/auth/index.js';
export const load = () => ({ mailEnabled: authService?.mailEnabled ?? false });
