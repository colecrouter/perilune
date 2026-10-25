import { expect, test } from 'vite-plus/test';
import { liveQuery } from './live-query.js';

test('forwards live reads and private-receiver methods without caching the framework proxy', async () => {
	let value = 1,
		reads = 0;
	class Resource {
		#token = 'valid receiver';
		get current() {
			return value;
		}
		get then() {
			reads++;
			return Promise.resolve(value).then.bind(Promise.resolve(value));
		}
		reconnect() {
			return this.#token;
		}
	}
	let creations = 0;
	const query = liveQuery(() => {
		creations++;
		return new Resource();
	});
	expect(creations).toBe(0);
	expect(query.current).toBe(1);
	value = 2;
	expect(query.current).toBe(2);
	expect(query.reconnect()).toBe('valid receiver');
	expect(await query).toBe(2);
	expect(reads).toBe(1);
	expect(creations).toBe(4);
});

test('preserves rejection and async iterator cleanup semantics', async () => {
	const failure = Error('fixture failure');
	let returned = false;
	class Resource {
		#value = 3;
		then(_resolve: unknown, reject: (error: Error) => unknown) {
			return Promise.reject(failure).then(undefined, reject);
		}
		async *[Symbol.asyncIterator]() {
			try {
				yield this.#value;
			} finally {
				returned = true;
			}
		}
	}
	const query = liveQuery(() => new Resource());
	await expect(Promise.resolve(query)).rejects.toBe(failure);
	for await (const value of query) {
		expect(value).toBe(3);
		break;
	}
	expect(returned).toBe(true);
});
