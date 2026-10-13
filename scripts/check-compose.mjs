import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const origin = 'https://perilune.example.invalid';
const output = execFileSync('docker', ['compose', 'config', '--format', 'json'], {
	env: {
		...process.env,
		PERILUNE_ORIGIN: origin,
		PERILUNE_MOONRAKER_URL: 'ws://printer.example.invalid:7125/websocket',
		PERILUNE_MOONRAKER_API_KEY: 'example-test-key'
	},
	encoding: 'utf8'
});
const config = JSON.parse(output);
assert.equal(config.services.perilune.environment.PERILUNE_ORIGIN, origin);
assert.equal(
	config.services.perilune.environment.PERILUNE_MOONRAKER_URL,
	'ws://printer.example.invalid:7125/websocket'
);
assert.equal(config.services.perilune.environment.PERILUNE_MOONRAKER_API_KEY, 'example-test-key');
console.log('Compose preserves origin and private Moonraker settings.');
