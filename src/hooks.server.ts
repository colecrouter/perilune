import { Effect } from 'effect';
import { integration, runtime } from '#lib/server/runtime.js';
import { PrinterService } from '#lib/server/printer-service.js';

export const handle = integration.handle;
export const init = async () => {
	await runtime.runPromise(PrinterService.pipe(Effect.asVoid));
};
