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
