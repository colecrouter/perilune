import { afterEach, expect, it, vi } from 'vite-plus/test';
import {
	createECDH,
	createDecipheriv,
	createPublicKey,
	hkdfSync,
	randomBytes,
	verify
} from 'node:crypto';
import { generatePushKeys, PushDeliveryError, sendPush } from './push-transport.js';

// Original web-push storage is a raw P-256 scalar plus uncompressed public point.
function legacyKeys() {
	const key = createECDH('prime256v1');
	key.generateKeys();
	return {
		publicKey: key.getPublicKey().toString('base64url'),
		privateKey: Buffer.from(key.getPrivateKey().toString('hex').padStart(64, '0'), 'hex').toString(
			'base64url'
		)
	};
}
function subscriber() {
	const key = createECDH('prime256v1');
	key.generateKeys();
	const auth = randomBytes(16);
	return {
		key,
		auth,
		subscription: {
			endpoint: 'https://fcm.googleapis.com/synthetic-private-device',
			keys: { p256dh: key.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }
		}
	};
}
afterEach(() => vi.unstubAllGlobals());

it('preserves raw VAPID identity, signs valid HTTPS claims and encrypts a decodable RFC8291 payload', async () => {
	const keys = legacyKeys(),
		receiver = subscriber(),
		payload = JSON.stringify({
			title: 'Synthetic print 🌙',
			image: '/api/notifications?image=synthetic'
		});
	let captured!: Request,
		disposed = false;
	vi.stubGlobal('fetch', async (request: Request) => {
		captured = request;
		return new Response(
			new ReadableStream({
				cancel() {
					disposed = true;
				}
			}),
			{ status: 201 }
		);
	});
	const before = { ...keys };
	await sendPush(receiver.subscription, payload, keys, 'https://printer.example.test');
	expect(keys).toEqual(before);
	expect(captured.method).toBe('POST');
	expect(captured.redirect).toBe('manual');
	expect(captured.headers.get('ttl')).toBe('300');
	expect(captured.headers.get('urgency')).toBe('normal');
	expect(captured.headers.get('content-encoding')).toBe('aes128gcm');
	const authorization = captured.headers.get('authorization')!;
	const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization)!;
	expect(match[2]).toBe(keys.publicKey);
	const [header, claims, signature] = match[1].split('.');
	const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
	expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
		alg: 'ES256',
		typ: 'JWT'
	});
	expect(decoded).toMatchObject({
		aud: 'https://fcm.googleapis.com',
		sub: 'https://printer.example.test'
	});
	expect(decoded.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(43000);
	expect(decoded.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(43200);
	const raw = Buffer.from(keys.publicKey, 'base64url');
	const publicKey = createPublicKey({
		format: 'jwk',
		key: {
			kty: 'EC',
			crv: 'P-256',
			x: raw.subarray(1, 33).toString('base64url'),
			y: raw.subarray(33).toString('base64url')
		}
	});
	expect(
		verify(
			'sha256',
			Buffer.from(`${header}.${claims}`),
			{ key: publicKey, dsaEncoding: 'ieee-p1363' },
			Buffer.from(signature, 'base64url')
		)
	).toBe(true);
	// Independent Node crypto decoder verifies the actual wire record, not library internals.
	const body = Buffer.from(await captured.arrayBuffer());
	const salt = body.subarray(0, 16),
		idLength = body[20],
		serverPublic = body.subarray(21, 21 + idLength);
	expect(body.readUInt32BE(16)).toBe(4096);
	expect(idLength).toBe(65);
	const shared = receiver.key.computeSecret(serverPublic);
	const info = Buffer.concat([
		Buffer.from('WebPush: info\0'),
		receiver.key.getPublicKey(),
		serverPublic
	]);
	const ikm = hkdfSync('sha256', shared, receiver.auth, info, 32);
	const cek = hkdfSync(
		'sha256',
		Buffer.from(ikm),
		salt,
		Buffer.from('Content-Encoding: aes128gcm\0'),
		16
	);
	const nonce = hkdfSync(
		'sha256',
		Buffer.from(ikm),
		salt,
		Buffer.from('Content-Encoding: nonce\0'),
		12
	);
	const encrypted = body.subarray(21 + idLength);
	const decipher = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce));
	decipher.setAuthTag(encrypted.subarray(-16));
	const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
	expect(plaintext.at(-1)).toBe(2);
	expect(plaintext.subarray(0, -1).toString()).toBe(payload);
	expect(disposed).toBe(true);
});

