import type { NoticeKind } from './notifications.js';
export type NoticeAudience = { type: 'job'; owner: string | null } | { type: 'printer' };
export interface AudiencePreferences {
	allPrints: boolean;
	sharedErrors: boolean;
}
/** Authorization and per-kind/quiet-hour checks are additionally required by delivery. */
export function receivesNotice(
	owner: string,
	kind: NoticeKind,
	audience: NoticeAudience,
	preferences: AudiencePreferences
): boolean {
	if (audience.type === 'job' && audience.owner === owner) return true;
	if (kind === 'printerError' && preferences.sharedErrors) return true;
	return audience.type === 'job' && preferences.allPrints;
}
