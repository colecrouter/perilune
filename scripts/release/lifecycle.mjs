/** Destructive only to uniquely named disposable Docker volumes/containers. No printer connection. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { request } from 'playwright';
import { version } from './version.mjs';
const require = createRequire(import.meta.url);
const { stringify } = await import(
	pathToFileURL(
		require.resolve('devalue', { paths: [require.resolve('@sveltejs/kit/package.json')] })
	).href
);
const [previousImage, image] = process.argv.slice(2);
if (!previousImage || !image) throw Error('Usage: lifecycle.mjs PREVIOUS_IMAGE CANDIDATE_IMAGE');
const prefix = `perilune-release-${process.pid}`;
const volumes = [
	prefix + '-data',
	prefix + '-backup',
	prefix + '-restore',
	prefix + '-candidate-backup'
];
const container = prefix + '-app';
const docker = (...args) =>
	execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim();
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const context = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
const wait = async () => {
	for (let i = 0; i < 100; i++) {
		try {
			const r = await context.get('/health');
			if (r.ok()) return r.json();
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw Error('Container startup failed');
};
const start = async (selected, volume, backup = volumes[1]) => {
	docker(
		'run',
		'-d',
		'--name',
		container,
		'-p',
		`127.0.0.1:${port}:3000`,
		'-e',
		`PERILUNE_ORIGIN=${base}`,
		'-e',
		'PERILUNE_MOONRAKER_URL=',
		'-e',
		'PERILUNE_CAMERA_COMPANION_URL=',
		'-v',
		`${volume}:/app/data`,
		'-v',
		`${backup}:/app/backups`,
		selected
	);
	return wait();
};
const stop = () => docker('rm', '-f', container);
const sql = (statement) =>
	docker(
		'exec',
		container,
		'node',
		'--input-type=module',
		'-e',
		`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.env.PERILUNE_DATABASE);console.log(JSON.stringify(db.prepare(${JSON.stringify(statement)}).all()));db.close();`
	);
const signIn = async () => {
	const r = await context.post('/api/auth/sign-in/email', {
		data: { email: 'release@example.test', password: 'release-fixture-password' }
	});
	assert.equal(r.status(), 200, await r.text());
};
try {
	for (const volume of volumes) docker('volume', 'create', volume);
	// Bootstrap images predate the owned backup directory; prepare only this disposable volume.
	docker(
		'run',
		'--rm',
		'--user',
		'0',
		'-v',
		`${volumes[1]}:/app/backups`,
		'--entrypoint',
		'node',
		previousImage,
		'-e',
		"require('node:fs').chownSync('/app/backups',1000,1000)"
	);
	await start(previousImage, volumes[0]);
	const token = docker('exec', container, 'node', 'scripts/auth.mjs', 'setup').split('\n').at(-1);
	const hash = docker(
		'exec',
		container,
		'node',
		'--input-type=module',
		'-e',
		`import{readdirSync,readFileSync}from'node:fs';for(const f of readdirSync('/app/build/server/chunks')){if(!f.endsWith('.js'))continue;const m=readFileSync('/app/build/server/chunks/'+f,'utf8').match(/init_remote_functions\\([^,]+,\\s*"src\\/routes\\/access.remote.ts",\\s*"([^"]+)"/);if(m){console.log(m[1]);break;}}`
	);
	assert.ok(/^[a-zA-Z0-9_-]+$/.test(hash), 'Enrollment remote metadata exists');
	const enrollment = await context.post(`/_app/remote/${hash}/accountEntry`, {
		headers: { 'x-sveltekit-pathname': '/setup' },
		data: {
			payload: Buffer.from(
				stringify({
					operation: 'enroll',
					token,
					name: 'Release fixture',
					email: 'release@example.test',
					password: 'release-fixture-password'
				})
			).toString('base64url'),
			refreshes: []
		}
	});
	assert.equal((await enrollment.json()).type, 'result');
	await signIn();
	sql('CREATE TABLE release_acceptance(value TEXT)');
	sql("INSERT INTO release_acceptance VALUES ('before-upgrade')");
	docker('exec', container, 'node', 'scripts/backup.mjs', '/app/backups/pre-upgrade');
	stop();
	const health = await start(image, volumes[0], volumes[3]);
	docker('exec', container, 'node', 'scripts/backup.mjs', '/app/backups/candidate-fresh-volume');
	assert.equal(health.status, 'ok');
	assert.equal(health.version, version, 'Candidate reports the declared release version');
	assert.match(health.revision, /^[a-f0-9]{40}$/, 'Candidate reports a full source commit');
	assert.equal(
		health.revision,
		docker(
			'image',
			'inspect',
			image,
			'--format',
			'{{index .Config.Labels "org.opencontainers.image.revision"}}'
		)
	);
	await signIn();
	assert.deepEqual(JSON.parse(sql('SELECT value FROM release_acceptance')), [
		{ value: 'before-upgrade' }
	]);
	sql("UPDATE release_acceptance SET value='after-upgrade'");
	stop();
	// Restore into a fresh volume; never launch old code against the migrated volume.
	docker(
		'run',
		'--rm',
		'-v',
		`${volumes[1]}:/backup:ro`,
		'-v',
		`${volumes[2]}:/app/data`,
		'--entrypoint',
		'node',
		image,
		'scripts/restore.mjs',
		'/backup/pre-upgrade',
		'--server-stopped'
	);
	await start(previousImage, volumes[2]);
	await signIn();
	assert.deepEqual(JSON.parse(sql('SELECT value FROM release_acceptance')), [
		{ value: 'before-upgrade' }
	]);
	assert.equal(JSON.parse(sql('PRAGMA quick_check'))[0].quick_check, 'ok');
	console.log(
		JSON.stringify({
			install: true,
			upgrade: true,
			rollback: true,
			accountsRetained: true,
			matchingSecretRestored: true,
			previousImage,
			image
		})
	);
} catch (cause) {
	try {
		console.error(docker('logs', container));
	} catch {}
	throw cause;
} finally {
	await context.dispose();
	try {
		stop();
	} catch {}
	for (const volume of volumes) {
		try {
			docker('volume', 'rm', volume);
		} catch {}
	}
}
