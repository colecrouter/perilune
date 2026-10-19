import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const origin = 'https://perilune.example.invalid';
const output = execFileSync('docker', ['compose', 'config', '--format', 'json'], {
	env: {
		...process.env,
		PERILUNE_ORIGIN: origin,
		PERILUNE_LIVE_MESH: 'true',
		PERILUNE_KLIPPER_WORKING_DIRECTORY: '/example/klipper',
		PERILUNE_LIVE_FILAMENT: 'true',
		PERILUNE_LIVE_PID: 'true',
		PERILUNE_LIVE_Z_CALIBRATION: 'true',
		PERILUNE_MOONRAKER_URL: 'ws://printer.example.invalid:7125/websocket',
		PERILUNE_MOONRAKER_API_KEY: 'example-test-key',
		PERILUNE_CAMERA_BASE_URL: 'http://go2rtc.example.invalid:1984/',
		PERILUNE_CAMERA_SOURCE: 'printer_camera'
	},
	encoding: 'utf8'
});
const config = JSON.parse(output);
assert.equal(config.services.perilune.environment.PERILUNE_ORIGIN, origin);
assert.equal(config.services.perilune.environment.PERILUNE_LIVE_MESH, 'true');
assert.equal(config.services.perilune.environment.PERILUNE_LIVE_FILAMENT, 'true');
assert.equal(config.services.perilune.environment.PERILUNE_LIVE_PID, 'true');
assert.equal(config.services.perilune.environment.PERILUNE_LIVE_Z_CALIBRATION, 'true');
assert.equal(
	config.services.perilune.environment.PERILUNE_MOONRAKER_URL,
	'ws://printer.example.invalid:7125/websocket'
);
assert.equal(config.services.perilune.environment.PERILUNE_MOONRAKER_API_KEY, 'example-test-key');
console.log('Compose preserves origin and private Moonraker settings.');

assert.equal(
	config.services.perilune.environment.PERILUNE_CAMERA_BASE_URL,
	'http://go2rtc.example.invalid:1984/'
);
assert.equal(config.services.perilune.environment.PERILUNE_CAMERA_SOURCE, 'printer_camera');

assert.equal(
	config.services.perilune.environment.PERILUNE_KLIPPER_WORKING_DIRECTORY,
	'/example/klipper'
);

// Start the actual override: config rendering alone cannot catch an image entrypoint mismatch.
const project = `perilune-camera-compose-${process.pid}`;
const compose = (...args) =>
	execFileSync(
		'docker',
		['compose', '-p', project, '-f', 'compose.yaml', '-f', 'compose.camera.yaml', ...args],
		{ encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }
	);
try {
	const managed = JSON.parse(compose('config', '--format', 'json'));
	assert.equal(managed.services.camera.command[0], 'go2rtc');
	assert.equal(managed.services.camera.read_only, true);
	assert.equal(managed.services.camera.ports?.length ?? 0, 0);
	compose('up', '-d', 'camera');
	let ready = false;
	for (let attempt = 0; attempt < 30 && !ready; attempt++) {
		try {
			const streams = compose(
				'exec',
				'-T',
				'camera',
				'wget',
				'-qO-',
				'http://127.0.0.1:1984/api/streams'
			);
			assert.deepEqual(JSON.parse(streams), {});
			ready = true;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	assert.equal(ready, true, 'Packaged camera companion starts with its read-only configuration');
	console.log('Managed camera Compose starts privately with a read-only configuration.');
} finally {
	compose('down', '--remove-orphans');
}

const usb = JSON.parse(
	execFileSync(
		'docker',
		[
			'compose',
			'-f',
			'compose.yaml',
			'-f',
			'compose.camera.yaml',
			'-f',
			'compose.camera-usb.yaml',
			'config',
			'--format',
			'json'
		],
		{
			env: { ...process.env, PERILUNE_CAMERA_DEVICE: '/dev/v4l/by-id/example-camera' },
			encoding: 'utf8'
		}
	)
);
assert.equal(usb.services.camera.devices.length, 1);
assert.equal(usb.services.camera.devices[0].source, '/dev/v4l/by-id/example-camera');
assert.equal(usb.services.camera.devices[0].target, '/dev/video0');
assert.equal(usb.services.camera.privileged ?? false, false);
console.log('USB override maps one explicit device without privileged access.');
