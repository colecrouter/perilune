import { expect, it, vi } from 'vite-plus/test';
import { createAnalysisClient } from './analysis-client.js';
function fakeWorker() {
	const messages: { id: number; path: string; text: string }[] = [];
	const worker = {
		onmessage: null as Worker['onmessage'],
		onerror: null as Worker['onerror'],
		postMessage: (request: (typeof messages)[number]) => messages.push(request),
		terminate: vi.fn()
	};
	return {
		worker,
		messages,
		factory: () => worker as unknown as Worker,
		reply: (id: number, problems: unknown[] = []) =>
			worker.onmessage?.call(
				worker as unknown as Worker,
				{ data: { id, problems } } as MessageEvent
			)
	};
}
it('bounds pending work, replaces stale requests, and terminates on disposal', async () => {
	const f = fakeWorker(),
		client = createAnalysisClient(f.factory),
		text = 'x'.repeat(33000);
	const first = client.analyse('a.cfg', text),
		second = client.analyse('a.cfg', text + '2'),
		third = client.analyse('a.cfg', text + '3');
	expect(await first).toEqual([]);
	expect(await second).toEqual([]);
	expect(f.messages).toHaveLength(1);
	f.reply(f.messages[0]!.id);
	expect(f.messages).toHaveLength(2);
	expect(f.messages[1]!.text).toBe(text + '3');
	f.reply(f.messages[1]!.id);
	expect(await third).toEqual([]);
	const pending = client.analyse('a.cfg', text);
	client.destroy();
	expect(await pending).toEqual([]);
	expect(f.worker.terminate).toHaveBeenCalledOnce();
});
it('uses inline analysis for small files and exposes worker failure as bounded advice', async () => {
	const f = fakeWorker(),
		factory = vi.fn(f.factory),
		client = createAnalysisClient(factory);
	expect(await client.analyse('a.cfg', '[printer]\nmax_velocity: 200')).toEqual([]);
	expect(factory).not.toHaveBeenCalled();
	const failed = client.analyse('a.cfg', 'x'.repeat(33000));
	f.worker.onerror?.call(f.worker as unknown as Worker, {} as ErrorEvent);
	expect((await failed)[0]?.severity).toBe('info');
	expect(f.worker.terminate).toHaveBeenCalledOnce();
	client.destroy();
});
