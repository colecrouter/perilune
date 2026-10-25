import { expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import SettingSwitch from './SettingSwitch.svelte';

test('supports native keyboard, form data and accessible on/off state', async () => {
	const onchange = vi.fn();
	const screen = await render(SettingSwitch, {
		'aria-label': 'Serif headings',
		name: 'serif',
		onchange
	});
	const control = screen.getByRole('switch', { name: 'Serif headings' });
	await expect.element(control).not.toBeChecked();
	const input = document.querySelector<HTMLInputElement>('input[role=switch]')!;
	input.focus();
	await userEvent.keyboard(' ');
	await expect.element(control).toBeChecked();
	expect(onchange).toHaveBeenCalledTimes(1);
	const form = document.createElement('form');
	document.body.append(form);
	form.append(input);
	expect(new FormData(form).get('serif')).toBe('on');
	const fieldset = document.createElement('fieldset');
	form.append(fieldset);
	fieldset.append(input);
	fieldset.disabled = true;
	expect(input.matches(':disabled')).toBe(true);
	expect(new FormData(form).has('serif')).toBe(false);
	// Return the node before cleanup so render ownership stays intact.
	screen.container.querySelector('.setting-switch')!.prepend(input);
	form.remove();
});

test('reflects controlled state and prevents changes when disabled', async () => {
	const screen = await render(SettingSwitch, {
		'aria-label': 'Quiet hours',
		checked: true,
		disabled: true
	});
	await expect.element(screen.getByRole('switch', { name: 'Quiet hours' })).toBeChecked();
	await expect.element(screen.getByRole('switch', { name: 'Quiet hours' })).toBeDisabled();
});
