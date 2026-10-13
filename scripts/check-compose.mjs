import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const origin = 'https://perilune.example.invalid';
const output = execFileSync('docker', ['compose', 'config', '--format', 'json'], {
	env: { ...process.env, PERILUNE_ORIGIN: origin },
	encoding: 'utf8'
});
const config = JSON.parse(output);
assert.equal(config.services.perilune.environment.PERILUNE_ORIGIN, origin);
console.log('Compose preserves the configured browser origin.');
