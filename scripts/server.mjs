import { createServer } from 'node:http';

// Kit 3's adapter derives origins from headers. These private headers are always
// overwritten here; forwarded headers from callers are never trusted.
process.env.PROTOCOL_HEADER = 'x-perilune-protocol';
process.env.HOST_HEADER = 'x-perilune-host';
process.env.PORT_HEADER = '';
process.env.ADDRESS_HEADER = 'x-perilune-client-ip';
const canonical = process.env.PERILUNE_ORIGIN ? new URL(process.env.PERILUNE_ORIGIN) : undefined;
if (
	canonical &&
	(!['http:', 'https:'].includes(canonical.protocol) ||
		canonical.username ||
		canonical.password ||
		canonical.pathname !== '/' ||
		canonical.search ||
		canonical.hash)
) {
	throw new Error('PERILUNE_ORIGIN must be an HTTP(S) origin without a path or credentials');
}
const { handler } = await import('../build/handler.js');
const server = createServer((request, response) => {
	let origin;
	try {
		origin = canonical ?? new URL(`http://${request.headers.host}`);
	} catch {
		response.writeHead(400);
		response.end('Invalid host');
		return;
	}
	request.headers['x-perilune-protocol'] = origin.protocol.slice(0, -1);
	request.headers['x-perilune-host'] = origin.host;
	request.headers['x-perilune-client-ip'] = request.socket.remoteAddress ?? '127.0.0.1';
	handler(request, response, () => {
		response.writeHead(404);
		response.end('Not found');
	});
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => {
	console.log(`Perilune listening on ${JSON.stringify(server.address())}`);
});
let stopping = false;
async function shutdown(reason) {
	if (stopping) return;
	stopping = true;
	const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
	deadline.unref();
	const closed = new Promise((resolve) => server.close(resolve));
	try {
		await Promise.all(
			process.listeners('sveltekit:shutdown').map(async (listener) => listener(reason))
		);
		server.closeIdleConnections();
		await closed;
	} catch (error) {
		console.error('Shutdown failed', error);
		server.closeAllConnections();
		process.exitCode = 1;
	} finally {
		clearTimeout(deadline);
	}
}
process.on('SIGTERM', () => {
	void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
	void shutdown('SIGINT');
});
