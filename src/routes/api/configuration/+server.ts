import { json, error } from '@sveltejs/kit';
import { Effect } from 'effect';
import { sameOrigin } from '#lib/server/auth/index.js';
import { ConfigurationService } from '#lib/server/config-service.js';
import { configActor, configBody, configResult } from '#lib/server/config-http.js';
export const GET = async (event) => {
	const actor = configActor(event);
	const root = event.url.searchParams.get('sources');
	if (root)
		return json(
			await configResult(
				event,
				Effect.flatMap(ConfigurationService, (service) => service.sources(root, actor))
			)
		);
	const path = event.url.searchParams.get('file');
	const backup = event.url.searchParams.get('backup');
	if (!path)
		return json(
			await configResult(
				event,
				Effect.flatMap(ConfigurationService, (service) => service.list(actor))
			)
		);
	if (backup)
		return json({
			text: await configResult(
				event,
				Effect.flatMap(ConfigurationService, (service) => service.backup(path, backup, actor))
			)
		});
	return json(
		await configResult(
			event,
			Effect.flatMap(ConfigurationService, (service) => service.read(path, actor))
		)
	);
};
export const POST = async (event) => {
	sameOrigin(event.request);
	configActor(event);
	const body = await configBody(event.request);
	const actor = configActor(event);
	if (
		!body ||
		typeof body !== 'object' ||
		Array.isArray(body) ||
		!['id', 'path', 'expectedVersion', 'text'].every((key) => typeof body[key] === 'string')
	)
		error(400, 'Supply a file, base revision, text, and unique save ID.');
	const request = {
		id: body.id as string,
		path: body.path as string,
		expectedVersion: body.expectedVersion as string,
		text: body.text as string
	};
	return json(
		await configResult(
			event,
			Effect.flatMap(ConfigurationService, (service) => service.save(request, actor))
		)
	);
};
