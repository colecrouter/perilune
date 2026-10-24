import { userEvent } from 'vite-plus/test/browser';
import { error as reject } from '@sveltejs/kit';
import { expect, test, vi } from 'vite-plus/test';
import { page } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import MotionControls from './MotionControls.svelte';
import { initialSnapshot } from '#lib/domain/printer.js';
const idle = () => {
	const state = initialSnapshot();
	state.job.state = 'cancelled';
	return state;
};
test('the segmented step selector controls fine jogging while preserving other axes', async () => {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	await render(MotionControls, { snapshot: idle(), onSubmit });
	await page.getByRole('radio', { name: '10 mm', exact: true }).click();
	await expect.element(page.getByRole('radio', { name: '10 mm', exact: true })).toBeChecked();
	await page.getByRole('button', { name: 'X −', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith({
		type: 'move',
		target: { x: 100 },
		expectedPosition: { x: 110, y: 110, z: 20 }
	});
});
test('typing previews movement and rejects stale destinations without clearing the input', async () => {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	const state = idle();
	const component = await render(MotionControls, { snapshot: state, onSubmit });
	await page.getByRole('spinbutton', { name: 'X (mm)', exact: true }).fill('30');
	expect(onSubmit).not.toHaveBeenCalled();
	await expect.element(page.getByRole('button', { name: 'Move here', exact: true })).toBeEnabled();
	await component.rerender({
		snapshot: { ...state, motion: { ...state.motion, position: { x: 100, y: 110, z: 20 } } }
	});
	await expect
		.element(page.getByText('The printer moved after this preview.', { exact: false }))
		.toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Move here', exact: true })).toBeDisabled();
	await expect
		.element(page.getByRole('spinbutton', { name: 'X (mm)', exact: true }))
		.toHaveValue(30);
});
test('near-bed lowering needs clearance and typed Z limits explain rejection', async () => {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	await render(MotionControls, { snapshot: idle(), onSubmit });
	await page.getByRole('spinbutton', { name: 'Z (mm)', exact: true }).fill('0');
	await expect.element(page.getByRole('button', { name: 'Move here', exact: true })).toBeDisabled();
	await page.getByRole('checkbox', { name: 'I checked bed clearance before lowering' }).click();
	await page.getByRole('button', { name: 'Move here', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith({
		type: 'move',
		target: { x: 110, y: 110, z: 0 },
		expectedPosition: { x: 110, y: 110, z: 20 },
		confirmedLowering: true
	});
	await page.getByRole('spinbutton', { name: 'Z (mm)', exact: true }).fill('300');
	await expect.element(page.getByText('Z must be 0–250 mm.', { exact: false })).toBeVisible();
	await expect.element(page.getByRole('button', { name: 'Move here', exact: true })).toBeDisabled();
});
test('printing, reconnecting and viewer permissions disable physical controls with reasons', async () => {
	const onSubmit = vi.fn();
	const component = await render(MotionControls, { snapshot: initialSnapshot(), onSubmit });
	await expect.element(page.getByRole('button', { name: 'Home All', exact: true })).toBeDisabled();
	await component.rerender({ snapshot: idle(), transportConnected: false });
	await expect.element(page.getByRole('button', { name: 'X +', exact: true })).toBeDisabled();
	expect(document.body.textContent).not.toMatch(/reconnecting/i);
	await expect.element(page.getByRole('button', { name: 'Home All', exact: true })).toBeDisabled();
	await component.rerender({ transportConnected: true, canOperate: false });
	await expect.element(page.getByRole('button', { name: 'X +', exact: true })).toBeDisabled();
	expect(onSubmit).not.toHaveBeenCalled();
});
test('terminal failures stay visible and Z jogs disable at their boundary', async () => {
	const state = idle();
	state.motion.position.z = 0;
	state.actions = [
		{
			id: 'fixture',
			label: 'Move X 0 mm',
			status: 'unknown',
			createdAt: Date.now(),
			message: 'Connection lost during sending. This action will not be retried.'
		}
	];
	await render(MotionControls, { snapshot: state, onSubmit: vi.fn() });
	await expect.element(page.getByRole('button', { name: 'Z −', exact: true })).toBeDisabled();
	await expect
		.element(page.getByText('Connection lost during sending. This action will not be retried.'))
		.toBeVisible();
});

test('Home All and confirmed motor release have explicit commands', async () => {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	const state = idle();
	state.motion.homed = [];
	await render(MotionControls, { snapshot: state, onSubmit });
	await page.getByRole('button', { name: 'Home All', exact: true }).click();
	expect(onSubmit).toHaveBeenCalledWith({ type: 'home', axes: 'all' });
	onSubmit.mockClear();
	await page.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	expect(onSubmit).not.toHaveBeenCalled();
	await expect.element(page.getByText('Support the gantry:', { exact: false })).toBeVisible();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Disengage motors', exact: true })
		.click();
	expect(onSubmit).toHaveBeenCalledWith({ type: 'releaseMotors', axes: 'all', confirmed: true });
});

test('the vertical Z scale previews without executing movement', async () => {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	await render(MotionControls, { snapshot: idle(), onSubmit });
	await page.getByRole('slider', { name: 'Z height preview', exact: true }).click();
	expect(onSubmit).not.toHaveBeenCalled();
	await expect.element(page.getByRole('button', { name: 'Move here', exact: true })).toBeEnabled();
});

test('already homed axes disable homing, and motor release makes homing available again', async () => {
	const state = idle();
	const onSubmit = vi.fn();
	const component = await render(MotionControls, { snapshot: state, onSubmit });
	await expect.element(page.getByRole('button', { name: 'Home All', exact: true })).toBeDisabled();
	await expect
		.element(page.getByText('All axes are already homed.', { exact: false }))
		.toBeVisible();
	await component.rerender({ snapshot: { ...state, motion: { ...state.motion, homed: [] } } });
	await expect.element(page.getByRole('button', { name: 'Home All', exact: true })).toBeEnabled();
	expect(onSubmit).not.toHaveBeenCalled();
});

test('motor dialog focuses the safe action, traps focus and restores it on Escape without sending', async () => {
	const onSubmit = vi.fn();
	await render(MotionControls, { snapshot: idle(), onSubmit });
	const trigger = page.getByRole('button', { name: 'Disengage motors', exact: true });
	await trigger.click();
	const dialog = page.getByRole('dialog');
	await expect.element(dialog).toBeVisible();
	await expect.element(dialog.getByRole('button', { name: 'Keep motors engaged' })).toHaveFocus();
	await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
	await expect
		.element(dialog.getByRole('button', { name: 'Disengage motors', exact: true }))
		.toHaveFocus();
	await userEvent.keyboard('{Escape}');
	await expect.element(dialog).not.toBeInTheDocument();
	await expect.element(trigger).toHaveFocus();
	expect(onSubmit).not.toHaveBeenCalled();
});
test('motor dialog retains rejections and prevents dismissal or duplicate submission while pending', async () => {
	let finish!: () => void;
	const onSubmit = vi
		.fn()
		.mockImplementationOnce(async () => reject(409, 'Printer became busy.'))
		.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
	await render(MotionControls, { snapshot: idle(), onSubmit });
	await page.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await expect.element(dialog.getByRole('alert')).toHaveTextContent('Printer became busy.');
	await dialog.getByRole('button', { name: 'Disengage motors', exact: true }).click();
	await expect.element(dialog.getByRole('button', { name: 'Disengaging…' })).toBeDisabled();
	await expect.element(dialog.getByRole('button', { name: 'Keep motors engaged' })).toBeDisabled();
	await userEvent.keyboard('{Escape}');
	await expect.element(dialog).toBeVisible();
	finish();
	await expect.element(dialog).not.toBeInTheDocument();
	expect(onSubmit).toHaveBeenCalledTimes(2);
});
