import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ActionFeedback from './ActionFeedback.svelte';
import type { ActionRecord } from '#lib/domain/printer.js';
const receipt: ActionRecord = {
	id: 'fixture',
	label: 'Pause print',
	status: 'queued',
	createdAt: Date.now(),
	message: null
};

test('feedback follows execution and clears routine success while keeping its durable receipt accessible', async () => {
	const screen = await render(ActionFeedback, { receipt, successDuration: 1000 });
	await expect
		.element(screen.getByText('Pause print: Waiting to run', { exact: true }))
		.toBeVisible();
	await screen.rerender({ receipt: { ...receipt, status: 'sending' } });
	await expect.element(screen.getByText('Pause print: In progress', { exact: true })).toBeVisible();
	await screen.rerender({
		receipt: { ...receipt, status: 'completed', message: 'The print is paused.' }
	});
	await expect.element(screen.getByText('The print is paused.', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('link', { name: 'Check receipt' }))
		.toHaveAttribute('href', '/actions/fixture');
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('failures and uncertain results remain visible, including after a prior success disappears', async () => {
	const screen = await render(ActionFeedback, {
		receipt: { ...receipt, status: 'completed' },
		successDuration: 1
	});
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	await screen.rerender({ receipt: { ...receipt, id: 'next', status: 'unknown' } });
	await expect
		.element(screen.getByText('Pause print: Outcome uncertain', { exact: true }))
		.toBeVisible();
	await expect
		.element(
			screen.getByText(
				'Check the printer and review this action before trying again. It will not be replayed automatically.',
				{ exact: true }
			)
		)
		.toBeVisible();
	await screen.rerender({
		receipt: { ...receipt, status: 'failed', message: 'Printer rejected this action.' }
	});
	await expect
		.element(screen.getByText('Printer rejected this action.', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('link', { name: 'Check receipt' })).toBeVisible();
});

test('identical live receipt updates do not prolong routine success feedback', async () => {
	const completed = { ...receipt, status: 'completed' as const };
	const screen = await render(ActionFeedback, { receipt: completed, successDuration: 500 });
	await expect.element(screen.getByRole('status')).toBeVisible();
	const timer = setInterval(() => {
		void screen.rerender({ receipt: { ...completed } });
	}, 50);
	try {
		await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	} finally {
		clearInterval(timer);
	}
});
