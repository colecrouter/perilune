import { expect, test } from 'vite-plus/test';
import { readActionBody } from './action-body.js';
const request = (body: BodyInit) =>
	new Request('http://localhost/actions', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body
	});
test('parses small bounded action bodies without file transfer services', async () => {
	expect((await readActionBody(request('intent=pause&id=example'))).get('intent')).toBe('pause');
});
test('oversized action bodies are cancelled and rejected', async () => {
	let cancelled = false;
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('x'.repeat(8193)));
		},
		cancel() {
			cancelled = true;
		}
	});
	await expect(
		readActionBody(
			new Request('http://localhost/actions', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body,
				duplex: 'half'
			} as RequestInit)
		)
	).rejects.toMatchObject({ status: 413 });
	expect(cancelled).toBe(true);
});

test('aborted pending body reads cancel their iterator and reject without submitting partial fields', async () => {
	const abort = new AbortController();
	let cancelled = false;
	const body = new ReadableStream({
		cancel() {
			cancelled = true;
			throw new Error('already closed');
		}
	});
	const pending = readActionBody(
		new Request('http://localhost/actions', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
			signal: abort.signal,
			duplex: 'half'
		} as RequestInit)
	);
	abort.abort();
	await expect(pending).rejects.toMatchObject({ status: 400 });
	expect(cancelled).toBe(true);
});
