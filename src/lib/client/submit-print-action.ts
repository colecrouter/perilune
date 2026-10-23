import { isHttpError } from '@sveltejs/kit';
import type { ActionRequest, ActionRecord } from '#lib/domain/printer.js';
import { printActionJournal } from './print-action-journal.svelte.js';
/** Persist before transport; never replay a physical command to resolve uncertainty. */
export async function submitTrackedPrintAction<T extends ActionRecord | string>(
	account: string,
	request: ActionRequest,
	send: (request: ActionRequest) => Promise<T>
): Promise<T> {
	if (!['start', 'pause', 'resume', 'cancel'].includes(request.command.type)) return send(request);
	const label =
		request.command.type === 'start'
			? 'Start print'
			: request.command.type === 'pause'
				? 'Pause print'
				: request.command.type === 'resume'
					? 'Resume print'
					: 'Stop print';
	printActionJournal.begin(account, request.id, label);
	try {
		const result = await send(request);
		if (result && typeof result === 'object' && 'status' in result)
			printActionJournal.observe(account, [result]);
		return result;
	} catch (error) {
		if (!isHttpError(error) || error.status >= 500) printActionJournal.unknown(account, request.id);
		else printActionJournal.reject(account, request.id);
		throw error;
	}
}
