import { afterEach, expect, test } from 'vite-plus/test';
import { page } from 'vite-plus/test/browser';
import { render } from 'vitest-browser-svelte';
import LayoutStateGallery from './LayoutStateGallery.svelte';
import '#lib/styles.css';
afterEach(async () => {
	await page.viewport(1280, 720);
});
test.each([1440, 390, 320])(
	'workflow states preserve control positions and drafts at %spx',
	async (width) => {
		await page.viewport(width, 900);
		const screen = await render(LayoutStateGallery);
		await document.fonts.ready;
		await screen.getByRole('textbox', { name: 'Retained fixture draft' }).fill('My unsaved work');
		const select = (selector: string) => document.querySelector<HTMLElement>(selector)!;
		const notice = select('.workflow-notice');
		const submit = select('.fixture-submit');
		const heaterInput = select('#nozzle-target');
		const reviewSubmit = select('.review-submit');
		const top = (node: HTMLElement) => node.getBoundingClientRect().top + window.scrollY;
		const initial = {
			notice: notice.getBoundingClientRect().height,
			submit: top(submit),
			heater: top(heaterInput),
			review: top(reviewSubmit)
		};
		for (const state of ['Loading', 'Pending', 'Success', 'Error', 'Reconnect', 'Ready']) {
			await screen.getByRole('button', { name: state, exact: true }).click();
			expect(notice.getBoundingClientRect().height).toBe(initial.notice);
			expect(top(reviewSubmit)).toBe(initial.review);
			expect(top(submit)).toBe(initial.submit);
			expect(top(heaterInput)).toBe(initial.heater);
			await expect
				.element(screen.getByRole('textbox', { name: 'Retained fixture draft' }))
				.toHaveValue('My unsaved work');
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
		}
	}
);
