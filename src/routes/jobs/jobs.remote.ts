import { command, getRequestEvent } from '$app/server';
import { Effect, Schema } from 'effect';
import { authService, requireIdentity } from '#lib/server/auth/index.js';
import { JobService } from '#lib/server/job-service.js';
import { jobOperation } from '#lib/server/job-http.js';
import { runtime } from '#lib/server/runtime.js';
export const removeJob = command(
	Schema.toStandardSchemaV1(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
	async (id) => {
		const event = getRequestEvent();
		const identity = requireIdentity(event, 'operator');
		const service = await runtime.runPromise(JobService);
		await jobOperation(
			service.remove(
				id,
				Effect.sync(
					() =>
						Boolean(authService!.valid(identity)) &&
						['owner', 'operator'].includes(identity.user.role)
				)
			),
			event
		);
	}
);
