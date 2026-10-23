import type { ActionRecord } from '#lib/domain/printer.js';
const labels = ['Start print', 'Pause print', 'Resume print', 'Stop print'] as const;
const root = 'perilune:print-action:';
const uuid = /^[a-f0-9-]{36}$/i;
export function createPrintActionJournal(storage: () => Storage) {
	let account = $state(''),
		ready = $state(false),
		error = $state('');
	let entries = $state<ActionRecord[]>([]);
	let settled = $state<Record<string, ActionRecord>>({});
	const prefix = (owner: string) => root + encodeURIComponent(owner) + ':';
	function refresh() {
		if (!account) return;
		try {
			const saved: ActionRecord[] = [],
				store = storage(),
				start = prefix(account);
			for (let i = 0; i < store.length; i++) {
				const key = store.key(i);
				if (!key?.startsWith(start)) continue;
				const value = JSON.parse(store.getItem(key) ?? 'null');
				if (
					!value ||
					!uuid.test(value.id) ||
					key !== start + value.id ||
					!labels.includes(value.label) ||
					!['queued', 'unknown'].includes(value.status) ||
					!Number.isFinite(value.createdAt)
				)
					throw Error('Saved print receipts could not be read.');
				saved.push({ ...value, message: null });
			}
			entries = saved.sort((a, b) => b.createdAt - a.createdAt);
			error = '';
			ready = true;
		} catch {
			error =
				'This browser cannot retain print-action receipts. Allow site storage and review Activity before using print controls.';
			ready = false;
		}
	}
	function activate(owner: string) {
		if (owner === account && ready) return;
		account = owner;
		entries = [];
		settled = {};
		ready = false;
		error = '';
		if (owner) refresh();
	}
	function remove(owner: string, id: string) {
		try {
			storage().removeItem(prefix(owner) + id);
			if (owner === account) refresh();
		} catch {
			if (owner === account) {
				error = 'The saved action receipt could not be reconciled. Review Activity.';
				ready = false;
			}
		}
	}
	return {
		get account() {
			return account;
		},
		get ready() {
			return ready;
		},
		get error() {
			return error;
		},
		get entries() {
			return entries;
		},
		activate,
		refresh,
		resolved(owner: string, id: string) {
			return owner === account ? settled[id] : undefined;
		},
		begin(owner: string, id: string, label: string) {
			activate(owner);
			if (!owner || !ready || !uuid.test(id) || !labels.includes(label as (typeof labels)[number]))
				throw Error(error || 'Print receipts are not ready.');
			refresh();
			if (!ready || entries.some((e) => e.id !== id))
				throw Error(error || 'Review the pending print action before submitting another.');
			if (entries.length >= 32)
				throw Error('Review existing print receipts before submitting another action.');
			try {
				storage().setItem(
					prefix(owner) + id,
					JSON.stringify({ id, label, status: 'queued', createdAt: Date.now() })
				);
				refresh();
				if (!ready) throw Error(error);
			} catch {
				error =
					'This browser cannot retain print-action receipts. Allow site storage before using print controls.';
				ready = false;
				throw Error(error);
			}
		},
		unknown(owner: string, id: string) {
			try {
				const key = prefix(owner) + id,
					saved = storage().getItem(key);
				if (saved) {
					const value = JSON.parse(saved);
					storage().setItem(key, JSON.stringify({ ...value, status: 'unknown' }));
				}
				if (owner === account) refresh();
			} catch {
				if (owner === account) {
					error =
						'The print outcome could not be retained. Review Activity before submitting another action.';
					ready = false;
				}
			}
		},
		reject: remove,
		observe(owner: string, receipts: ActionRecord[]) {
			if (owner !== account || !ready) return;
			for (const entry of entries) {
				const receipt = receipts.find((r) => r.id === entry.id);
				if (
					receipt &&
					(['completed', 'failed'].includes(receipt.status) || Boolean(receipt.reviewedAt))
				) {
					settled = {
						...Object.fromEntries(Object.entries(settled).slice(-99)),
						[entry.id]: receipt
					};
					remove(owner, entry.id);
				} else if (receipt?.status === 'unknown' && entry.status !== 'unknown')
					this.unknown(owner, entry.id);
			}
		}
	};
}
export const printActionJournal = createPrintActionJournal(() => window.localStorage);
