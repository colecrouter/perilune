import { SubscriptionRef } from 'effect';
import { requireIdentity } from '#lib/server/auth/index.js';
import { PrinterService } from '#lib/server/printer-service.js';
import { runtime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types.js';
export const load: PageServerLoad = async (event) => {
	requireIdentity(event, 'operator');
	const printer = await runtime.runPromise(PrinterService);
	const snapshot = await runtime.runPromise(SubscriptionRef.get(printer.state));
	return { snapshot };
};
