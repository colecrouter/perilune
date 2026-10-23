import { Effect } from 'effect';
import { ActionStore } from './action-store.js';
/** Unique action rows fence late admission; existing receipts are never overwritten. */
export const reconcilePrintSubmission = (id: string, actorId: string) =>
	Effect.flatMap(ActionStore, (store) => store.closeUnaccepted(id, actorId));
