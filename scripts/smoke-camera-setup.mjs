import { appRequest, remoteArgument } from './smoke-remote-helper.mjs';
/** Real synthetic media through the production setup UI, with no printer or NVR. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { authenticate } from './smoke-auth-helper.mjs';
const image =
	'alexxit/go2rtc:1.9.14@sha256:675c318b23c06fd862a61d262240c9a63436b4050d177ffc68a32710d9e05bae';
const directory = await mkdtemp(join(tmpdir(), 'perilune-camera-setup-'));
const docker = (...args) =>
	execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const appPort = reservation.address().port;
const mediaReservation = createServer();
await new Promise((resolve) => mediaReservation.listen(0, '127.0.0.1', resolve));
const mediaPort = mediaReservation.address().port;
await new Promise((resolve) => mediaReservation.close(resolve));
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${appPort}`;
const filename = join(directory, 'state.sqlite');
let container, child, browser, page, context;
const deadline = async (check, label, timeout = 45_000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		try {
			if (await check()) return;
		} catch {}
		await pause(100);
	}
	throw Error(`Timed out: ${label}`);
};
const stopApp = async () => {
	if (!child || child.exitCode !== null) return;
	const current = child;
	const done = new Promise((resolve) => current.once('exit', resolve));
	const timer = setTimeout(() => current.kill('SIGKILL'), 10_000);
	current.kill('SIGTERM');
	try {
		await done;
	} finally {
		clearTimeout(timer);
	}
};
try {
	await writeFile(
		join(directory, 'go2rtc.yaml'),
		'api:\n  listen: ":1984"\nrtsp:\n  listen: ":8554"\nwebrtc:\n  listen: ""\nstreams:\n  fixture: ffmpeg:virtual?video=testsrc2&size=640x360&rate=10#video=mjpeg\n'
	);
	container = docker(
		'run',
		'-d',
		'--memory=384m',
		'--cpus=2',
		'-p',
		`127.0.0.1:${mediaPort}:1984`,
		'-v',
		`${directory}/go2rtc.yaml:/config/go2rtc.yaml:ro`,
		image
	);
	assert.equal(docker('port', container, '1984/tcp').split(':').at(-1), String(mediaPort));
	const mediaBase = `http://127.0.0.1:${mediaPort}/`;
	await deadline(
		async () =>
			(await fetch(new URL('api/streams', mediaBase), { signal: AbortSignal.timeout(1000) })).ok,
		'companion startup'
	);
	const startApp = async () => {
		child = spawn(process.execPath, ['scripts/server.mjs'], {
			env: {
				...process.env,
				NODE_ENV: 'production',
				HOST: '127.0.0.1',
				PORT: String(appPort),
				PERILUNE_DATABASE: filename,
				PERILUNE_ORIGIN: base,
				PERILUNE_MOONRAKER_URL: '',
				PERILUNE_MOONRAKER_API_KEY: '',
				PERILUNE_CAMERA_COMPANION_URL: mediaBase,
				PERILUNE_PRINTER_WEB_ORIGIN: ''
			},
			stdio: ['ignore', 'ignore', 'inherit']
		});
		await deadline(
			async () => (await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok,
			'app startup'
		);
	};
	await startApp();
	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await authenticate(context, base, filename);
	page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));

	const mountReads = [];
	page.on('request', (request) => {
		if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/camera/setup')
			mountReads.push(request.url());
	});
	const ssr = await appRequest(context.request, 'GET', base + '/camera');
	assert.equal(ssr.status(), 200);
	const html = await ssr.text();
	assert.match(html, /No camera connected/);
	assert.match(html, /Network or printer-host camera/);
	assert.doesNotMatch(html, /Loading camera settings/);
	await page.goto(base + '/camera');

	await page.getByRole('combobox', { name: 'Camera source', exact: true }).selectOption('local');
	await page.getByRole('button', { name: 'Find local cameras', exact: true }).click();
	await page.getByText('No supported local cameras found.', { exact: false }).waitFor();
	assert.equal(
		await page.getByRole('button', { name: 'Test connection', exact: true }).isDisabled(),
		true
	);
	await page.getByRole('combobox', { name: 'Camera source', exact: true }).selectOption('manual');
	assert.deepEqual(
		mountReads,
		[],
		'Settings render through the remote query with no mount-time REST fetch'
	);
	await page
		.getByRole('textbox', { name: 'Video endpoint', exact: true })
		.fill('http://127.0.0.1:1984/api/stream.mjpeg?src=fixture');
	await page
		.getByRole('textbox', { name: 'Snapshot endpoint (optional)', exact: true })
		.fill(new URL('api/frame.jpeg?src=fixture', mediaBase).href);
	await page.getByRole('button', { name: 'Test connection', exact: true }).click();
	await page
		.getByText('Video connection verified. Save to use this camera.', { exact: true })
		.waitFor({ timeout: 30_000 });
	await page.waitForFunction(() => document.querySelector('.preview img')?.naturalWidth === 640);
	assert.equal(
		(await (await appRequest(context.request, 'GET', base + '/api/camera/setup')).json()).status
			.name,
		null,
		'Testing does not replace the active camera'
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForFunction(
		() => innerWidth === 390 && document.documentElement.scrollWidth <= innerWidth
	);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/camera-setup-mobile.png', fullPage: true });
	let saved;
	const held = new Promise((resolve) => {
		saved = resolve;
	});
	let release;
	const released = new Promise((resolve) => {
		release = resolve;
	});
	await page.route('**/_app/remote/*/updateCameraSetup', async (route) => {
		if (route.request().method() !== 'POST' || remoteArgument(route.request()).operation !== 'save')
			return route.continue();
		const response = await route.fetch();
		saved();
		await released;
		await route.fulfill({ response });
	});
	await page.getByRole('button', { name: 'Save camera', exact: true }).click();
	await held;
	await page
		.getByRole('textbox', { name: 'Video endpoint', exact: true })
		.fill('rtsp://draft.example.invalid/unsaved');
	release();
	await page.getByText('Camera saved. It is ready on the overview.', { exact: true }).waitFor();
	assert.equal(
		await page.getByRole('textbox', { name: 'Video endpoint', exact: true }).inputValue(),
		'rtsp://draft.example.invalid/unsaved',
		'Save response preserves newer edits'
	);
	await page.unroute('**/_app/remote/*/updateCameraSetup');
	await page.goto(base + '/');
	await deadline(
		() => page.evaluate(() => document.querySelector('video')?.videoWidth === 640),
		'original decode'
	);
	await page
		.getByRole('combobox', { name: 'Video quality', exact: true })
		.selectOption('data-saver');
	await deadline(
		() => page.evaluate(() => document.querySelector('video')?.videoWidth === 320),
		'selected quality decode'
	);
	assert.equal(
		await page
			.getByRole('combobox', { name: 'Video quality', exact: true })
			.locator('option')
			.count(),
		2,
		'Do not offer an unnecessary 640px conversion for a 640px source'
	);
	await page.screenshot({ path: 'test-results/camera-quality-mobile.png' });
	await page.goto(base + '/camera');
	await deadline(
		() =>
			docker('top', container, '-eo', 'pid,comm')
				.split('\n')
				.filter((line) => /\sffmpeg$/.test(line.trim())).length === 0,
		'last viewer idle shutdown'
	);
	await page.goto('about:blank');
	await stopApp();
	await startApp();
	await page.goto(base + '/');
	await deadline(
		() => page.evaluate(() => document.querySelector('video')?.videoWidth === 320),
		'saved camera and device quality after app restart'
	);
	const previousVideo = await page.locator('video').evaluate((video) => video.src);
	docker('restart', container);
	await deadline(
		() =>
			page.evaluate(
				(previousVideo) =>
					document.querySelector('video')?.videoWidth === 320 &&
					document.querySelector('video')?.readyState >= 3 &&
					document.querySelector('video')?.src !== previousVideo,
				previousVideo
			),
		'playback after companion restart',
		60_000
	);
	await page.goto(base + '/camera');
	await page.getByRole('button', { name: 'Test connection', exact: true }).waitFor();
	const before = (
		await (await appRequest(context.request, 'GET', base + '/api/camera/setup')).json()
	).status;
	const refused = await appRequest(context.request, 'POST', base + '/api/camera/setup', {
		headers: { Origin: 'https://evil.example.invalid' },
		data: { operation: 'reset', revision: before.revision }
	});
	assert.equal(refused.status(), 403);
	const invalid = await appRequest(context.request, 'POST', base + '/api/camera/setup', {
		headers: { Origin: base },
		data: {
			operation: 'test',
			input: { kind: 'network', name: 'Bad', streamUrl: 'file:///etc/passwd' }
		}
	});
	assert.equal(invalid.status(), 400);
	assert.equal(
		(await (await appRequest(context.request, 'GET', base + '/api/camera/setup')).json()).status
			.revision,
		before.revision
	);
	const anonymous = await browser.newContext();
	assert.equal(
		(await appRequest(anonymous.request, 'GET', base + '/api/camera/setup')).status(),
		401
	);
	await anonymous.close();
	const reset = await appRequest(context.request, 'POST', base + '/api/camera/setup', {
		headers: { Origin: base },
		data: { operation: 'reset', revision: before.revision }
	});
	assert.equal(reset.status(), 200);
	assert.equal((await reset.json()).name, null);
	const disconnected = await appRequest(context.request, 'GET', base + '/api/camera/setup');
	assert.equal((await disconnected.json()).current.configured, false);
	await page.goto(base + '/camera');
	await page
		.getByRole('combobox', { name: 'Connection type', exact: true })
		.selectOption('snapshot');
	await page
		.getByRole('textbox', { name: 'Image endpoint', exact: true })
		.fill(new URL('api/frame.jpeg?src=fixture', mediaBase).href);
	await page.getByRole('button', { name: 'Test connection', exact: true }).click();
	await page
		.getByText('Image connection verified. Save to use this camera.', { exact: true })
		.waitFor();
	await page.route('**/*getCameraSetup*', (route) => route.abort());
	await page.getByRole('button', { name: 'Save camera', exact: true }).click();
	await page.getByText('Camera saved. It is ready on the overview.', { exact: true }).waitFor();
	await page
		.getByText('The change was saved, but current settings could not refresh.', { exact: false })
		.waitFor();
	await page.unroute('**/*getCameraSetup*');
	await page.getByRole('button', { name: 'Refresh settings', exact: true }).click();
	await page.getByText('Connected through Perilune’s camera service.', { exact: true }).waitFor();
	await page.goto(base + '/');
	await page.waitForFunction(
		() => document.querySelector('.camera-video img')?.naturalWidth === 640
	);
	assert.equal(
		await page.locator('video').count(),
		0,
		'JPEG-only sources never pretend to be video'
	);
	const refreshed = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/camera/snapshot'
	);
	await page.getByRole('button', { name: 'Refresh image', exact: true }).click();
	assert.equal((await refreshed).status(), 200);
	await deadline(
		() =>
			docker('top', container, '-eo', 'pid,comm')
				.split('\n')
				.filter((line) => /\sffmpeg$/.test(line.trim())).length === 0,
		'snapshot source releases processing'
	);
	assert.deepEqual(errors, []);
	console.log(
		'Camera setup smoke passed: HTTP MJPEG conversion without an NVR, owner test/preview/save, preserved drafts, real H.264 decode, useful quality choices, per-device persistence, app/companion restart, idle shutdown, CSRF and anonymous guards, JPEG-only manual refresh, mobile layout, SSR remote settings, failed refresh recovery and local-device empty state.'
	);
} catch (cause) {
	if (page) {
		console.error(
			await page
				.evaluate(() =>
					JSON.stringify({
						title: document.title,
						width: innerWidth,
						scrollWidth: document.documentElement.scrollWidth,
						font: getComputedStyle(document.body).fontFamily,
						styles: [...document.querySelectorAll('link[rel=stylesheet]')].map((link) => ({
							href: link.href,
							loaded: Boolean(link.sheet)
						})),
						video: [...document.querySelectorAll('video')].map((v) => ({
							width: v.videoWidth,
							ready: v.readyState,
							error: v.error?.code,
							src: v.src
						})),
						camera: document.querySelector('.camera-message')?.textContent
					})
				)
				.catch(() => '')
		);
		await page.screenshot({ path: 'test-results/camera-setup-failure.png' }).catch(() => {});
	}
	if (context)
		console.error(
			await (
				await appRequest(context.request, 'GET', base + '/api/camera/setup')
			)
				.json()
				.catch(() => ({}))
		);
	throw cause;
} finally {
	await browser?.close();
	await stopApp();
	try {
		if (container) docker('rm', '-f', container);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
