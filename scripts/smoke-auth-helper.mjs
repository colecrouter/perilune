import { execFileSync } from 'node:child_process';
// Tests use the same setup CLI and enrollment/login endpoints as an installation.
export async function authenticate(context, base, filename) {
	const output = process.env.PERILUNE_SMOKE_URL
		? execFileSync('docker', ['exec', 'perilune-ci', 'node', 'scripts/auth.mjs', 'setup'], {
				encoding: 'utf8'
			})
		: execFileSync(process.execPath, ['scripts/auth.mjs', 'setup'], {
				env: { ...process.env, PERILUNE_DATABASE: filename },
				encoding: 'utf8'
			});
	const token = output.trim().split('\n').at(-1);
	const headers = { Origin: base };
	const body = {
		token,
		name: 'Fixture owner',
		email: 'owner@example.test',
		password: 'fixture-owner-password'
	};
	const enrollment = await context.request.post(`${base}/api/account/enroll`, {
		headers,
		data: body
	});
	if (!enrollment.ok()) throw new Error(`Fixture enrollment failed: ${await enrollment.text()}`);
	const login = await context.request.post(`${base}/api/auth/sign-in/email`, {
		headers,
		data: { email: body.email, password: body.password }
	});
	if (!login.ok()) throw new Error(`Fixture sign-in failed: ${await login.text()}`);
}
