import { describe, expect, it } from 'vite-plus/test';
import {
	cameraInput,
	cameraEndpoint,
	discoverCameraInputs,
	cameraCandidateSummary
} from './camera-input.js';

describe('private camera source adapters', () => {
	it('imports relative Crowsnest paths using the explicit web origin', () => {
		const [camera] = discoverCameraInputs(
			[
				{
					enabled: true,
					uid: 'usb',
					name: 'Workbench',
					stream_url: '/webcam/?action=stream',
					snapshot_url: '/webcam/?action=snapshot',
					rotation: 90,
					flip_horizontal: true
				}
			],
			'https://printer.example.invalid'
		);
		expect(camera.input.streamUrl).toBe('https://printer.example.invalid/webcam/?action=stream');
		expect(camera.input.snapshotUrl).toBe(
			'https://printer.example.invalid/webcam/?action=snapshot'
		);
		expect(camera.input.rotation).toBe(90);
		expect(camera.input.flipHorizontal).toBe(true);
	});
	it('does not guess a web server origin from Moonraker', () => {
		expect(discoverCameraInputs([{ enabled: true, stream_url: '/webcam/?action=stream' }])).toEqual(
			[]
		);
	});
	it.each([
		'file:///etc/passwd',
		'exec:ffmpeg',
		'ffmpeg:camera#video=h264',
		'http://camera.example.invalid/video#raw=command',
		'javascript:alert(1)',
		'http://camera.example.invalid/\nvideo'
	])('rejects engine directives and invalid input %s', (value) => {
		expect(() => cameraEndpoint(value)).toThrow();
	});
	it('accepts authenticated RTSP privately while the setup list hides its endpoint', () => {
		const [candidate] = discoverCameraInputs([
			{
				enabled: true,
				uid: 'ip',
				name: 'IP camera',
				stream_url: 'rtsp://test-user:test-password@camera.example.invalid:8554/video'
			}
		]);
		expect(candidate.input.streamUrl).toContain('test-password');
		const summary = cameraCandidateSummary(candidate);
		expect(summary.protocol).toBe('RTSP');
		expect(JSON.stringify(summary)).not.toMatch(/test-user|test-password|camera.example.invalid/);
	});
	it('keeps valid entries after malformed or disabled cameras and deduplicates IDs', () => {
		const good = {
			enabled: true,
			uid: 'same',
			name: 'Camera',
			stream_url: 'http://camera.example.invalid/video'
		};
		expect(
			discoverCameraInputs([
				null,
				{ ...good, enabled: false },
				{ enabled: true, stream_url: 'bad' },
				good,
				good
			])
		).toHaveLength(1);
	});
	it('keeps discovery bounded', () => {
		expect(
			discoverCameraInputs(
				Array.from({ length: 100 }, (_, i) => ({
					enabled: true,
					uid: String(i),
					stream_url: `http://camera.example.invalid/${i}`
				}))
			)
		).toHaveLength(16);
	});
	it('rejects RTSP snapshots and invalid orientation', () => {
		const input = {
			kind: 'network',
			name: 'Camera',
			streamUrl: 'rtsp://camera.example.invalid/video'
		};
		expect(() =>
			cameraInput({ ...input, snapshotUrl: 'rtsp://camera.example.invalid/snapshot' })
		).toThrow();
		expect(() => cameraInput({ ...input, rotation: 45 })).toThrow();
		expect(() => cameraInput({ ...input, flipHorizontal: 'true' })).toThrow();
	});
});
