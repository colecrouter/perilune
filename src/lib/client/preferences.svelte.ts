import { savePreferences } from '../../routes/device.remote.js';
import { getContext, setContext } from 'svelte';
import {
	defaultPreferences,
	preferencePatch,
	type Preferences,
	type PreferencePatch
} from '#lib/domain/preferences.js';
const key = Symbol('perilune.preferences');
export function createPreferences(owner: string | null, initial: Preferences = defaultPreferences) {
	let account = owner;
	let generation = 0;
	let values = $state<Preferences>({ ...initial });
	let error = $state('');
	let saving = $state(false);
	let queued: PreferencePatch = {};
	let controller: AbortController | undefined;
	let stopped = false;
	let inFlight: Promise<void> | undefined;
	function start() {
		if (inFlight) return;
		const operation = flush().finally(() => {
			if (inFlight !== operation) return;
			inFlight = undefined;
			if (!error && Object.keys(queued).length && !stopped) start();
		});
		inFlight = operation;
	}

	async function flush() {
		if (saving || !account || stopped || !Object.keys(queued).length) return;
		const epoch = generation,
			patch = queued;
		queued = {};
		saving = true;
		error = '';
		const request = new AbortController();
		controller = request;
		try {
			const result = await savePreferences({ ...patch });
			if (epoch === generation && !stopped)
				values = { ...defaultPreferences, ...result.preferences, ...queued };
		} catch (cause) {
			if (epoch === generation && !stopped && !request.signal.aborted) {
				queued = { ...patch, ...queued };
				error = cause instanceof Error ? cause.message : 'Could not save preferences.';
			}
		} finally {
			if (epoch === generation && !stopped) {
				saving = false;
			}
		}
	}
	return {
		async settle() {
			while (inFlight) await inFlight;
			return !error && !Object.keys(queued).length;
		},
		get values() {
			return values;
		},
		get error() {
			return error;
		},
		get unsaved() {
			return saving || Object.keys(queued).length > 0;
		},
		get saving() {
			return saving;
		},
		update(patch: PreferencePatch) {
			if (!account || stopped) return;
			const checked = preferencePatch(patch);
			values = { ...values, ...checked };
			queued = { ...queued, ...checked };
			start();
		},
		retry() {
			start();
		},
		switchAccount(owner: string | null, initial: Preferences = defaultPreferences) {
			if (owner === account) return;
			generation++;
			inFlight = undefined;
			controller?.abort();
			account = owner;
			queued = {};
			saving = false;
			error = '';
			values = { ...initial };
		},
		destroy() {
			stopped = true;
			generation++;
			inFlight = undefined;
			controller?.abort();
			queued = {};
		}
	};
}
export type PreferenceState = ReturnType<typeof createPreferences>;
export const providePreferences = (state: PreferenceState) => setContext(key, state);
export const preferencesContext = () => getContext<PreferenceState | undefined>(key);
