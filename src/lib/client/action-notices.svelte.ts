/** Per-tab acknowledgements survive navigation; no printer data or credentials in storage. */
export const actionNotices = $state<{ user: string | null; dismissed: string[] }>({
	user: null,
	dismissed: []
});
