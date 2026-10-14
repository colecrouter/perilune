import { Effect } from 'effect';
import { building } from '$app/env';
import { redirect } from '@sveltejs/kit';
import { integration, runtime } from '#lib/server/runtime.js';
import { PrinterService } from '#lib/server/printer-service.js';
import { authService, sameOrigin } from '#lib/server/auth/index.js';

export const handle: typeof integration.handle = async ({ event, resolve }) => {
	if (building || !authService) return integration.handle({ event, resolve });
	if (event.url.pathname.startsWith('/api/auth/')) {
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
		if (path === '/get-session' && identity && !authService.valid(identity))
			return Response.json(null, { headers: { 'Cache-Control': 'no-store' } });
		const headers = new Headers(event.request.headers);
		headers.set('x-perilune-client-ip', event.getClientAddress());
		const response = await authService.auth.handler(new Request(event.request, { headers }));
		authService.sweep();
		response.headers.set('Cache-Control', 'no-store');
		return response;
	}
	event.locals.identity = await authService.identity(event.request.headers);
	if (event.url.pathname.startsWith('/api/account/')) {
		if (event.request.method !== 'GET') sameOrigin(event.request);
	} else if (
		![
			'/login',
			'/setup',
			'/register',
			'/health',
			'/server/info',
			'/server/files/upload',
			'/server/files/roots'
		].includes(event.url.pathname) &&
		!event.locals.identity
	) {
		if (event.url.pathname.startsWith('/api/') || event.request.method !== 'GET')
			return new Response('Please sign in.', {
				status: 401,
				headers: { 'Cache-Control': 'no-store' }
			});
		redirect(303, authService.needsSetup() ? '/setup' : '/login');
	}
	const response = await integration.handle({ event, resolve });
	response.headers.set('Cache-Control', 'no-store');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
export const init = async () => {
	await runtime.runPromise(PrinterService.pipe(Effect.asVoid));
};
