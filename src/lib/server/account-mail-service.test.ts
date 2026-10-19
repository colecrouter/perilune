import { expect, it, vi } from 'vite-plus/test';
import { ManagedRuntime } from 'effect';
import { accountMailLayer, AccountMailService } from './account-mail-service.js';
import { mailConfig } from './auth/mail-config.js';
it('keeps SMTP optional and requires complete secure configuration', () => {
	expect(mailConfig({})).toBeNull();
	expect(() =>
		mailConfig({
			PERILUNE_SMTP_HOST: 'mail.example',
			PERILUNE_SMTP_FROM: 'sender@example.test',
			PERILUNE_SMTP_USER: 'user'
		})
	).toThrow();
	expect(
		mailConfig({
			PERILUNE_SMTP_HOST: 'mail.example',
			PERILUNE_SMTP_FROM: 'sender@example.test',
			PERILUNE_SMTP_PORT: '587'
		})
	).toMatchObject({ secure: false, requireTLS: true });
});
it('never resends ambiguous SMTP and retries only a failed status checkpoint', async () => {
	let queued = true,
		checkpointFailures = 1;
	const claimMail = vi.fn(() => {
		if (!queued) return null;
		queued = false;
		return { id: 'mail', to: 'recipient@example.test', subject: 'test', text: 'test' };
	});
	const finishMail = vi.fn(() => {
		if (checkpointFailures-- > 0) throw Error('storage temporarily unavailable');
	});
	const sendMail = vi.fn(async () => {
		throw Error('connection lost after DATA');
	});
	const close = vi.fn(),
		recoverMail = vi.fn();
	const runtime = ManagedRuntime.make(
		accountMailLayer(
			{ claimMail, finishMail, recoverMail },
			mailConfig({ PERILUNE_SMTP_HOST: 'mail.example', PERILUNE_SMTP_FROM: 'sender@example.test' }),
			() => ({ sendMail, close })
		)
	);
	try {
		await runtime.runPromise(AccountMailService);
		await vi.waitFor(() => expect(finishMail).toHaveBeenCalledTimes(2), { timeout: 3000 });
		expect(sendMail).toHaveBeenCalledTimes(1);
		expect(finishMail).toHaveBeenLastCalledWith('mail', 'unknown');
	} finally {
		await runtime.dispose();
	}
	expect(close).toHaveBeenCalledTimes(1);
});
