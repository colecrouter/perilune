import { expect, test } from 'vite-plus/test';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vite-plus/test/browser';
import BedMeshInspector from './BedMeshInspector.svelte';
import { simulatedBedMesh, emptyBedMesh } from '#lib/domain/bed-mesh.js';

test('selection and comparison survive reconnect telemetry; inspecting a profile emits no commands', async () => {
	const meshState = simulatedBedMesh();
	const screen = await render(BedMeshInspector, { meshState, simulator: true });
	await screen.getByRole('combobox', { name: 'Inspect mesh' }).selectOptions('profile:cold-bed');
	await screen.getByRole('combobox', { name: 'Compare with' }).selectOptions('active');
	await expect.element(screen.getByText('Difference range', { exact: true })).toBeVisible();
	await screen.getByRole('spinbutton', { name: 'Row (Y)' }).fill('3');
	await screen.rerender({ fresh: false, meshState: { ...meshState } });
	await expect.element(screen.getByRole('spinbutton', { name: 'Row (Y)' })).toHaveValue(3);
	await expect
		.element(screen.getByRole('combobox', { name: 'Inspect mesh' }))
		.toHaveValue('profile:cold-bed');
	await expect.element(screen.getByText(/Retained mesh data is stale/)).toBeVisible();
	await screen.getByRole('button', { name: /X 20.0, Y 110.0:/ }).click();
	await userEvent.keyboard('{ArrowUp}');
	await expect.element(screen.getByRole('spinbutton', { name: 'Row (Y)' })).toHaveValue(4);
	await screen.getByText('All sample values', { exact: true }).click();
	await expect.element(screen.getByRole('table')).toBeVisible();
});
test('missing and incompatible profiles have explicit fallback messages', async () => {
	const meshState = simulatedBedMesh();
	meshState.profiles[1].min = [21, 20];
	const screen = await render(BedMeshInspector, { meshState });
	await screen.getByRole('combobox', { name: 'Compare with' }).selectOptions('profile:cold-bed');
	await expect
		.element(screen.getByText(/point-by-point comparison would be misleading/))
		.toBeVisible();
	await screen.rerender({ meshState: emptyBedMesh() });
	await expect
		.element(screen.getByRole('heading', { name: 'Bed mesh is not available' }))
		.toBeVisible();
});

test('LayerChart isometric view rotates, resets and retains true numeric values', async () => {
	const meshState = simulatedBedMesh();
	const screen = await render(BedMeshInspector, { meshState });
	await screen.getByRole('button', { name: 'Isometric', exact: true }).click();
	const rotation = screen.getByRole('slider', { name: 'Rotation', exact: true });
	await expect.element(rotation).toHaveValue('-45');
	const original =
		document.querySelector('.surface-chart .lc-spline')?.getAttribute('d') ??
		document.querySelector('.surface-chart path')?.getAttribute('d');
	await rotation.fill('20');
	await expect.element(rotation).toHaveValue('20');
	await screen.getByRole('combobox', { name: 'Height scale', exact: true }).selectOptions('1');
	await expect.element(screen.getByRole('combobox', { name: 'Height scale' })).toHaveValue('1');
	await screen.rerender({ fresh: false, meshState: { ...meshState } });
	await expect.element(rotation).toHaveValue('20');
	await screen.getByRole('button', { name: 'Reset view', exact: true }).click();
	await expect.element(rotation).toHaveValue('-45');
	await expect.element(screen.getByRole('combobox', { name: 'Height scale' })).toHaveValue('100');
	await expect.element(screen.getByText('X 20.0 · Y 20.0 mm', { exact: true })).toBeVisible();
	expect(original).toBeTruthy();
	await screen.getByRole('button', { name: 'Top-down', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'X 20.0, Y 20.0: +0.034 mm', exact: true }))
		.toBeVisible();
});

test('negative mesh heights stay within the isometric viewport at high amplification', async () => {
	const meshState = simulatedBedMesh();
	meshState.active!.points = meshState.active!.points.map((row) => row.map((value) => value - 1));
	const screen = await render(BedMeshInspector, { meshState });
	await screen.getByRole('button', { name: 'Isometric', exact: true }).click();
	await screen.getByRole('combobox', { name: 'Height scale', exact: true }).selectOptions('300');
	await expect.poll(() => document.querySelectorAll('.surface-chart circle').length).toBe(25);
	const root = document.querySelector('.surface-chart')!.getBoundingClientRect();
	const samples = [...document.querySelectorAll('.surface-chart circle')].map((node) =>
		node.getBoundingClientRect()
	);
	expect(
		samples.every(
			(point) =>
				point.top >= root.top &&
				point.bottom <= root.bottom &&
				point.left >= root.left &&
				point.right <= root.right
		)
	).toBe(true);
	await expect.element(screen.getByText('X 20.0 · Y 20.0 mm', { exact: true })).toBeVisible();
});

