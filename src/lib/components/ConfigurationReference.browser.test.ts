import { afterEach, expect, test, vi } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import ConfigurationReference from './ConfigurationReference.svelte';
import { parseKlipperReference } from '#lib/domain/klipper-reference.js';
const catalogue = parseKlipperReference(
	'## Common\n```\n[printer]\n#square_corner_velocity: 5.0\n#   Corner speed. The default is 5.0.\n```\n## Cartesian kinematics\n```\n[printer]\nkinematics: cartesian\n#max_z_velocity:\n#   Vertical speed limit.\n```\n## Linear delta kinematics\n```\n[printer]\nkinematics: delta\n#max_z_velocity:\n#   Delta vertical limit.\n```',
	{
		revision: 'a'.repeat(40),
		sha256: 'b'.repeat(64),
		url: 'https://example.test/source',
		license: 'GPL-3.0',
		licenseUrl: 'https://example.test/license'
	}
);
afterEach(() => vi.unstubAllGlobals());
test('reference examples never prefill values and include acknowledgement gates explicit draft additions', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(catalogue)));
	const text = '[include motors.cfg]\n[printer]\nkinematics: cartesian\n';
	const onAdd = vi.fn();
	const screen = await render(ConfigurationReference, { text, path: 'printer.cfg', onAdd });
	await screen.getByRole('button', { name: /square_corner_velocity/ }).click();
	await expect.element(screen.getByRole('textbox', { name: 'Explicit value' })).toHaveValue('');
	await expect.element(screen.getByRole('button', { name: 'Add to draft' })).toBeDisabled();
	await screen.getByRole('textbox', { name: 'Explicit value' }).fill('4');
	await expect.element(screen.getByRole('button', { name: 'Add to draft' })).toBeDisabled();
	await screen.getByRole('checkbox', { name: /I checked included files/ }).click();
	await screen.getByRole('button', { name: 'Add to draft' }).click();
	expect(onAdd).toHaveBeenCalledWith({
		path: 'printer.cfg',
		expectedText: text,
		text: text + 'square_corner_velocity: 4\n'
	});
	await screen.rerender({ text: text + 'square_corner_velocity: 4\n' });
	await expect
		.element(screen.getByRole('textbox', { name: 'Explicit value' }))
		.not.toBeInTheDocument();
});
test('changing documentation context allows browsing but blocks mismatched local kinematics', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(catalogue)));
	const onAdd = vi.fn();
	const screen = await render(ConfigurationReference, {
		text: '[printer]\nkinematics: cartesian\n',
		path: 'printer.cfg',
		onAdd
	});
	await screen.getByRole('combobox', { name: 'Documentation context' }).selectOptions('delta');
	await screen.getByRole('button', { name: /max_z_velocity/ }).click();
	await expect.element(screen.getByText(/differs from the local kinematics/)).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Add to draft' }))
		.not.toBeInTheDocument();
	expect(onAdd).not.toHaveBeenCalled();
});
test('reference failure is recoverable without changing source', async () => {
	const fetcher = vi
		.fn()
		.mockRejectedValueOnce(new Error('offline'))
		.mockResolvedValueOnce(Response.json(catalogue));
	vi.stubGlobal('fetch', fetcher);
	const onAdd = vi.fn();
	const screen = await render(ConfigurationReference, {
		text: '[printer]\n',
		path: 'printer.cfg',
		onAdd
	});
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent(
			'The reference could not be loaded. Your source editor and drafts are still available.'
		);
	await screen.getByRole('button', { name: 'Retry reference' }).click();
	await expect
		.element(screen.getByRole('button', { name: /square_corner_velocity/ }))
		.toBeVisible();
	expect(onAdd).not.toHaveBeenCalled();
});

test('reference section selection follows added and removed raw sections without changing source', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(catalogue)));
	const onAdd = vi.fn();
	const screen = await render(ConfigurationReference, {
		text: '# empty\n',
		path: 'printer.cfg',
		onAdd
	});
	await expect.element(screen.getByText(/No existing sections were found/)).toBeVisible();
	await screen.rerender({ text: '[printer]\n' });
	await expect
		.element(screen.getByRole('button', { name: /square_corner_velocity/ }))
		.toBeVisible();
	await screen.rerender({ text: '[extruder]\n' });
	await expect
		.element(screen.getByRole('combobox', { name: 'Section', exact: true }))
		.toHaveValue('extruder');
	await expect
		.element(screen.getByRole('button', { name: /square_corner_velocity/ }))
		.not.toBeInTheDocument();
	expect(onAdd).not.toHaveBeenCalled();
});
