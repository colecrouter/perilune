import { expect, it, vi } from 'vite-plus/test';
import { createServer, type Socket } from 'node:net';
import { createAccountMailTransport } from './account-mail-transport.js';
import { mailConfig } from './auth/mail-config.js';
async function fixture() {
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on('error', () => {});
		const timer = setInterval(() => socket.write('220-still greeting\r\n'), 10);
		socket.on('close', () => {
			clearInterval(timer);
			sockets.delete(socket);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw Error();
	const config = mailConfig({
		PERILUNE_SMTP_HOST: '127.0.0.1',
		PERILUNE_SMTP_PORT: String(address.port),
		PERILUNE_SMTP_FROM: 'sender@example.test',
		PERILUNE_SMTP_ALLOW_INSECURE: 'true'
	})!;
	return {
		sockets,
		config,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((r) => server.close(() => r()));
		}
	};
}
const mail = {
	from: 'sender@example.test',
	to: 'recipient@example.test',
	subject: 'Test',
	text: 'Test'
};
it('aborts an actively trickling SMTP peer at an absolute deadline', async () => {
	const f = await fixture(),
		transport = createAccountMailTransport(f.config, 100);
	try {
		await expect(transport.sendMail(mail)).rejects.toThrow('deadline');
		await vi.waitFor(() => expect(f.sockets.size).toBe(0));
	} finally {
		transport.close();
		await f.close();
	}
});
it('shutdown closes an active SMTP socket and prevents later sends', async () => {
	const f = await fixture(),
		transport = createAccountMailTransport(f.config);
	try {
		const pending = transport.sendMail(mail);
		const rejected = expect(pending).rejects.toThrow('stopped');
		await vi.waitFor(() => expect(f.sockets.size).toBe(1));
		transport.close();
		await rejected;
		await vi.waitFor(() => expect(f.sockets.size).toBe(0));
		await expect(transport.sendMail(mail)).rejects.toThrow('stopped');
	} finally {
		transport.close();
		await f.close();
	}
});
