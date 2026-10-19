import { mailConfig } from './mail-config.js';
import { claimProcess } from './process-lock.mjs';
import { building } from '$app/env';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createAuthService, type Role } from './service.js';

const configured = process.env.PERILUNE_ORIGIN;
if (!building && process.env.NODE_ENV === 'production' && !configured)
	throw new Error('Set PERILUNE_ORIGIN before starting Perilune.');
const origin = configured ?? 'http://localhost:4181';
const url = new URL(origin);
if (
	url.origin !== origin ||
	!['http:', 'https:'].includes(url.protocol) ||
	(url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
)
	throw new Error('PERILUNE_ORIGIN must be an HTTPS origin (HTTP is supported on loopback).');
export const authService = building
	? undefined
	: createAuthService(
			process.env.PERILUNE_DATABASE ?? './data/perilune.sqlite',
			origin,
			process.env.PERILUNE_AUTH_SECRET,
			undefined,
			Boolean(mailConfig())
		);
if (authService) claimProcess(authService.db, true);
export function requireIdentity(event: RequestEvent, role: Role = 'viewer') {
	const identity = event.locals.identity;
	if (!identity || !authService?.valid(identity)) error(401, 'Please sign in.');
	if (role === 'owner' && identity.user.role !== 'owner')
		error(403, 'An owner account is required.');
	if (role === 'operator' && !['operator', 'owner'].includes(identity.user.role))
		error(403, 'An operator account is required.');
	return identity;
}
export function sameOrigin(request: Request) {
	if (request.headers.get('origin') !== origin) error(403, 'Request origin is not allowed.');
}
