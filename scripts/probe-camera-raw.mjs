/** Synthetic packed/semiplanar media acceptance. No host camera/device is opened. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cameraDefinitions, cameraProfiles } from '../src/lib/server/camera-profiles.ts';
import { localCameraCapture } from '../src/lib/server/camera-local.ts';
const image =
	'alexxit/go2rtc:1.9.14@sha256:675c318b23c06fd862a61d262240c9a63436b4050d177ffc68a32710d9e05bae';
const directory = await mkdtemp(join(tmpdir(), 'perilune-raw-camera-'));
const docker = (...args) =>
	execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();
const bytes = (...args) =>
	execFileSync('docker', args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let container;
const controllers = [];
try {
	// Only the V4L2 input is replaced with a raw byte fixture. The format arguments,
	// actual FFmpeg pixel conversion, go2rtc templates and consumer lifecycle remain real.
	await writeFile(
		join(directory, 'ffmpeg-shim'),
		`#!/bin/sh
capture=false
format=
previous=
for arg do
 [ "$arg" = /dev/video0 ] && capture=true
 [ "$previous" = -input_format ] && format="$arg"
 previous="$arg"
done
if $capture; then
 [ -e /tmp/fail_capture ] && exit 72
 case "$format" in yuyv422|nv12) ;; *) exit 71;; esac
 for arg do
  shift
  case "$arg" in
   v4l2) set -- "$@" rawvideo;;
   -input_format) set -- "$@" -pixel_format;;
   /dev/video0) set -- "$@" /fixtures/$format.raw;;
   *) set -- "$@" "$arg";;
  esac
 done
 echo "$format" >> /tmp/captures
 exec /usr/bin/ffmpeg -re -stream_loop -1 "$@"
fi
exec /usr/bin/ffmpeg "$@"
`,
		{ mode: 0o755 }
	);
	const streams = {};
	const ids = { yuyv422: `perilune_${'a'.repeat(32)}`, nv12: `perilune_${'b'.repeat(32)}` };
	for (const format of ['yuyv422', 'nv12']) {
		const streamUrl = `v4l2:device?video=/dev/video0&input_format=${format}&video_size=640x480&framerate=10`;
		// Same definitions builder used by CameraCompanion.prepare, including compatible copy.
		Object.assign(
			streams,
			Object.fromEntries(
				cameraDefinitions(ids[format], { kind: 'local', streamUrl }, localCameraCapture(streamUrl))
			)
		);
	}

	await writeFile(
		join(directory, 'go2rtc.yaml'),
		JSON.stringify({
			api: { listen: ':1984' },
			rtsp: { listen: ':8554' },
			webrtc: { listen: '' },
			ffmpeg: { bin: '/fixtures/ffmpeg-shim' },
			streams
		})
	);
	// Generate both native memory layouts from the same color bars with the pinned FFmpeg.
	for (const format of ['yuyv422', 'nv12'])
		docker(
			'run',
			'--rm',
			'-v',
			`${directory}:/fixtures`,
			'--entrypoint',
			'ffmpeg',
			image,
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			'smptebars=size=640x480:rate=10',
			'-frames:v',
			'1',
			'-pix_fmt',
			format,
			'-threads',
			'1',
			'-f',
			'rawvideo',
			`/fixtures/${format}.raw`
		);
	container = docker(
		'run',
		'-d',
		'--rm',
		'--memory=384m',
		'--cpus=2',
		'-p',
		'127.0.0.1::1984',
		'-v',
		`${directory}:/fixtures:ro`,
		'-v',
		`${directory}/go2rtc.yaml:/config/go2rtc.yaml:ro`,
		image
	);
	const port = docker('port', container, '1984/tcp').split(':').at(-1);
	const base = `http://127.0.0.1:${port}/`;
	const state = async () =>
		(await fetch(base + 'api/streams', { signal: AbortSignal.timeout(3000) })).json();
	for (let n = 0; ; n++) {
		try {
			await state();
			break;
		} catch (e) {
			if (n === 100) throw e;
			await delay(100);
		}
	}
	const processCount = () =>
		docker('top', container, '-eo', 'pid,comm')
			.split('\n')
			.filter((x) => /\sffmpeg$/.test(x.trim())).length;
	const open = async (profile) => {
		const controller = new AbortController();
		controllers.push(controller);
		const response = await fetch(base + `api/stream.mp4?src=${profile}&video=h264`, {
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)])
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type'), /avc1/i);
		const reader = response.body.getReader();
		assert.ok((await reader.read()).value?.length);
		return { controller, reader };
	};
	const close = async (viewer) => {
		viewer.controller.abort();
		await viewer.reader.cancel().catch(() => {});
	};
	const until = async (check, message) => {
		for (let n = 0; n < 100; n++) {
			if (await check()) return;
			await delay(100);
		}
		throw Error(message);
	};
	const rgb = (format) =>
		bytes(
			'exec',
			container,
			'ffmpeg',
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'rawvideo',
			'-pixel_format',
			format,
			'-video_size',
			'640x480',
			'-i',
			`/fixtures/${format}.raw`,
			'-frames:v',
			'1',
			'-pix_fmt',
			'rgb24',
			'-threads',
			'1',
			'-f',
			'rawvideo',
			'-'
		);
	for (const format of ['yuyv422', 'nv12']) {
		const baseline = rgb(format);
		const profiles = cameraProfiles(ids[format]);
		const before = docker('exec', container, 'sh', '-c', 'cat /tmp/captures 2>/dev/null || true')
			.split('\n')
			.filter(Boolean).length;
		const one = await open(profiles.original),
			two = await open(profiles.original);
		const variants = [];
		for (const profile of [profiles.compatible, profiles.balanced, profiles['data-saver']])
			variants.push(await open(profile));
		await until(
			() => processCount() === 4,
			'Expected one capture, one compatible remux, and two quality encoders'
		);
		const shared = await state();
		for (const profile of Object.values(profiles))
			assert.equal(shared[profile].producers.length, 1);
		assert.equal(
			docker('exec', container, 'cat', '/tmp/captures').split('\n').filter(Boolean).length,
			before + 1,
			'Production qualities/viewers share a single capture'
		);
		for (const [profile, width, height] of [
			[profiles.original, 640, 480],
			[profiles.compatible, 640, 480],
			[profiles.balanced, 640, 480],
			[profiles['data-saver'], 320, 240]
		]) {
			const decoded = bytes(
				'exec',
				container,
				'ffmpeg',
				'-hide_banner',
				'-loglevel',
				'error',
				'-rtsp_transport',
				'tcp',
				'-i',
				`rtsp://127.0.0.1:8554/${profile}`,
				'-frames:v',
				'1',
				'-pix_fmt',
				'rgb24',
				'-threads',
				'1',
				'-f',
				'rawvideo',
				'-'
			);
			assert.equal(decoded.length, width * height * 3);
			for (let bar = 0; bar < 7; bar++) {
				const offset = (Math.floor(height / 4) * width + Math.floor(((bar + 0.5) * width) / 7)) * 3;
				const reference = (120 * 640 + Math.floor(((bar + 0.5) * 640) / 7)) * 3;
				for (let channel = 0; channel < 3; channel++)
					assert.ok(
						Math.abs(decoded[offset + channel] - baseline[reference + channel]) <= 16,
						`${format}: ${profile} bar ${bar} channel ${channel} color mismatch`
					);
			}
		}
		await close(one);
		assert.equal(processCount(), 4, 'Other viewers retain processing');
		await close(two);
		assert.equal(processCount(), 4, 'Quality variants retain the capture');
		for (const viewer of variants) await close(viewer);
		await until(() => processCount() === 0, 'Raw capture/encoders did not stop when idle');
		docker('exec', container, 'touch', '/tmp/fail_capture');
		const unavailable = await fetch(base + `api/stream.mp4?src=${profiles.original}&video=h264`, {
			signal: AbortSignal.timeout(20_000)
		});
		assert.equal(
			unavailable.ok,
			false,
			'Unavailable capture must fail rather than serve fabricated video'
		);
		await unavailable.body?.cancel();
		docker('exec', container, 'rm', '/tmp/fail_capture');
		const again = await open(profiles.original);
		await close(again);
		await until(() => processCount() === 0, 'Reopened capture did not stop');
		console.log(
			JSON.stringify({
				format,
				productionProfiles: 4,
				decodedColors: true,
				sharedCapture: true,
				mixedQualities: true,
				idleShutdown: true,
				unavailableRecovery: true,
				reopen: true,
				syntheticDevice: true
			})
		);
	}
} finally {
	for (const controller of controllers) controller.abort();
	try {
		if (container) docker('stop', '-t', '3', container);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
