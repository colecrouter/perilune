import { Effect } from 'effect';
import { requireIdentity } from '#lib/server/auth/index.js';
import { ConfigurationService } from '#lib/server/config-service.js';
import { configActor } from '#lib/server/config-http.js';
import { runtime } from '#lib/server/runtime.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	const identity = requireIdentity(event);
	if (identity.user.role !== 'owner')
		return { allowed: false, files: [], document: null, issue: null };
	const actor = configActor(event);
	const result = await runtime.runPromise(
		Effect.gen(function* () {
			const service = yield* ConfigurationService;
			const files = yield* service.list(actor);
			const path =
				event.url.searchParams.get('file') ??
				(files.some((f) => f.path === 'printer.cfg') ? 'printer.cfg' : files[0]?.path);
			const document = path ? yield* service.read(path, actor) : null;
			return { files, document };
		}).pipe(Effect.result),
		{ signal: event.request.signal }
	);
	if (result._tag === 'Failure')
		return { allowed: true, files: [], document: null, issue: result.failure.message };
	return { allowed: true, ...result.success, issue: null };
};
