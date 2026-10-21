import { remoteRecord } from '#lib/server/remote-input.js';
import { command, query, getRequestEvent } from '$app/server';
import { Schema } from 'effect';
import { error } from '@sveltejs/kit';
import * as files from '#lib/server/configuration-operations.js';
import * as application from '#lib/server/configuration-application-operations.js';
import type { ConfigDocument, ConfigSaved } from '#lib/domain/configuration.js';
import type { ConfigRecovery, PendingConfigurationReview } from '#lib/domain/config-application.js';
const parameters = Schema.toStandardSchemaV1(Schema.Record(Schema.String, Schema.String));
const body = remoteRecord(2097152);
export const readConfiguration = query(parameters, async (input) =>
	files.read(getRequestEvent(), new URLSearchParams(input))
);
export const getConfigurationDocument = query(
	Schema.toStandardSchemaV1(Schema.String),
	async (path) =>
		(await files.read(getRequestEvent(), new URLSearchParams({ file: path }))) as ConfigDocument
);
export const saveConfiguration = command(
	body,
	async (input) => (await files.write(getRequestEvent(), input)) as ConfigSaved
);
export const getConfigurationRecovery = query(
	async () => (await application.read(getRequestEvent(), new URLSearchParams())) as ConfigRecovery
);
export const reviewPendingConfiguration = query(
	async () =>
		(await application.read(
			getRequestEvent(),
			new URLSearchParams({ pending: '' })
		)) as PendingConfigurationReview
);
export const applyConfiguration = command(body, async (input) =>
	application.write(getRequestEvent(), input)
);
export const getConfigurationSnapshot = query(parameters, async (input) => {
	const result = await application.read(getRequestEvent(), new URLSearchParams(input));
	if (!(result instanceof Response)) error(400, 'Choose a configuration snapshot.');
	return result.text();
});
