import { command, query, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { Schema } from 'effect';
import { authService, requireIdentity, installationOrigin } from '#lib/server/auth/index.js';
import { JobService } from '#lib/server/job-service.js';
import { jobOperation } from '#lib/server/job-http.js';
import { runtime } from '#lib/server/runtime.js';

const idSchema = Schema.toStandardSchemaV1(
	Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
);

export const getIntegrations = query(async () => {
	const event = getRequestEvent();
	const identity = requireIdentity(event);
	const service = await runtime.runPromise(JobService);
	const keys = ['owner', 'operator'].includes(identity.user.role)
		? await jobOperation(service.keys(identity.user.id), event)
		: [];
	requireIdentity(event);
	return {
		host: installationOrigin,
		keys,
		browsers: authService!.browsers(identity.user.id).map((browser) => ({
			id: String(browser.id),
			name: String(browser.name),
			created: Number(browser.created),
			integrationId: browser.integrationId === null ? null : String(browser.integrationId),
			lastUsed: Number(browser.lastUsed),
			expires: Number(browser.expires),
			current: browser.id === identity.session.id
		}))
	};
});

export const createSlicerKey = command(
	Schema.toStandardSchemaV1(
		Schema.Struct({
			name: Schema.String.check(Schema.isMaxLength(80)),
			canPrint: Schema.Boolean,
			expiresDays: Schema.optional(Schema.Literals([90, 365]))
		})
	),
	async (input) => {
		const event = getRequestEvent();
		const identity = requireIdentity(event, 'operator');
		const service = await runtime.runPromise(JobService);
		return jobOperation(
			service.issueKey(
				identity.user.id,
				identity.user.authVersion,
				input.name,
				input.canPrint,
				input.expiresDays
			),
			event
		);
	}
);

export const revokeSlicerKey = command(idSchema, async (id) => {
	const event = getRequestEvent();
	const identity = requireIdentity(event, 'operator');
	const service = await runtime.runPromise(JobService);
	await jobOperation(service.revokeKey(identity.user.id, id), event);
});

export const disconnectSlicer = command(idSchema, (id) => {
	const identity = requireIdentity(getRequestEvent(), 'operator');
	try {
		authService!.disconnectIntegration(identity.user.id, id);
	} catch (cause) {
		error(400, cause instanceof Error ? cause.message : 'Could not disconnect integration.');
	}
});

export const revokePairedBrowser = command(idSchema, (id) => {
	const identity = requireIdentity(getRequestEvent());
	try {
		authService!.revokeBrowser(identity.user.id, id);
	} catch (cause) {
		error(400, cause instanceof Error ? cause.message : 'Could not revoke browser.');
	}
});
