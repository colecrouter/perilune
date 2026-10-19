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

test('pending feedback follows execution and routine success is silent', async () => {
	const screen = await render(ActionFeedback, { receipt });
	await expect
		.element(screen.getByText('Pause print: Waiting to run', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	await screen.rerender({ receipt: { ...receipt, status: 'sending' } });
	await expect.element(screen.getByText('Pause print: In progress', { exact: true })).toBeVisible();
	await screen.rerender({
		receipt: { ...receipt, status: 'completed', message: 'The print is paused.' }
	});
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	await expect
		.element(screen.getByText('The print is paused.', { exact: true }))
		.not.toBeInTheDocument();
});

test('a failure after quiet success remains actionable and uncertain outcomes never suggest retrying', async () => {
	const screen = await render(ActionFeedback, { receipt: { ...receipt, status: 'completed' } });
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	await screen.rerender({
		receipt: { ...receipt, id: 'next', status: 'unknown' },
		receiptBase: '/safety'
	});
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
	await expect
		.element(screen.getByRole('link', { name: 'Review action' }))
		.toHaveAttribute('href', '/safety/next');
	await screen.rerender({
		receipt: { ...receipt, status: 'failed', message: 'Printer rejected this action.' }
	});
	await expect.element(screen.getByRole('alert')).toBeVisible();
	await expect
		.element(screen.getByText('Printer rejected this action.', { exact: true }))
		.toBeVisible();
});

test('a workflow can retain its completion anchor without claiming printer telemetry', async () => {
	const screen = await render(ActionFeedback, { receipt, showCompleted: true });
	await screen.rerender({
		receipt: { ...receipt, status: 'completed', message: 'Execution acknowledged.' }
	});
	await expect.element(screen.getByRole('status')).toBeVisible();
	await expect
		.element(screen.getByText('Pause print: Command completed', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
	await screen.rerender({ receipt: { ...receipt, status: 'unknown', message: null } });
	await expect.element(screen.getByRole('alert')).toBeVisible();
	await expect.element(screen.getByRole('link', { name: 'Review action' })).toBeVisible();
});
