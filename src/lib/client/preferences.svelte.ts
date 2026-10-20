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
			const response = await fetch('/api/preferences', {
				method: 'PATCH',
				keepalive: true,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch),
				signal: request.signal
			});
			if (!response.ok)
				throw Error('Could not save display preferences. Your choices are kept in this tab.');
			const result = await response.json();
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
				if (!error) void flush();
			}
		}
	}
	return {
		get values() {
			return values;
		},
		get error() {
			return error;
		},
		get saving() {
			return saving;
		},
		update(patch: PreferencePatch) {
			if (!account || stopped) return;
			const checked = preferencePatch(patch);
			values = { ...values, ...checked };
			queued = { ...queued, ...checked };
			void flush();
		},
		retry() {
			void flush();
		},
		switchAccount(owner: string | null, initial: Preferences = defaultPreferences) {
			if (owner === account) return;
			generation++;
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
			controller?.abort();
			queued = {};
		}
	};
}
export type PreferenceState = ReturnType<typeof createPreferences>;
export const providePreferences = (state: PreferenceState) => setContext(key, state);
export const preferencesContext = () => getContext<PreferenceState | undefined>(key);
