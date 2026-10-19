/** Opt-in real media lifecycle check. Uses synthetic video only; requires Docker. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const image =
	'alexxit/go2rtc:1.9.14@sha256:675c318b23c06fd862a61d262240c9a63436b4050d177ffc68a32710d9e05bae';
const directory = await mkdtemp(join(tmpdir(), 'perilune-camera-probe-'));
const docker = (...args) =>
	execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();
let container;
const controllers = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
	await writeFile(
		join(directory, 'go2rtc.yaml'),
		`api:\n  listen: ":1984"\nrtsp:\n  listen: ":8554"\nwebrtc:\n  listen: ""\nstreams:\n  fixture: ffmpeg:virtual?video=testsrc2&size=640x360&rate=10#video=mjpeg\n  balanced: ffmpeg:fixture#video=h264#width=320\n  http: ffmpeg:http://127.0.0.1:1984/api/stream.mjpeg?src=fixture#video=h264#width=320\n  native: ffmpeg:virtual?video=testsrc2&size=640x360&rate=10#video=h264\n  hevc: ffmpeg:virtual?video=testsrc2&size=640x360&rate=10#video=h265\n  compatible: ffmpeg:hevc#video=h264#width=320\n  http_encoded: ffmpeg:http://127.0.0.1:1984/api/stream.mp4?src=native&video=h264#video=copy\n`
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
		`${directory}/go2rtc.yaml:/config/go2rtc.yaml:ro`,
		image
	);
	const port = docker('port', container, '1984/tcp').split(':').at(-1);
	const base = `http://127.0.0.1:${port}/`;
	const state = async () =>
		(await fetch(new URL('api/streams', base), { signal: AbortSignal.timeout(3000) })).json();
	for (let n = 0; ; n++) {
		try {
			await state();
			break;
		} catch (e) {
			if (n === 100) throw e;
			await delay(100);
		}
	}
	const open = async (path) => {
		const controller = new AbortController();
		controllers.push(controller);
		const response = await fetch(new URL(path, base), {
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
		});
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const first = await reader.read();
		assert.ok(first.value?.byteLength);
		return { controller, reader, type: response.headers.get('content-type') };
	};
	const ffmpegCount = () =>
		docker('top', container, '-eo', 'pid,comm')
			.split('\n')
			.filter((x) => /\sffmpeg$/.test(x.trim())).length;
	const idle = async () => {
		for (let n = 0; ; n++) {
			if (ffmpegCount() === 0) break;
			if (n === 100) throw Error('Idle encoders did not stop');
			await delay(100);
		}
	};
	for (const [profile, expectedProcesses] of [
		['balanced', 2],
		['http', 2],
		['native', 1],
		['http_encoded', 2],
		['compatible', 2]
	]) {
		const one = await open(`api/stream.mp4?src=${profile}&video=h264`);
		const two = await open(`api/stream.mp4?src=${profile}&video=h264`);
		assert.match(one.type, /avc1/i);
		const shared = await state();
		assert.equal(shared[profile].consumers.length, 2);
		assert.equal(shared[profile].producers.length, 1);
		assert.equal(
			ffmpegCount(),
			expectedProcesses,
			`${profile}: one encoder shared by both viewers`
		);
		one.controller.abort();
		await one.reader.cancel().catch(() => {});
		for (let n = 0; ; n++) {
			if ((await state())[profile].consumers.length === 1) break;
			if (n === 50) throw Error('Disconnected viewer was not released');
			await delay(100);
		}
		assert.equal(ffmpegCount(), expectedProcesses, 'Remaining viewer retains shared encoder');
		two.controller.abort();
		await two.reader.cancel().catch(() => {});
		await idle();
		assert.equal((await state())[profile].consumers.length, 0);
		console.log(
			JSON.stringify({
				profile,
				sharedEncoder: true,
				remainingViewerPreserved: true,
				idleShutdown: true
			})
		);
	}
	console.log(
		JSON.stringify({
			platform: docker('info', '--format', '{{.OSType}}/{{.Architecture}}'),
			cameraCompanionProbe: 'passed'
		})
	);
} finally {
	for (const controller of controllers) controller.abort();
	try {
		if (container) docker('stop', '-t', '3', container);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
