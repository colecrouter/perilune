import { describe, expect, it } from 'vite-plus/test';
import { discoverCamera } from './webcam-discovery.js';

describe('trusted registered camera selection', () => {
	it('selects the first enabled registered stream and preserves orientation', () => {
		expect(
			discoverCamera([
				{ enabled: false, stream_url: '/api/stream.mjpeg?src=disabled' },
				{
					enabled: true,
					stream_url: '/api/stream.mjpeg?src=fixture_camera',
					name: 'Workbench',
					rotation: 90,
					flip_horizontal: true
				},
				{ enabled: true, stream_url: '/api/stream.mjpeg?src=other' }
			])
		).toEqual({
			source: 'fixture_camera',
			name: 'Workbench',
			rotation: 90,
			flipHorizontal: true,
			flipVertical: false
		});
	});
	it.each([
		null,
		{},
		[],
		[null],
		[{ enabled: true }],
		[{ enabled: true, stream_url: 'http://camera.invalid/video' }],
		[{ enabled: true, stream_url: '/api/stream.mjpeg?src=rtsp%3A%2F%2Fsecret.invalid' }],
		[{ enabled: true, stream_url: '/api/stream.mjpeg?src=ffmpeg%3Asecret' }]
	])('ignores unavailable or dynamic sources %j', (webcams) => {
		expect(discoverCamera(webcams)).toBeNull();
	});
	it('defaults malformed optional metadata', () => {
		expect(
			discoverCamera([
				{
					enabled: true,
					stream_url: '/api/stream.mjpeg?src=fixture',
					name: null,
					rotation: 45,
					flip_vertical: 'true'
				}
			])
		).toEqual({
			source: 'fixture',
			name: 'Printer camera',
			rotation: 0,
			flipHorizontal: false,
			flipVertical: false
		});
	});
});
