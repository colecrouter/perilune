import { createHash } from 'node:crypto';
import type { CameraCandidate } from './camera-input.js';

/** Only the companion's enumerated Linux video nodes and bounded fixed capture fields. */
export function localCameraEndpoint(value: unknown): string {
	if (typeof value !== 'string' || value.length > 512) throw Error('Invalid local camera profile.');
	const url = new URL(value);
	const keys = ['video', 'input_format', 'video_size', 'framerate'];
	if (
		url.protocol !== 'v4l2:' ||
		url.pathname !== 'device' ||
		url.hash ||
		[...url.searchParams.keys()].some((key) => !keys.includes(key)) ||
		keys.some((key) => url.searchParams.getAll(key).length !== 1) ||
		!/^\/dev\/video\d{1,3}$/.test(url.searchParams.get('video')!) ||
		!['mjpeg', 'h264', 'hevc', 'yuyv422', 'nv12'].includes(url.searchParams.get('input_format')!)
	)
		throw Error('Invalid local camera profile.');
	const size = /^(\d{1,5})x(\d{1,5})$/.exec(url.searchParams.get('video_size')!);
	const rate = Number(url.searchParams.get('framerate'));
	if (
		!size ||
		+size[1] < 1 ||
		+size[2] < 1 ||
		+size[1] > 8192 ||
		+size[2] > 8192 ||
		!/^\d{1,3}$/.test(url.searchParams.get('framerate')!) ||
		!Number.isInteger(rate) ||
		rate < 1 ||
		rate > 120
	)
		throw Error('Invalid local camera profile.');
	const format = url.searchParams.get('input_format');
	// Raw software capture is bounded to 1080p30-equivalent pixel throughput.
	if (format === 'yuyv422' || format === 'nv12') {
		if (+size[1] % 2 || +size[2] % 2 || +size[1] * +size[2] * rate > 1920 * 1080 * 30)
			throw Error('Unsupported raw camera dimensions or frame rate.');
	}
	return `v4l2:device?${keys.map((key) => `${key}=${encodeURIComponent(url.searchParams.get(key)!)}`).join('&')}`;
}

export function localCameraCandidates(value: unknown): CameraCandidate[] {
	const sources = (value as { sources?: unknown })?.sources;
	if (!Array.isArray(sources)) return [];
	const result: CameraCandidate[] = [];
	const seen = new Set<string>();
	for (const item of sources.slice(0, 64)) {
		try {
			const endpoint = localCameraEndpoint(item?.url);
			if (seen.has(endpoint)) continue;
			seen.add(endpoint);
			const params = new URL(endpoint).searchParams;
			const node = params.get('video')!.split('/').at(-1);
			result.push({
				id: createHash('sha256').update(endpoint).digest('hex').slice(0, 32),
				input: {
					kind: 'local',
					name: `USB / Linux camera ${node} · ${params.get('input_format')} ${params.get('video_size')} @ ${params.get('framerate')} fps`,
					streamUrl: endpoint,
					rotation: 0,
					flipHorizontal: false,
					flipVertical: false
				}
			});
		} catch {
			/* Unsupported capture formats do not hide other devices. */
		}
	}
	return result;
}

/** FFmpeg understands packed YUYV and semiplanar NV12; never label them planar Y4M. */
export function localCameraCapture(value: string): string {
	const endpoint = localCameraEndpoint(value);
	const format = new URL(endpoint).searchParams.get('input_format');
	return format === 'yuyv422' || format === 'nv12'
		? `ffmpeg:${endpoint.slice('v4l2:'.length)}#video=h264`
		: endpoint;
}
