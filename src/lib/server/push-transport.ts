import { generateVapidKeys, sendPushNotification } from 'web-push-browser';

export interface PushSubscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}
export interface VapidKeys {
	publicKey: string;
	privateKey: string;
}

/** Keep the original raw-scalar storage format and subscription identity. */
export async function generatePushKeys(): Promise<VapidKeys> {
	const pair = await generateVapidKeys();
	const publicKey = await crypto.subtle.exportKey('raw', pair.publicKey);
	const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
	if (!privateKey.d) throw new Error('Push key generation failed.');
	return { publicKey: Buffer.from(publicKey).toString('base64url'), privateKey: privateKey.d };
}

async function importKeys(keys: VapidKeys): Promise<CryptoKeyPair> {
	const raw = Buffer.from(keys.publicKey, 'base64url');
	if (raw.length !== 65 || raw[0] !== 4 || Buffer.from(keys.privateKey, 'base64url').length !== 32)
		throw new Error('Invalid push keys.');
	const publicJwk = {
		kty: 'EC',
		crv: 'P-256',
		x: raw.subarray(1, 33).toString('base64url'),
		y: raw.subarray(33).toString('base64url')
	};
	const [publicKey, privateKey] = await Promise.all([
		crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, [
			'verify'
		]),
		crypto.subtle.importKey(
			'jwk',
			{ ...publicJwk, d: keys.privateKey },
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['sign']
		)
	]);
	return { publicKey, privateKey };
}

export class PushDeliveryError extends Error {
	constructor(readonly statusCode?: number) {
		super('Push delivery failed.');
	}
}

/** No retries or redirect following; abort covers headers and response disposal. */
export async function sendPush(
	subscription: PushSubscription,
	payload: string,
	keys: VapidKeys,
	subject: string,
	signal?: AbortSignal,
	timeoutMs = 8000
): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	try {
		const subjectUrl = new URL(subject);
		if (!['https:', 'mailto:'].includes(subjectUrl.protocol)) throw new PushDeliveryError();
		const response = await sendPushNotification(
			await importKeys(keys),
			subscription,
			subject,
			payload,
			{ algorithm: 'aes128gcm', ttl: 300, urgency: 'normal', signal: combined }
		);
		try {
			if (!response.ok) throw new PushDeliveryError(response.status);
		} finally {
			await response.body?.cancel().catch(() => undefined);
		}
	} catch (error) {
		// Never retain endpoint URLs, subscription keys, payloads or provider response bodies.
		throw error instanceof PushDeliveryError ? error : new PushDeliveryError();
	} finally {
		clearTimeout(timer);
	}
}
