import { Context, Effect, Layer } from 'effect';
import { createAccountMailTransport } from './account-mail-transport.js';
import type { AuthService } from './auth/service.js';
import type { mailConfig } from './auth/mail-config.js';
export class AccountMailService extends Context.Service<AccountMailService, { enabled: boolean }>()(
	'perilune/AccountMailService'
) {}
type Store = Pick<AuthService, 'recoverMail' | 'claimMail' | 'finishMail'>;
type Transport = {
	sendMail: (mail: {
		from: string;
		to: string;
		subject: string;
		text: string;
	}) => Promise<{ accepted: unknown[] }>;
	close: () => void;
};
export const accountMailLayer = (
	store: Store | undefined,
	config: ReturnType<typeof mailConfig>,
	createTransport: (
		config: NonNullable<ReturnType<typeof mailConfig>>
	) => Transport = createAccountMailTransport
) =>
	Layer.effect(
		AccountMailService,
		Effect.gen(function* () {
			if (!config || !store) return { enabled: false };
			store.recoverMail();
			const transport = createTransport(config);
			let sending: Promise<void> | undefined,
				checkpoint: { id: string; status: 'sent' | 'failed' | 'unknown' } | undefined;
			yield* Effect.addFinalizer(() =>
				Effect.promise(async () => {
					transport.close();
					await sending?.catch(() => {});
				})
			);
			yield* Effect.gen(function* () {
				while (true) {
					yield* Effect.tryPromise(
						() =>
							(sending = (async () => {
								if (checkpoint) {
									store.finishMail(checkpoint.id, checkpoint.status);
									checkpoint = undefined;
									return;
								}
								const mail = store.claimMail();
								if (!mail) return;
								let status: 'sent' | 'failed' | 'unknown';
								try {
									const result = await transport.sendMail({
										from: config.from,
										to: mail.to,
										subject: mail.subject,
										text: mail.text
									});
									status = result.accepted.length ? 'sent' : 'failed';
								} catch {
									status = 'unknown';
								}
								checkpoint = { id: mail.id, status };
								store.finishMail(mail.id, status);
								checkpoint = undefined;
							})())
					).pipe(Effect.catch(() => Effect.void));
					yield* Effect.sleep('500 millis');
				}
			}).pipe(Effect.forkScoped);
			return { enabled: true };
		})
	);