it('generates keys in the unchanged raw format and preserves mailto subjects', async () => {
	const keys = await generatePushKeys(),
		receiver = subscriber();
	expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65);
	expect(Buffer.from(keys.privateKey, 'base64url')).toHaveLength(32);
	vi.stubGlobal('fetch', async (request: Request) => {
		const token = /^vapid t=([^,]+)/.exec(request.headers.get('authorization')!)![1];
		expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub).toBe(
			'mailto:owner@example.test'
		);
		return new Response(null, { status: 201 });
	});
	await sendPush(receiver.subscription, '{}', keys, 'mailto:owner@example.test');
});

for (const status of [302, 404, 410, 429, 500])
	it(`retains HTTP ${status} for cleanup without retries or provider details`, async () => {
		let attempts = 0,
			disposed = false;
		vi.stubGlobal('fetch', async (request: Request) => {
			attempts++;
			expect(request.redirect).toBe('manual');
			return new Response(
				new ReadableStream({
					cancel() {
						disposed = true;
					}
				}),
				{ status, headers: { location: 'https://private.invalid' } }
			);
		});
		const receiver = subscriber();
		const result = await sendPush(
			receiver.subscription,
			'private-payload',
			legacyKeys(),
			'https://printer.example.test'
		).catch((error) => error);
		expect(result).toBeInstanceOf(PushDeliveryError);
		expect(result.statusCode).toBe(status);
		expect(String(result)).toBe('Error: Push delivery failed.');
		expect(result.cause).toBeUndefined();
		expect(attempts).toBe(1);
		expect(disposed).toBe(true);
	});

for (const mode of ['timeout', 'abort'] as const)
	it(`aborts the actual fetch on ${mode} with sanitized errors`, async () => {
		const controller = new AbortController();
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let aborted = false;
		vi.stubGlobal(
			'fetch',
			(request: Request) =>
				new Promise((_resolve, reject) => {
					function abort() {
						aborted = true;
						reject(new Error('private endpoint and response'));
					}
					if (request.signal.aborted) abort();
					else request.signal.addEventListener('abort', abort, { once: true });
					entered();
				})
		);
		const receiver = subscriber();
		const result = sendPush(
			receiver.subscription,
			'private',
			legacyKeys(),
			'https://printer.example.test',
			controller.signal,
			mode === 'timeout' ? 30 : 8000
		).catch((error) => error);
		await started;
		if (mode === 'abort') controller.abort();
		const error = await result;
		expect(aborted).toBe(true);
		expect(error).toBeInstanceOf(PushDeliveryError);
		expect(error.statusCode).toBeUndefined();
		expect(String(error)).not.toContain('private');
	});

it('rejects invalid keys/subjects without contacting a provider', async () => {
	const fetch = vi.fn();
	vi.stubGlobal('fetch', fetch);
	for (const [keys, subject] of [
		[{ publicKey: 'bad', privateKey: 'bad' }, 'https://printer.example.test'],
		[legacyKeys(), 'http://invalid.example.test']
	] as const) {
		await expect(sendPush(subscriber().subscription, '{}', keys, subject)).rejects.toBeInstanceOf(
			PushDeliveryError
		);
	}
	expect(fetch).not.toHaveBeenCalled();
});

it('keeps the request abortable while disposing a response after headers', async () => {
	let abortedDuringDisposal = false;
	vi.stubGlobal(
		'fetch',
		async (request: Request) =>
			new Response(
				new ReadableStream({
					cancel() {
						return new Promise<void>((resolve) => {
							const finish = () => {
								abortedDuringDisposal = true;
								resolve();
							};
							if (request.signal.aborted) finish();
							else request.signal.addEventListener('abort', finish, { once: true });
						});
					}
				}),
				{ status: 201 }
			)
	);
	await sendPush(
		subscriber().subscription,
		'{}',
		legacyKeys(),
		'https://printer.example.test',
		undefined,
		30
	);
	expect(abortedDuringDisposal).toBe(true);
});
