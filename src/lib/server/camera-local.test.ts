import { expect, it } from 'vite-plus/test';
import { localCameraCandidates, localCameraEndpoint, localCameraCapture } from './camera-local.js';
import { cameraCandidateSummary } from './camera-input.js';
const profile = 'v4l2:device?video=/dev/video0&input_format=mjpeg&video_size=640x480&framerate=30';
it('imports only bounded detected profiles with opaque public identifiers', () => {
	const candidates = localCameraCandidates({
		sources: [
			{ url: profile },
			{ url: profile },
			{ url: 'file:///etc/passwd' },
			{ url: profile.replace('mjpeg', 'rgb24') }
		]
	});
	expect(candidates).toHaveLength(1);
	expect(candidates[0].input.kind).toBe('local');
	const summary = cameraCandidateSummary(candidates[0]);
	expect(summary.name).toContain('mjpeg 640x480 @ 30 fps');
	expect(JSON.stringify(summary)).not.toMatch(/v4l2:|\/dev\//);
	expect(
		localCameraCandidates({
			sources: Array.from({ length: 100 }, (_, i) => ({
				url: profile.replace('video0', `video${i}`)
			}))
		})
	).toHaveLength(64);
});
it.each([
	profile.replace('mjpeg', 'rgb24'),
	profile + '&raw=exec',
	profile + '&framerate=20',
	profile.replace('/dev/video0', '/etc/passwd'),
	profile.replace('640x480', '99999x480'),
	profile.replace('framerate=30', 'framerate=999'),
	profile.replace('mjpeg', 'foo#video=h264'),
	'ffmpeg:device?video=/dev/video0',
	profile.replace('video0', 'video0/../video1'),
	profile.replace('framerate=30', 'framerate=NaN')
])('rejects unsafe or unsupported local profile %s', (value) => {
	expect(() => localCameraEndpoint(value)).toThrow();
});

it.each(['yuyv422', 'nv12'])('uses one format-aware FFmpeg capture for %s', (format) => {
	const endpoint = profile.replace('mjpeg', format);
	expect(decodeURIComponent(localCameraCapture(endpoint))).toBe(
		`ffmpeg:${endpoint.slice(5)}#video=h264`
	);
	expect(localCameraCandidates({ sources: [{ url: endpoint }] })).toHaveLength(1);
	expect(() => localCameraCapture(endpoint + '#raw=exec')).toThrow();
});
it.each([
	profile.replace('mjpeg', 'yuyv422').replace('640x480', '641x480'),
	profile.replace('mjpeg', 'nv12').replace('640x480', '640x481'),
	profile.replace('mjpeg', 'yuyv422').replace('640x480', '640x481'),
	profile.replace('mjpeg', 'nv12').replace('640x480', '3840x2160'),
	profile
		.replace('mjpeg', 'yuyv422')
		.replace('640x480', '1920x1080')
		.replace('framerate=30', 'framerate=60')
])('refuses raw alignment/resource overflow: %s', (endpoint) => {
	expect(() => localCameraCapture(endpoint)).toThrow();
});
