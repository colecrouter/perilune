vi.mock('../../routes/camera/camera.remote.js', () => ({ captureCamera: vi.fn() }));
import { beforeEach, afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vite-plus/test/browser';
import { playCamera } from '#lib/client/camera-player.js';
import type { CameraDescriptor } from '#lib/domain/camera.js';
import CameraPanel from './CameraPanel.svelte';
vi.mock('#lib/client/camera-player.js', () => ({
	playCamera: vi.fn().mockResolvedValue(undefined)
}));
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(playCamera).mockResolvedValue(undefined);
	localStorage.removeItem('perilune.camera.quality');
});
afterEach(() => {
	localStorage.removeItem('perilune.camera.quality');
});
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

const managed: CameraDescriptor = {
	configured: true,
	generation: 1,
	name: 'Fixture',
	streamUrl: '/api/camera/stream.m3u8',
	mseUrl: '/api/camera/stream.mp4',
	snapshotUrl: '/api/camera/snapshot',
	rotation: 0,
	flipHorizontal: false,
	flipVertical: false,
	qualities: [
		{ id: 'original', label: 'Original' },
		{ id: 'data-saver', label: 'Data saver · 320 px' }
	]
};
test('switches only the local viewer quality and preserves the selected stream through equivalent updates', async () => {
	const component = await render(CameraPanel, { camera: managed });
	await expect.poll(() => vi.mocked(playCamera).mock.calls.length).toBe(1);
	const original = vi.mocked(playCamera).mock.calls[0][2];
	await userEvent.selectOptions(
		component.getByRole('combobox', { name: 'Video quality' }),
		'data-saver'
	);
	await expect.poll(() => vi.mocked(playCamera).mock.calls.length).toBe(2);
	expect(original.aborted).toBe(true);
	expect(vi.mocked(playCamera).mock.calls[1][1]).toBe('/api/camera/stream.mp4?quality=data-saver');
	expect(localStorage.getItem('perilune.camera.quality')).toBe('data-saver');
	for (let i = 0; i < 10; i++)
		await component.rerender({ camera: { ...managed, qualities: [...managed.qualities!] } });
	expect(playCamera).toHaveBeenCalledTimes(2);
});
test('tries native HLS when MediaSource playback fails and the browser supports HLS', async () => {
	const canPlay = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
	const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
	const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
	vi.mocked(playCamera).mockRejectedValueOnce(new Error('Camera format unsupported'));
	try {
		const component = await render(CameraPanel, { camera: managed });
		await expect
			.poll(() => component.container.querySelector('video')?.src)
			.toContain('/api/camera/stream.m3u8?quality=original');
		expect(playCamera).toHaveBeenCalledTimes(1);
	} finally {
		canPlay.mockRestore();
		play.mockRestore();
		load.mockRestore();
	}
});
test('retries a disconnected MediaSource stream without treating it as an unsupported codec', async () => {
	const canPlay = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
	vi.mocked(playCamera).mockRejectedValueOnce(new Error('Camera stream ended'));
	try {
		const component = await render(CameraPanel, { camera: managed });
		await expect
			.poll(() => component.container.querySelector('.camera-message')?.textContent)
			.toContain('Retrying automatically');
		expect(component.container.querySelector('video')?.src ?? '').not.toContain('stream.m3u8');
	} finally {
		canPlay.mockRestore();
	}
});
