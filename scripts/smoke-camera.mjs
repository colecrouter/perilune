import { appRequest } from './smoke-remote-helper.mjs';
import { authenticate } from './smoke-auth-helper.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';

// Generated color bars only; no real camera address or captured media.
const directory = await mkdtemp(join(tmpdir(), 'perilune-camera-smoke-'));
const files = new Map();
for (const name of ['init.mp4', 'segment0.m4s', 'segment1.m4s', 'segment2.m4s', 'snapshot.jpg'])
	files.set(name, await readFile(new URL(`fixtures/camera/${name}`, import.meta.url)));
let source = 'fixture_camera';
const definitions = new Map();
let rotation = 0;
let sequence = 0;
let requests = 0;
const activeStreams = new Set();
const requestedSources = [];
const media = createServer((request, response) => {
	const url = new URL(request.url, 'http://fixture.invalid');
	if (url.pathname === '/api/streams') {
		if (request.method === 'PATCH')
			definitions.set(url.searchParams.get('name'), url.searchParams.get('src'));
		if (request.method === 'DELETE') definitions.delete(url.searchParams.get('src'));
		response.statusCode =
			request.method === 'GET' && !definitions.has(url.searchParams.get('src')) ? 404 : 200;
		response.end('{}');
		return;
	}
	requests++;
	response.setHeader('X-Private-Upstream', 'fixture-secret-header');
	const send = (type, body) => {
		response.setHeader('Content-Type', type);
		response.end(body);
	};
	if (url.pathname === '/api/stream.m3u8') {
		requestedSources.push(url.searchParams.get('src'));
		send(
			'application/vnd.apple.mpegurl',
			`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=240000,CODECS="avc1.42c01e"\nhls/playlist.m3u8?id=fixture${++sequence}\n`
		);
	} else if (url.pathname === '/api/stream.mp4') {
		requestedSources.push(url.searchParams.get('src'));
		assert.equal(url.searchParams.get('video'), 'h264');
		response.setHeader('Content-Type', 'video/mp4; codecs="avc1.42c01e"');
		response.write(
			Buffer.concat(
				['init.mp4', 'segment0.m4s', 'segment1.m4s', 'segment2.m4s'].map((name) => files.get(name))
			)
		);
		activeStreams.add(response);
		response.on('close', () => activeStreams.delete(response));
	} else if (url.pathname === '/api/hls/playlist.m3u8') {
		const id = url.searchParams.get('id');
		send(
			'application/vnd.apple.mpegurl',
			`#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init.mp4?id=${id}"\n${[0, 1, 2].map((n) => `#EXTINF:1.000,\nsegment.m4s?id=${id}&n=${n}`).join('\n')}\n#EXT-X-ENDLIST\n`
		);
	} else if (url.pathname === '/api/hls/init.mp4') send('video/mp4', files.get('init.mp4'));
	else if (url.pathname === '/api/hls/segment.m4s')
		send('video/mp4', files.get(`segment${url.searchParams.get('n')}.m4s`));
	else if (url.pathname === '/api/frame.jpeg') send('image/jpeg', files.get('snapshot.jpg'));
	else {
		response.statusCode = 404;
		response.end();
	}
});
await new Promise((resolve) => media.listen(0, '127.0.0.1', resolve));
const protocol = new WebSocketServer({ port: 0, host: '127.0.0.1' });
await new Promise((resolve) => protocol.once('listening', resolve));
protocol.on('connection', (socket) => {
	socket.on('message', (data) => {
		const request = JSON.parse(
			Buffer.isBuffer(data)
				? data.toString()
				: data instanceof ArrayBuffer
					? Buffer.from(data).toString()
					: Buffer.concat(data).toString()
		);
		const results = {
			'server.connection.identify': { connection_id: 1 },
			'server.info': { klippy_state: 'ready' },
			'printer.objects.list': { objects: [] },
			'printer.objects.subscribe': { eventtime: 1, status: {} },
			'server.webcams.list': {
				webcams: [
					{
						enabled: true,
						name: 'Fixture camera',
						stream_url: `/camera/api/stream.mjpeg?src=${source}`,
						rotation
					}
				]
			}
		};
		assert.ok(request.method in results, 'No physical printer requests');
		socket.send(
			JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] })
		);
	});
});
const changeSource = () => {
	for (const socket of protocol.clients)
		socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notify_webcams_changed', params: [] }));
};
const port = process.env.PERILUNE_CAMERA_TEST_PORT ?? '4183';
const base = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, ['scripts/server.mjs'], {
	env: {
		...process.env,
		HOST: '127.0.0.1',
		PORT: port,
		PERILUNE_ORIGIN: base,
		PERILUNE_DATABASE: join(directory, 'state.sqlite'),
		PERILUNE_MOONRAKER_URL: `ws://127.0.0.1:${protocol.address().port}/websocket`,
		PERILUNE_CAMERA_COMPANION_URL: `http://127.0.0.1:${media.address().port}/`,
		PERILUNE_MOONRAKER_API_KEY: ''
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
app.stdout.on('data', (chunk) => {
	logs += chunk;
});
app.stderr.on('data', (chunk) => {
	logs += chunk;
});
let browser;
const initialMediaGate = Promise.withResolvers();
try {
	for (let attempt = 0; ; attempt++) {
		try {
			if ((await fetch(`${base}/health`)).ok) break;
		} catch {
			/* startup */
		}
		if (app.exitCode !== null || attempt > 100) throw new Error(`App startup failed: ${logs}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1505, height: 1045 },
		colorScheme: 'light'
	});
	await authenticate(context, base, join(directory, 'state.sqlite'));
	const selectCamera = async () => {
		const streamUrl = `http://capture.example.invalid/${source}`;
		const testResponse = await appRequest(context.request, 'POST', base + '/api/camera/setup', {
			headers: { Origin: base },
			data: {
				operation: 'test',
				input: { kind: 'network', name: 'Fixture camera', streamUrl, rotation }
			}
		});
		assert.equal(testResponse.status(), 200);
		const test = await testResponse.json();
		const save = await appRequest(context.request, 'POST', base + '/api/camera/setup', {
			headers: { Origin: base },
			data: { operation: 'save', token: test.token }
		});
		assert.equal(save.status(), 200);
		return [...definitions].find(([, value]) => value === streamUrl)[0];
	};
	assert.equal(
		(await (await appRequest(context.request, 'GET', base + '/api/camera/setup')).json()).current
			.configured,
		false,
		'Moonraker discovery cannot select a camera automatically'
	);
	await selectCamera();

	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	const errors = [];
	const browserRequests = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => browserRequests.push(request.url()));
	await page.route('**/api/camera/stream.mp4*', async (route) => {
		await initialMediaGate.promise;
		await route.continue();
	});
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	await page.getByRole('heading', { name: 'Connecting to camera', exact: true }).waitFor();
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/camera-fixture-loading.png', fullPage: true });
	assert.ok(
		await page.locator('.camera-fallback').isVisible(),
		'Loading placeholder remains visible before media arrives'
	);
	initialMediaGate.resolve();
	await page.waitForFunction(() => {
		const video = document.querySelector('video');
		return video && video.videoWidth === 320 && video.currentTime > 0;
	});
	await page.locator('.camera-panel .tag').getByText('Live', { exact: true }).waitFor();
	assert.equal(await page.title(), 'Overview · Perilune');
	const second = await context.newPage();
	await second.goto(base);
	await second.waitForFunction(() => document.querySelector('video')?.videoWidth === 320);
	const downloadWait = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Capture image' }).click();
	const download = await downloadWait;
	assert.equal(download.suggestedFilename(), 'perilune-camera.jpg');
	const headers = await fetch(`${base}/api/camera/snapshot`);
	assert.equal(headers.headers.get('cache-control'), 'no-store');
	assert.equal(headers.headers.get('x-private-upstream'), null);
	for (const response of activeStreams) response.end();
	await page
		.locator('.camera-panel .tag')
		.getByText('Reconnecting', { exact: true })
		.waitFor()
		.catch(async (error) => {
			console.error(await page.locator('.camera-panel').innerText(), {
				sources: requestedSources,
				streams: activeStreams.size
			});
			throw error;
		});
	await page.locator('.camera-panel .tag').getByText('Live', { exact: true }).waitFor();
	const beforeForbidden = requests;
	assert.equal(
		(await appRequest(context.request, 'GET', `${base}/api/camera/stream.m3u8?src=other`)).status(),
		400
	);
	assert.equal(requests, beforeForbidden, 'Browser cannot override the source');
	const oldMaster = await (
		await appRequest(context.request, 'GET', `${base}/api/camera/stream.m3u8`)
	).text();
	const oldPlaylist = oldMaster.split('\n').find((line) => line && !line.startsWith('#'));
	await page.getByRole('spinbutton', { name: 'Bed target' }).fill('85');
	source = 'replacement_camera';
	rotation = 90;
	changeSource();
	const replacementId = await selectCamera();
	await page.waitForFunction(() =>
		document.querySelector('.camera-video')?.classList.contains('portrait')
	);
	await page.waitForFunction(
		() =>
			document.querySelector('video')?.videoWidth === 320 &&
			document.querySelector('video').currentTime > 0
	);
	assert.ok(requestedSources.includes(replacementId), 'Configuration change reaches gateway');
	assert.equal(
		(await appRequest(context.request, 'GET', new URL(oldPlaylist, base).href)).status(),
		404,
		'Old media session invalidated'
	);
	assert.equal(await page.getByRole('spinbutton', { name: 'Bed target' }).inputValue(), '85');
	const geometry = await page.locator('.camera-video').evaluate((element) => {
		const box = element.getBoundingClientRect();
		const videoBox = element.querySelector('video').getBoundingClientRect();
		return {
			width: box.width,
			height: box.height,
			videoWidth: videoBox.width,
			videoHeight: videoBox.height
		};
	});
	assert.ok(
		Math.abs(geometry.width - geometry.videoWidth) < 5 &&
			Math.abs(geometry.height - geometry.videoHeight) < 5,
		`Rotated video fits without cropping: ${JSON.stringify(geometry)}`
	);
	rotation = 0;
	changeSource();
	await selectCamera();
	await page.waitForFunction(
		() => !document.querySelector('.camera-video')?.classList.contains('portrait')
	);
	await mkdir('test-results', { recursive: true });
	await page.screenshot({ path: 'test-results/camera-fixture-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 320, height: 844 });
	await page.screenshot({ path: 'test-results/camera-fixture-mobile.png', fullPage: true });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
		false,
		'Camera controls fit narrow mobile'
	);
	await page.getByRole('button', { name: 'Pause view' }).hover();
	await page.getByRole('tooltip').filter({ hasText: 'Pause view' }).waitFor();
	await page.getByRole('button', { name: 'Pause view' }).click();
	await page.getByRole('heading', { name: 'Camera playback paused', exact: true }).waitFor();
	assert.ok(await page.locator('.camera-fallback').isVisible());
	await page.screenshot({ path: 'test-results/camera-fixture-paused.png', fullPage: true });
	const frameCount = await page.evaluate(() => document.querySelector('video').currentTime);
	await page.getByRole('button', { name: 'Resume view' }).click();
	await page.waitForFunction(
		(previous) =>
			document.querySelector('video')?.videoWidth === 320 &&
			document.querySelector('video').currentTime !== previous,
		frameCount
	);
	assert.ok(
		browserRequests.every((url) => url.startsWith(base)),
		'Browser media stays on app origin'
	);
	assert.ok(
		!browserRequests.some(
			(url) => url.includes('replacement_camera') || url.includes('fixture_camera')
		),
		'Registered upstream names stay server-side'
	);
	const cookie = (await context.cookies())
		.map((value) => `${value.name}=${value.value}`)
		.join('; ');
	const continuous = await fetch(`${base}/api/camera/stream.mp4`, { headers: { Cookie: cookie } });
	assert.equal(continuous.status, 200);
	const reader = continuous.body.getReader();
	await reader.read();
	const liveURLs = [
		...new Set(browserRequests.filter((url) => new URL(url).pathname.includes('/getDashboard')))
	];
	assert.equal(liveURLs.length, 1, 'Printer and camera share one dashboard live query');
	const liveReaders = await Promise.all(
		liveURLs.map(async (url) => {
			const response = await fetch(url, { headers: { Cookie: cookie } });
			assert.equal(response.status, 200);
			const liveReader = response.body.getReader();
			await liveReader.read();
			return liveReader;
		})
	);
	const logout = await appRequest(context.request, 'POST', `${base}/api/auth/sign-out`, {
		headers: { Origin: base },
		data: {}
	});
	assert.equal(logout.status(), 200);
	const drain = Promise.all(
		[reader, ...liveReaders].map(async (streamReader) => {
			try {
				while (!(await streamReader.read()).done) {}
			} catch (cause) {
				if (!(cause instanceof TypeError)) throw cause;
			}
			return true;
		})
	);
	assert.deepEqual(
		await Promise.race([drain, new Promise((resolve) => setTimeout(() => resolve([]), 3000))]),
		[true, true],
		'Logout closes already-returned camera and idle live query bodies'
	);
	assert.equal(
		(await appRequest(context.request, 'GET', `${base}/api/camera/snapshot`)).status(),
		401
	);
	assert.deepEqual(errors, [], 'No camera browser errors');
	console.log(
		'Camera production smoke passed: H.264 decoding, two viewers, capture, same-origin URLs, clean EOF/reconnect, source change, old-session invalidation, orientation, drafts,320px layout, pause/resume.'
	);
} finally {
	initialMediaGate.resolve();
	await browser?.close();
	app.kill('SIGTERM');
	await new Promise((resolve) => {
		if (app.exitCode !== null) resolve();
		else app.once('exit', resolve);
	});
	for (const socket of protocol.clients) socket.terminate();
	await new Promise((resolve) => protocol.close(resolve));
	media.closeAllConnections();
	await new Promise((resolve) => media.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
