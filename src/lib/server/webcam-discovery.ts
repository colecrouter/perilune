import { Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { MoonrakerService } from './moonraker.js';
import { CameraService } from './camera.js';
export interface DiscoveredCamera {
	source: string;
	name: string;
	rotation: 0 | 90 | 180 | 270;
	flipHorizontal: boolean;
	flipVertical: boolean;
}
/** Accept registered go2rtc names, never dynamic source URLs or directives. */
export function discoverCamera(webcams: unknown): DiscoveredCamera | null {
	if (!Array.isArray(webcams)) return null;
	for (const item of webcams) {
		if (
			!item ||
			typeof item !== 'object' ||
			item.enabled !== true ||
			typeof item.stream_url !== 'string'
		)
			continue;
		let source: string | null;
		try {
			source = new URL(item.stream_url, 'http://camera.invalid').searchParams.get('src');
		} catch {
			continue;
		}
		if (!source || !/^[a-zA-Z0-9_.-]{1,128}$/.test(source)) continue;
		return {
			source,
			name: typeof item.name === 'string' ? item.name.slice(0, 120) : 'Printer camera',
			rotation: [0, 90, 180, 270].includes(item.rotation)
				? (item.rotation as 0 | 90 | 180 | 270)
				: 0,
			flipHorizontal: item.flip_horizontal === true,
			flipVertical: item.flip_vertical === true
		};
	}
	return null;
}

export const WebcamBridgeLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const moonraker = yield* MoonrakerService;
		const camera = yield* CameraService;
		yield* SubscriptionRef.changes(moonraker.state).pipe(
			Stream.runForEach((snapshot) => camera.updateSource(discoverCamera(snapshot.webcams))),
			Effect.forkScoped
		);
	})
);
