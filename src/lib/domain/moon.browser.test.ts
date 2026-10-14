import { expect, test } from 'vite-plus/test';
import { moonPhasePath } from './moon.js';

test('lunar phases illuminate the requested fraction of the projected disk', () => {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 300;
	const context = canvas.getContext('2d')!;
	for (const progress of [0, 0.1, 0.23, 0.5, 0.75, 1]) {
		context.clearRect(0, 0, 300, 300);
		context.save();
		context.scale(3, 3);
		context.fill(new Path2D(moonPhasePath(progress)));
		context.restore();
		const pixels = context.getImageData(0, 0, 300, 300).data;
		let area = 0;
		for (let i = 3; i < pixels.length; i += 4) area += pixels[i]! / 255;
		expect(Math.abs(area / (Math.PI * 144 ** 2) - progress)).toBeLessThan(0.005);
	}
	expect(moonPhasePath(-1)).toBe(moonPhasePath(0));
	expect(moonPhasePath(2)).toBe(moonPhasePath(1));
	expect(moonPhasePath(Number.NaN)).toBe(moonPhasePath(0));
});
