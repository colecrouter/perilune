import { expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import CalibrationDraft from './CalibrationDraft.svelte';
import { calculateExtrusion } from '#lib/domain/extrusion.js';
const proposal = {
	id: 'proposal',
	ownerId: 'owner',
	createdAt: Date.now(),
	source: 'simulator' as const,
	measurement: calculateExtrusion(7.5, 70, 22)
};
const text = '[extruder]\nrotation_distance: 7.5 # keep\ngear_ratio: 50:10\n';
test('explicit acknowledgments stage only a draft and retain other edits', async () => {
	const onAdd = vi.fn();
	const onDismiss = vi.fn();
	const screen = await render(CalibrationDraft, {
		proposal,
		text,
		path: 'extruder.cfg',
		source: 'simulator',
		includesPresent: true,
		onAdd,
		onDismiss
	});
	await expect.element(screen.getByRole('button', { name: 'Add to this draft' })).toBeDisabled();
	await screen.getByRole('checkbox', { name: /repeated the measurement/ }).click();
	await expect.element(screen.getByRole('button', { name: 'Add to this draft' })).toBeDisabled();
	await screen.getByRole('checkbox', { name: /reviewed included files/ }).click();
	await screen.getByRole('button', { name: 'Add to this draft' }).click();
	expect(onAdd).toHaveBeenCalledExactlyOnceWith({
		path: 'extruder.cfg',
		expectedText: text,
		text: text.replace('7.5', '7.200')
	});
	await screen.rerender({ text: text.replace('7.5', '7.200') });
	await expect
		.poll(() => screen.getByRole('status').element().textContent?.replace(/\s+/g, ' '))
		.toContain('does not save or apply');
	await screen.rerender({ text });
	const includeCheck = screen.getByRole('checkbox', { name: /reviewed included files/ });
	if (!(includeCheck.element() as HTMLInputElement).checked) await includeCheck.click();
	await expect.element(screen.getByRole('button', { name: 'Add to this draft' })).toBeEnabled();
	await screen.getByRole('button', { name: 'Dismiss proposal' }).click();
	expect(onDismiss).toHaveBeenCalledOnce();
});
test('draft changes and live mode mismatch refuse staging without touching source', async () => {
	const onAdd = vi.fn();
	const screen = await render(CalibrationDraft, {
		proposal,
		text,
		path: 'printer.cfg',
		source: 'moonraker',
		onAdd,
		onDismiss: vi.fn()
	});
	await expect
		.poll(() => screen.getByRole('status').element().textContent?.replace(/\s+/g, ' '))
		.toContain('Simulator measurements');
	await screen.rerender({ source: 'simulator', text: text.replace('7.5', '8') });
	await expect
		.poll(() => screen.getByRole('status').element().textContent?.replace(/\s+/g, ' '))
		.toContain('differs');
	expect(onAdd).not.toHaveBeenCalled();
});
