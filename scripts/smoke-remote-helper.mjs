// Exercise the production remote protocol while keeping smoke fixtures independent of build hashes.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { stringify, parse } = await import(
	pathToFileURL(
		require.resolve('devalue', { paths: [require.resolve('@sveltejs/kit/package.json')] })
	).href
);
const modules = new Map();
for (const file of readdirSync('build/server/chunks')) {
	if (!file.endsWith('.js')) continue;
	const source = readFileSync('build/server/chunks/' + file, 'utf8');
	for (const match of source.matchAll(/init_remote_functions\([^,]+,\s*"([^"]+)",\s*"([^"]+)"\)/g))
		modules.set(match[1], match[2]);
}
for (const hash of readdirSync('build/prerendered/_app/remote')) {
	if (readdirSync('build/prerendered/_app/remote/' + hash).includes('getKlipperReference'))
		modules.set('src/routes/configuration/reference.remote.ts', hash);
}
export const remoteResult = (value) => ({ type: 'result', data: stringify({ _: value }) });
export const remoteArgument = (request) =>
	parse(Buffer.from(request.postDataJSON().payload, 'base64url').toString('utf8'));
export function decodeRemote(data) {
	return parse(data)._;
}
const files = {
	account: 'src/routes/account/account.remote.ts',
	integrations: 'src/routes/account/integrations.remote.ts',
	access: 'src/routes/access.remote.ts',
	pairing: 'src/routes/pairing.remote.ts',
	device: 'src/routes/device.remote.ts',
	configuration: 'src/routes/configuration/configuration.remote.ts',
	camera: 'src/routes/camera/camera.remote.ts',
	jobs: 'src/routes/jobs/jobs.remote.ts',
	reference: 'src/routes/configuration/reference.remote.ts'
};
export function remoteEndpoint(module, name) {
	const hash = modules.get(files[module]);
	if (!hash) throw Error('Remote module missing from production build: ' + module);
	return '/_app/remote/' + hash + '/' + name;
}
export async function remoteRequest(request, base, module, name, arg, query = false, options = {}) {
	let url = base + remoteEndpoint(module, name);
	const payload = arg === undefined ? '' : Buffer.from(stringify(arg)).toString('base64url');
	if (query) url += '?payload=' + payload;
	const response = await request.fetch(url, {
		...options,
		method: query ? 'GET' : 'POST',
		headers: { 'x-sveltekit-pathname': '/account', Origin: base, ...options.headers },
		...(query ? {} : { data: { payload, refreshes: [] } })
	});
	let wire;
	try {
		wire = await response.json();
	} catch {
		return response;
	}
	if (wire.type !== 'result' && wire.type !== 'error') return response;
	const value = wire.type === 'error' ? { message: wire.error.message } : parse(wire.data)._;
	const status = wire.type === 'error' ? wire.error.status : response.status();
	return new Proxy(response, {
		get(target, key) {
			if (key === 'json') return async () => value;
			if (key === 'status') return () => status;
			if (key === 'ok') return () => status >= 200 && status < 300;
			if (key === 'text')
				return async () => (typeof value === 'string' ? value : JSON.stringify(value));
			const result = Reflect.get(target, key);
			return typeof result === 'function' ? result.bind(target) : result;
		}
	});
}
// Temporary URL-to-operation index for existing smoke scenarios, never installed in the application.
export async function appRequest(request, method, url, options = {}) {
	const u = new URL(url);
	const base = u.origin;
	const data = options.data ?? {};
	const path = u.pathname;
	let module,
		name,
		arg,
		query = method === 'GET';
	if (path.startsWith('/api/access/')) {
		module = 'access';
		name = 'accountEntry';
		arg = { ...data, operation: path.split('/').at(-1) };
		query = false;
	} else if (path === '/api/account/enroll') {
		module = 'access';
		name = 'accountEntry';
		arg = { ...data, operation: 'enroll' };
		query = false;
	} else if (path.startsWith('/api/pairing/')) {
		module = 'pairing';
		name = 'pairBrowser';
		arg = { ...data, operation: path.split('/').at(-1) };
		query = false;
	} else if (path.startsWith('/api/account/')) {
		const operation = path.split('/').at(-1);
		if (operation === 'manage') {
			module = 'account';
			name = 'getAccess';
		} else if (operation === 'browsers') {
			module = 'integrations';
			name = 'getIntegrations';
		} else {
			const actions = {
				invite: ['account', 'inviteAccount', data],
				'revoke-account': ['account', 'revokeAccount', data.id],
				'revoke-invite': ['account', 'revokeInvitation', data.hash],
				'revoke-browser': ['integrations', 'revokePairedBrowser', data.id],
				'disconnect-integration': ['integrations', 'disconnectSlicer', data.id]
			};
			[module, name, arg] = actions[operation] ?? [];
		}
	} else if (path === '/api/jobs/key') {
		module = 'integrations';
		name = 'createSlicerKey';
		arg = { canPrint: false, ...data };
	} else if (path === '/api/jobs/revoke-key') {
		module = 'integrations';
		name = 'revokeSlicerKey';
		arg = data.id;
	} else if (path === '/api/jobs/keys') {
		module = 'integrations';
		name = 'getIntegrations';
	} else if (path === '/api/jobs/remove') {
		module = 'jobs';
		name = 'removeJob';
		arg = data.id;
	} else if (path === '/api/camera/setup') {
		module = 'camera';
		name = query ? 'getCameraSetup' : 'updateCameraSetup';
		arg = query ? undefined : data;
	} else if (path === '/api/preferences') {
		module = 'device';
		name = query ? 'getPreferences' : 'savePreferences';
		arg = query ? undefined : data;
	} else if (path === '/api/notifications' && !u.searchParams.has('image')) {
		module = 'device';
		name = query ? 'getNotificationKey' : 'manageNotifications';
		arg = query ? undefined : data;
	} else if (path === '/api/configuration') {
		module = 'configuration';
		name = query ? 'readConfiguration' : 'saveConfiguration';
		arg = query ? Object.fromEntries(u.searchParams) : data;
	} else if (path === '/api/configuration/application') {
		module = 'configuration';
		name = query
			? u.searchParams.has('pending')
				? 'reviewPendingConfiguration'
				: u.searchParams.has('snapshot')
					? 'getConfigurationSnapshot'
					: 'getConfigurationRecovery'
			: 'applyConfiguration';
		arg = query
			? u.searchParams.has('snapshot')
				? Object.fromEntries(u.searchParams)
				: undefined
			: data;
	} else if (path === '/reference/klipper.json') {
		module = 'reference';
		name = 'getKlipperReference';
	}
	if (!module) return request[method.toLowerCase()](url, options);
	// Mail operations now share the authenticated Account command module.
	if (module === 'access' && ['test', 'request-verification'].includes(arg.operation)) {
		name = arg.operation === 'test' ? 'sendTestEmail' : 'requestRecoveryVerification';
		module = 'account';
		arg = undefined;
	}
	return remoteRequest(request, base, module, name, arg, query, options);
}
