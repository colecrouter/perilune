/// <reference lib="webworker" />
import { version } from '$app/env';
const worker = self as unknown as ServiceWorkerGlobalScope;
// A changed build produces a new worker. No documents, APIs or media are cached.
const buildVersion = version;
worker.addEventListener('message', (event) => {
	if (event.data === 'ACTIVATE_UPDATE' && buildVersion) void worker.skipWaiting();
});
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));
worker.addEventListener('push', (event) => {
	event.waitUntil(
		(async () => {
			let notice: { id?: string; title?: string; body?: string; image?: string } = {};
			try {
				const parsed = event.data?.json();
				if (parsed && typeof parsed === 'object') notice = parsed;
			} catch {
				/* Always display a visible notification. */
			}
			let image: string | undefined;
			if (
				typeof notice.image === 'string' &&
				/^\/api\/notifications\?image=[a-f0-9-]{36}$/.test(notice.image)
			) {
				try {
					const response = await fetch(notice.image, {
						credentials: 'same-origin',
						cache: 'no-store',
						redirect: 'error',
						signal: AbortSignal.timeout(5000)
					});
					if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
						const bytes = new Uint8Array(await response.arrayBuffer());
						if (bytes.length <= 2_000_000) {
							let binary = '';
							for (let offset = 0; offset < bytes.length; offset += 16384)
								binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
							image = `data:${response.headers.get('content-type')};base64,${btoa(binary)}`;
						}
					}
				} catch {
					/* A signed-out device still receives the generic event, without a private image. */
				}
			}
			await worker.registration.showNotification(notice.title ?? 'Perilune', {
				body: notice.body ?? 'Open Perilune to check your printer.',
				icon: '/icons/app-192.png',
				badge: '/icons/badge-96.png',
				tag: notice.id ?? 'perilune',
				data: { url: '/' },
				...(image ? { image } : {})
			});
		})()
	);
});
worker.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(
		(async () => {
			const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const existing = clients.find(
				(client) => new URL(client.url).origin === worker.location.origin
			);
			if (existing) await existing.focus();
			else await worker.clients.openWindow('/');
		})()
	);
});
