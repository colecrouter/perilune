import { expect, test, vi, afterEach } from 'vite-plus/test';
import { createPreferences } from './preferences.svelte.js';
import { defaultPreferences } from '#lib/domain/preferences.js';
afterEach(() => vi.unstubAllGlobals());
test('a delayed save cannot publish another account’s preferences after switching', async () => {
	let finish!: (response: Response) => void;
	vi.stubGlobal(
		'fetch',
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				})
		)
	);
	const state = createPreferences('first');
	state.update({ serif: false });
	expect(state.values.serif).toBe(false);
	state.switchAccount('second');
	finish(Response.json({ preferences: { ...defaultPreferences, serif: false } }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	await vi.waitFor(() => expect(state.saving).toBe(false));
	expect(state.values).toEqual(defaultPreferences);
	state.destroy();
});
test('coalesces changes while saving and preserves optimistic values on failure for explicit retry', async () => {
	const requests: Array<{ body: Record<string, unknown>; finish: (response: Response) => void }> =
		[];
	vi.stubGlobal(
		'fetch',
		vi.fn(
			(_url, init) =>
				new Promise<Response>((finish) => {
					requests.push({ body: JSON.parse(init.body), finish });
				})
		)
	);
	const state = createPreferences('owner');
	state.update({ serif: false });
	state.update({ jobsPageSize: 25 });
	state.update({ jobsPageSize: 50 });
	expect(requests).toHaveLength(1);
	requests[0].finish(Response.json({ preferences: { ...defaultPreferences, serif: false } }));
	await vi.waitFor(() => expect(requests).toHaveLength(2));
	expect(requests[1].body).toEqual({ jobsPageSize: 50 });
	expect(state.values.jobsPageSize).toBe(50);
	requests[1].finish(new Response('', { status: 503 }));
	await vi.waitFor(() => expect(state.error).not.toBe(''));
	expect(state.values.jobsPageSize).toBe(50);
	expect(requests).toHaveLength(2);
	state.retry();
	expect(requests[2].body).toEqual({ jobsPageSize: 50 });
	requests[2].finish(
		Response.json({ preferences: { ...defaultPreferences, serif: false, jobsPageSize: 50 } })
	);
	await vi.waitFor(() => expect(state.saving).toBe(false));
	expect(state.error).toBe('');
	state.destroy();
});
