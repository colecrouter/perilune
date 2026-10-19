import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import { mp4VideoSize } from './camera-mp4.js';
const init = readFileSync(new URL('../../../scripts/fixtures/camera/init.mp4', import.meta.url));
it('reads dimensions from an actual synthetic fMP4 initialization segment', () => {
	expect(mp4VideoSize(init)).toEqual({ width: 320, height: 180 });
});
it('waits for complete boxes instead of reading truncated track headers', () => {
	for (let n = 0; n < init.length; n += 7) {
		expect(() => mp4VideoSize(init.subarray(0, n))).not.toThrow();
	}
	expect(mp4VideoSize(init.subarray(0, 16))).toBeNull();
});
it('bounds malformed box traversal', () => {
	for (const bytes of [new Uint8Array(8), new Uint8Array([255, 255, 255, 255, 109, 111, 111, 118])])
		expect(mp4VideoSize(bytes)).toBeNull();
});