test('shared legend marks zero and the selected sample for flat, signed and difference meshes', async () => {
	const meshState = simulatedBedMesh();
	meshState.active!.points = [
		[-0.2, 0.1],
		[0, 0.2]
	];
	const screen = await render(BedMeshInspector, { meshState });
	await expect.element(screen.getByText('0 · reference', { exact: true })).toBeVisible();
	expect((document.querySelector('.selected-marker') as HTMLElement).style.left).toBe('0%');
	await screen.getByRole('spinbutton', { name: 'Row (Y)' }).fill('2');
	await screen.getByRole('spinbutton', { name: 'Column (X)' }).fill('2');
	await expect
		.poll(() => (document.querySelector('.selected-marker') as HTMLElement).style.left)
		.toBe('100%');
	await screen.getByRole('button', { name: 'Isometric', exact: true }).click();
	await expect.poll(() => document.querySelectorAll('.mesh-segment').length).toBe(4);
	await expect
		.poll(
			() =>
				new Set(
					[...document.querySelectorAll('.mesh-segment')].map((n) => n.getAttribute('stroke'))
				).size
		)
		.toBeGreaterThan(1);
	await expect.poll(() => document.querySelectorAll('.selected-sample').length).toBe(1);
	await expect
		.element(screen.getByText('View controls & height scale', { exact: true }))
		.toBeVisible();
	expect((document.querySelector('.surface-help') as HTMLDetailsElement).open).toBe(false);
	await screen.getByText('View controls & height scale', { exact: true }).click();
	await expect.element(screen.getByText(/Lines connect adjacent reported samples/)).toBeVisible();
	await screen.rerender({
		meshState: {
			...meshState,
			active: {
				...meshState.active!,
				points: [
					[0, 0],
					[0, 0]
				]
			},
			profiles: [
				{
					...meshState.active!,
					name: 'flat',
					points: [
						[0, 0],
						[0, 0]
					]
				}
			]
		}
	});
	await expect
		.poll(() => (document.querySelector('.selected-marker') as HTMLElement).style.left)
		.toBe('50%');
	await expect.element(screen.getByText('0 · reference', { exact: true })).toBeVisible();
	await screen.getByRole('combobox', { name: 'Compare with' }).selectOptions('profile:flat');
	await expect.element(screen.getByText('0 · no change', { exact: true })).toBeVisible();
});

test('colored isometric connections meet reported sample centers after rotation', async () => {
	const screen = await render(BedMeshInspector, { meshState: simulatedBedMesh() });
	await screen.getByRole('button', { name: 'Isometric', exact: true }).click();
	await screen.getByRole('slider', { name: 'Rotation', exact: true }).fill('35');
	await expect.poll(() => document.querySelectorAll('.mesh-segment').length).toBe(40);
	const circles = [...document.querySelectorAll('.mesh-sample')].map((node) => {
		const r = node.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	});
	for (const node of document.querySelectorAll('.mesh-segment')) {
		const line = node as SVGLineElement,
			matrix = line.getScreenCTM()!;
		for (const [x, y] of [
			[line.x1.baseVal.value, line.y1.baseVal.value],
			[line.x2.baseVal.value, line.y2.baseVal.value]
		]) {
			const p = new DOMPoint(x, y).matrixTransform(matrix);
			expect(circles.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 1)).toBe(true);
		}
	}
});

test('renders and rotates the largest supported grid without changing its sample count', async () => {
	const meshState = simulatedBedMesh();
	meshState.active!.points = Array.from({ length: 65 }, (_, y) =>
		Array.from({ length: 65 }, (_, x) => (x - y) * 0.001)
	);
	const start = performance.now();
	const screen = await render(BedMeshInspector, { meshState, showProfiles: false });
	await screen.getByRole('button', { name: 'Isometric', exact: true }).click();
	await expect.poll(() => document.querySelectorAll('.mesh-segment').length).toBe(8320);
	await expect.poll(() => document.querySelectorAll('.mesh-sample').length).toBe(4225);
	const rendered = performance.now();
	await screen.getByRole('slider', { name: 'Rotation', exact: true }).fill('15');
	await expect
		.element(screen.getByRole('slider', { name: 'Rotation', exact: true }))
		.toHaveValue('15');
	console.info(
		JSON.stringify({
			meshSamples: 4225,
			initialRenderMs: Math.round(rendered - start),
			rotateMs: Math.round(performance.now() - rendered)
		})
	);
});
