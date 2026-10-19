import { connect as connectNet, isIP, type Socket } from 'node:net';
import { connect as connectTLS } from 'node:tls';
import nodemailer from 'nodemailer';
import type { mailConfig } from './auth/mail-config.js';
/** Own each send's socket: deadline/shutdown closes it, including underneath STARTTLS. */
export function createAccountMailTransport(
	config: NonNullable<ReturnType<typeof mailConfig>>,
	deadlineMs = 20000
) {
	let closed = false;
	const active = new Set<() => void>();
	return {
		sendMail(mail: {
			from: string;
			to: string;
			subject: string;
			text: string;
		}): Promise<{ accepted: unknown[] }> {
			if (closed) return Promise.reject(Error('Mail service stopped.'));
			return new Promise((resolve, reject) => {
				let socket: Socket | undefined,
					aborted = false;
				const stop = () => {
					aborted = true;
					socket?.destroy();
					transport.close();
					clearTimeout(timer);
					active.delete(stop);
					reject(Error('Mail operation stopped or exceeded its deadline.'));
				};
				const transport = nodemailer.createTransport({
					...config,
					getSocket: (
						_options: unknown,
						callback: (
							error: Error | null,
							options?: { connection: Socket; secured: boolean }
						) => void
					) => {
						if (aborted || closed) {
							callback(Error('Mail operation stopped.'));
							return;
						}
						let answered = false;
						const answer = (error: Error | null) => {
							if (answered) return;
							answered = true;
							if (error) callback(error);
							else callback(null, { connection: socket!, secured: config.secure });
						};
						socket = config.secure
							? connectTLS(
									{
										host: config.host,
										port: config.port,
										servername: isIP(config.host) ? undefined : config.host
									},
									() => answer(null)
								)
							: connectNet({ host: config.host, port: config.port }, () => answer(null));
						socket.once('error', answer);
					}
				});
				active.add(stop);
				const timer = setTimeout(stop, deadlineMs);
				transport
					.sendMail(mail)
					.then((result) => resolve({ accepted: result.accepted }), reject)
					.finally(() => {
						clearTimeout(timer);
						active.delete(stop);
						socket?.destroy();
						transport.close();
					});
				// A late getSocket invocation cannot create another connection after stop:
				// its per-send aborted flag remains true, even after the outer promise rejects.
			});
		},
		close() {
			closed = true;
			for (const stop of active) stop();
			active.clear();
		}
	};
}
