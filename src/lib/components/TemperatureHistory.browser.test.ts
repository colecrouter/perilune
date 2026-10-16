import { expect, test } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import TemperatureHistory from './TemperatureHistory.svelte';
const sensors = [
	{ id: 'extruder', label: 'Nozzle', current: 210, target: 215, heater: true },
	{ id: 'temperature_sensor host', label: 'Host', current: 50, target: null, heater: false }
];
const now = Date.now();
const samples = Array.from({ length: 4 }, (_, i) => ({
	at: now - (3 - i) * 5000,
	readings: {
		extruder: { current: i === 2 ? null : 200 + i, target: i === 2 ? null : 215 },
		'temperature_sensor host': { current: 50 + i, target: null }
	}
}));
test('LayerChart renders actual/target lines and keyboard-accessible sample inspection', async () => {
	const screen = await render(TemperatureHistory, { samples, sensors });
	await expect.element(screen.getByRole('slider')).toBeVisible();
	await expect.element(screen.getByText('Actual 203.0°C', { exact: true })).toBeVisible();
	await expect
		.poll(
			() =>
				document
					.querySelector('.temperature-chart path[stroke="var(--accent)"]')
					?.getAttribute('d')
					?.match(/M/g)?.length
		)
		.toBe(2);
	expect(document.querySelector('.temperature-chart path[stroke-dasharray="5 4"]')).not.toBeNull();

	await screen
		.getByRole('combobox', { name: 'Sensor', exact: true })
		.selectOptions('temperature_sensor host');
	await expect.element(screen.getByRole('slider')).toHaveAccessibleName(/Host temperatures/);
	await expect.element(screen.getByText('Actual 53.0°C', { exact: true })).toBeVisible();
});
test('history remains visible during disconnect and missing samples are unavailable', async () => {
	const screen = await render(TemperatureHistory, {
		samples: samples.slice(0, 3),
		sensors,
		connected: false
	});
	await expect.element(screen.getByText('Disconnected · history retained')).toBeVisible();
	await expect.element(screen.getByText('Actual Unavailable', { exact: true })).toBeVisible();
	await expect.element(screen.getByRole('slider')).toBeVisible();
});

test('no-sensor startup has a useful empty state', async () => {
	const screen = await render(TemperatureHistory, { samples: [], sensors: [] });
	await expect.element(screen.getByText('Waiting for temperature sensors…')).toBeVisible();
});

test('inspection selects a point on the plot with a marker and supports keyboard navigation', async () => {
	const screen = await render(TemperatureHistory, { samples, sensors });
	const plot = screen.getByRole('slider');
	await plot.click();
	expect(document.querySelector('.inspection-marker')).not.toBeNull();
	await expect.element(screen.getByText('Actual 201.0°C', { exact: true })).toBeVisible();
	await userEvent.keyboard('{End}');
	await expect.element(screen.getByText('Actual 203.0°C', { exact: true })).toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Return to latest', exact: true }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Return to latest', exact: true }).click();
	expect(document.querySelector('.inspection-marker')).toBeNull();
});

test('combined history plots all sensors with shared inspection and optional focused view', async () => {
	const screen = await render(TemperatureHistory, { samples, sensors, combined: true });
	await expect
		.element(screen.getByRole('combobox', { name: 'Sensor', exact: true }))
		.toHaveValue('*');
	await expect
		.element(screen.getByRole('slider', { name: /All sensor temperatures/ }))
		.toBeVisible();
	await expect
		.element(screen.getByText('Nozzle 203.0°C / 215.0°C target', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByText('Host 53.0°C', { exact: true })).toBeVisible();
	await screen
		.getByRole('combobox', { name: 'Sensor', exact: true })
		.selectOptions('temperature_sensor host');
	await expect.element(screen.getByRole('slider', { name: /Host temperatures/ })).toBeVisible();
	await expect.element(screen.getByText('Actual 53.0°C', { exact: true })).toBeVisible();
});
