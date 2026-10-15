import { error, json } from '@sveltejs/kit';
import { Effect } from 'effect';
import { sameOrigin } from '#lib/server/auth/index.js';
import { configActor, configBody, configResult } from '#lib/server/config-http.js';
import { ConfigurationApplicationService } from '#lib/server/config-application-service.js';
export const GET = async (event) => {
	const actor = configActor(event);
	const snapshot = event.url.searchParams.get('snapshot');
	const side = event.url.searchParams.get('side');
	if (snapshot && (side === 'before' || side === 'after'))
		return new Response(
			await configResult(
				event,
				Effect.flatMap(ConfigurationApplicationService, (service) =>
					service.snapshot(snapshot, side, actor)
				)
			),
			{
				headers: {
					'Content-Type': 'text/plain;charset=utf-8',
					'Content-Disposition': `attachment; filename="configuration-${side}.cfg"`
				}
			}
		);
	return json(
		await configResult(
			event,
			Effect.flatMap(ConfigurationApplicationService, (service) => service.status(actor))
		)
	);
};
export const POST = async (event) => {
	sameOrigin(event.request);
	configActor(event);
	const body = await configBody(event.request),
		actor = configActor(event);
	if (typeof body.id !== 'string') error(400, 'Supply an operation ID.');
	const id = body.id;
	if (body.action === 'check')
		return json(
			await configResult(
				event,
				Effect.flatMap(ConfigurationApplicationService, (service) => service.check(id, actor))
			)
		);
	if (body.confirmedRestart !== true) error(400, 'Explicitly confirm the printer restart.');
	if (body.action === 'revert' && typeof body.revertOf === 'string') {
		const revertOf = body.revertOf;
		return json(
			await configResult(
				event,
				Effect.flatMap(ConfigurationApplicationService, (service) =>
					service.submit({ id, revertOf, confirmedRestart: true }, actor)
				)
			)
		);
	}
	if (
		body.action !== 'apply' ||
		!['path', 'expectedVersion', 'text'].every((key) => typeof body[key] === 'string')
	)
		error(400, 'Supply reviewed configuration source and its revision.');
	const request = {
		id,
		path: body.path as string,
		expectedVersion: body.expectedVersion as string,
		text: body.text as string,
		confirmedRestart: true as const
	};
	return json(
		await configResult(
			event,
			Effect.flatMap(ConfigurationApplicationService, (service) => service.submit(request, actor))
		)
	);
};
