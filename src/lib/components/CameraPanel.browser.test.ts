import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { playCamera } from '#lib/client/camera-player.js';
import type { CameraDescriptor } from '#lib/domain/camera.js';
import CameraPanel from './CameraPanel.svelte';
vi.mock('#lib/client/camera-player.js', () => ({
	playCamera: vi.fn().mockResolvedValue(undefined)
}));
test('preserves playback across equivalent remote snapshots and reconnects on actual source changes', async () => {
	const camera: CameraDescriptor = {
		configured: true,
		generation: 1,
		name: 'Fixture',
		streamUrl: '/api/camera/stream.m3u8',
		mseUrl: '/api/camera/stream.mp4',
		snapshotUrl: '/api/camera/snapshot',
		rotation: 0,
		flipHorizontal: false,
		flipVertical: false
	};
	const component = await render(CameraPanel, { camera });
	await expect.poll(() => vi.mocked(playCamera).mock.calls.length).toBe(1);
	const firstSignal = vi.mocked(playCamera).mock.calls[0][2];
	for (let i = 0; i < 20; i++) await component.rerender({ camera: { ...camera } });
	expect(playCamera).toHaveBeenCalledTimes(1);
	expect(firstSignal.aborted).toBe(false);
	await component.rerender({ camera: { ...camera, rotation: 90 } });
	expect(playCamera).toHaveBeenCalledTimes(1);
	await component.rerender({ camera: { ...camera, generation: 2 } });
	await expect.poll(() => vi.mocked(playCamera).mock.calls.length).toBe(2);
	expect(firstSignal.aborted).toBe(true);
});
