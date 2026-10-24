/** Per-tab acknowledgements contain only bounded receipt IDs, never printer data or credentials. */
export const actionNotices = $state<{ user: string | null; dismissed: string[] }>({
	user: null,
	dismissed: []
});
const key = (user: string) => `perilune:failure-dismissals:${user}`;
export function loadFailureDismissals(user: string | null) {
	if (actionNotices.user === user) return;
	actionNotices.user = user;
	actionNotices.dismissed = [];
	if (!user) return;
	try {
		const saved: unknown = JSON.parse(sessionStorage.getItem(key(user)) ?? '[]');
		if (Array.isArray(saved))
			actionNotices.dismissed = saved
				.filter((id): id is string => typeof id === 'string' && id.length <= 128)
				.slice(-100);
	} catch {
		// Storage restrictions must not prevent viewing or dismissing a notice.
	}
}
export function dismissFailures(user: string | null, ids: string[]) {
	loadFailureDismissals(user);
	actionNotices.dismissed = [...new Set([...actionNotices.dismissed, ...ids])].slice(-100);
	if (!user) return;
	try {
		sessionStorage.setItem(key(user), JSON.stringify(actionNotices.dismissed));
	} catch {
		// Retain the in-memory acknowledgement when tab storage is unavailable.
	}
}
