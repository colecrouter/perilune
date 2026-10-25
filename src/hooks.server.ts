import { readBoundedBody } from '#lib/server/action-body.js';
import { Effect } from 'effect';
import { building } from '$app/env';
import { error, redirect } from '@sveltejs/kit';
import { integration, runtime } from '#lib/server/runtime.js';
import { PrinterService } from '#lib/server/printer-service.js';
import { authService, sameOrigin } from '#lib/server/auth/index.js';

export const handle: typeof integration.handle = async ({ event, resolve }) => {
	if (building || !authService) return integration.handle({ event, resolve });
	const remoteName = /^\/_app\/remote\/[^/]+\/([^/]+)$/.exec(
		new URL(event.request.url).pathname
	)?.[1];
	const publicRemote =
		remoteName === 'accountEntry' ||
		remoteName === 'pairBrowser' ||
		remoteName === 'getKlipperReference';

	// Public upstream documentation only; generated static data contains no printer state.
	if (
		!event.isRemoteRequest &&
		(event.url.pathname === '/manifest.webmanifest' ||
			event.url.pathname === '/social-card.png' ||
			event.url.pathname === '/service-worker.js' ||
			/^\/icons\/[a-z0-9.-]+$/.test(event.url.pathname))
	) {
		const response = await integration.handle({ event, resolve });
		response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
		return response;
	}
	if (!event.isRemoteRequest && event.url.pathname.startsWith('/api/auth/')) {
		const path = event.url.pathname.slice('/api/auth'.length);
		const publicEndpoints = new Set([
			'/get-session',
			'/sign-in/email',
			'/sign-out',
			'/reset-password',
			'/passkey/generate-authenticate-options',
			'/passkey/verify-authentication'
		]);
		const sessionEndpoints = new Set([
			'/passkey/generate-register-options',
			'/passkey/verify-registration',
			'/passkey/list-user-passkeys',
			'/passkey/delete-passkey'
		]);
		if (!publicEndpoints.has(path) && !sessionEndpoints.has(path))
			return new Response('Authentication endpoint is not available.', { status: 403 });
		const identity = await authService.identity(event.request.headers);
		if (sessionEndpoints.has(path) && (!identity || !authService.valid(identity)))
			return new Response('Please sign in.', { status: 401 });
		if (path === '/get-session')
			return Response.json(identity, { headers: { 'Cache-Control': 'no-store' } });
		const headers = new Headers(event.request.headers);
		headers.set('x-perilune-client-ip', event.getClientAddress());
		const response = await authService.handle(new Request(event.request, { headers }));
		authService.sweep();
		response.headers.set('Cache-Control', 'no-store');
		return response;
	}
	const resolved = await authService.resolveIdentity(event.request.headers);
	event.locals.identity = resolved.response;
	if (
		(event.isRemoteRequest ||
			![
				'/login',
				'/pair',
				'/pair/start',
				'/setup',
				'/register',
				'/forgot-password',
				'/verify-email',
				'/health',
				'/server/info',
				'/server/files/upload',
				'/server/files/roots',
				'/printer/print/start'
			].includes(event.url.pathname)) &&
		!event.locals.identity &&
		!publicRemote
	) {
		if (
			event.isRemoteRequest ||
			event.url.pathname.startsWith('/api/') ||
			event.request.method !== 'GET'
		)
			return new Response('Please sign in.', {
				status: 401,
				headers: { 'Cache-Control': 'no-store' }
			});
		redirect(303, authService.needsSetup() ? '/setup' : '/login');
	}
	if (remoteName && event.request.method === 'POST') {
		sameOrigin(event.request);
		const original = event.request;
		const limit = ['saveConfiguration', 'applyConfiguration'].includes(remoteName)
			? 16 * 1024 * 1024
			: 32 * 1024;
		if (Number(original.headers.get('content-length')) > limit)
			error(413, 'Request body is too large.');
		const bytes = await readBoundedBody(original, limit);
		event = {
			...event,
			request: new Request(original.url, {
				method: original.method,
				headers: original.headers,
				body: new Uint8Array(bytes),
				signal: original.signal
			})
		};
	}
	const response = await integration.handle({ event, resolve });
	// Preserve the DOM that Svelte will hydrate (including visible email addresses).
	response.headers.set(
		'Cache-Control',
		response.headers.get('Content-Type')?.includes('text/html')
			? 'no-store, no-transform'
			: 'no-store'
	);
	response.headers.set(
		'Referrer-Policy',
		['/login', '/register', '/forgot-password', '/verify-email', '/setup'].includes(
			event.url.pathname
		)
			? 'no-referrer'
			: 'same-origin'
	);
	for (const cookie of resolved.headers.getSetCookie())
		response.headers.append('Set-Cookie', cookie);
	return response;
};
export const init = async () => {
	if (building) return;
	await runtime.runPromise(PrinterService.pipe(Effect.asVoid));
};
