import { parseJobQuery, queryJobCatalog } from '#lib/domain/job-query.js';
import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { Effect, SubscriptionRef } from 'effect';
import { authService, requireIdentity, sameOrigin } from '#lib/server/auth/index.js';
import { JobService } from '#lib/server/job-service.js';
import { jobOperation, jobUpload } from '#lib/server/job-http.js';
import { runtime } from '#lib/server/runtime.js';
export async function GET(event: RequestEvent) {
	const identity = requireIdentity(event);
	const service = await runtime.runPromise(JobService);
	const id = event.url.searchParams.get('id') ?? '';
	switch (event.params.operation) {
		case 'library':
			return json(
				queryJobCatalog(
					await jobOperation(SubscriptionRef.get(service.state), event),
					parseJobQuery(event.url.searchParams)
				)
			);
		case 'inspect':
			return json({ file: await jobOperation(service.inspect(id), event) });
		case 'keys':
			requireIdentity(event, 'operator');
			return json({ keys: await jobOperation(service.keys(identity.user.id), event) });
		case 'thumbnail': {
			const bytes = await jobOperation(service.thumbnail(id), event);
			requireIdentity(event);
			return new Response(bytes as BodyInit, {
				headers: {
					'Content-Type': 'image/png',
					'X-Content-Type-Options': 'nosniff',
					'Cache-Control': 'no-store'
				}
			});
		}
		default:
			error(404, 'Unknown job operation.');
	}
}
export async function POST(event: RequestEvent) {
	if (event.params.operation === 'upload') return jobUpload(event);
	sameOrigin(event.request);
	requireIdentity(event, 'operator');
	const service = await runtime.runPromise(JobService);
	const bytes = await jobOperation(
		service.readBody(event.request, event.request.signal, 4096),
		event
	);
	let body: Record<string, unknown>;
	try {
		const value = JSON.parse(new TextDecoder().decode(bytes));
		if (!value || typeof value !== 'object' || Array.isArray(value))
			error(400, 'Invalid job request.');
		body = value;
	} catch {
		error(400, 'Invalid job request.');
	}
	const identity = requireIdentity(event, 'operator');
	if (event.params.operation === 'remove' && typeof body.id === 'string') {
		await jobOperation(
			service.remove(
				body.id,
				Effect.sync(
					() =>
						Boolean(authService!.valid(identity)) &&
						['owner', 'operator'].includes(identity.user.role)
				)
			),
			event
		);
		return json({ ok: true });
	}
	if (event.params.operation === 'key' && typeof body.name === 'string') {
		const user = authService!.db
			.prepare('SELECT authVersion FROM user WHERE id=?')
			.get(identity.user.id) as { authVersion: number };
		return json(
			await jobOperation(
				service.issueKey(identity.user.id, user.authVersion, body.name, body.canPrint === true),
				event
			)
		);
	}
	if (event.params.operation === 'revoke-key' && typeof body.id === 'string') {
		await jobOperation(service.revokeKey(identity.user.id, body.id), event);
		return json({ ok: true });
	}
	error(400, 'Invalid job operation.');
}
