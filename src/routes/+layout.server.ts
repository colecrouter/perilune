import { withFailureNotices } from '#lib/server/failure-notices.js';
import { buildInfo } from '#lib/server/build-info.js';
import { defaultPreferences } from '#lib/domain/preferences.js';
import { PreferenceService } from '#lib/server/preference-service.js';
import { requireIdentity } from '#lib/server/auth/index.js';
import type { LayoutServerLoad } from './$types.js';
import { SubscriptionRef, Effect } from 'effect';
import { PrinterService } from '#lib/server/printer-service.js';
import { CameraService } from '#lib/server/camera.js';
import { runtime } from '#lib/server/runtime.js';
export const load: LayoutServerLoad = async (event) => {
	const user = event.locals.identity?.user;
	if (!user) return { user: null, buildInfo };
	requireIdentity(event);
	const initial = await runtime.runPromise(
		Effect.gen(function* () {
			return yield* Effect.all({
				printer: SubscriptionRef.get((yield* PrinterService).state),
				camera: SubscriptionRef.get((yield* CameraService).state),
				preferences: (yield* PreferenceService)
					.get(user.id)
					.pipe(Effect.catchCause(() => Effect.succeed(null)))
			});
		})
	);
	const { preferences, ...snapshot } = initial;
	snapshot.printer = await runtime.runPromise(withFailureNotices(snapshot.printer, user.id));
	return {
		buildInfo,
		user: { id: user.id, name: user.name, role: user.role },
		initial: snapshot,
		preferences: preferences ?? defaultPreferences,
		preferencesUnavailable: preferences === null
	};
};
