import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { Effect } from 'effect';
import { sameOrigin } from '#lib/server/auth/index.js';
import { ConfigurationService } from '#lib/server/config-service.js';
import { configActor, configResult } from '#lib/server/config-http.js';
export const read = async (event: RequestEvent, params: URLSearchParams) => {
	const actor = configActor(event);
	const root = params.get('sources');
	if (root)
		return await configResult(
			event,
			Effect.flatMap(ConfigurationService, (service) => service.sources(root, actor))
		);
	const path = params.get('file');
	const backup = params.get('backup');
	if (!path)
		return await configResult(
			event,
			Effect.flatMap(ConfigurationService, (service) => service.list(actor))
		);
	if (backup)
		return {
			text: await configResult(
				event,
				Effect.flatMap(ConfigurationService, (service) => service.backup(path, backup, actor))
			)
		};
	return await configResult(
		event,
		Effect.flatMap(ConfigurationService, (service) => service.read(path, actor))
	);
};
export const write = async (event: RequestEvent, body: Record<string, unknown>) => {
	sameOrigin(event.request);
	configActor(event);
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
	return await configResult(
		event,
		Effect.flatMap(ConfigurationService, (service) => service.save(request, actor))
	);
};
