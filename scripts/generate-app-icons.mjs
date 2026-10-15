import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
// Derived from Perilune's existing user-owned telescope photograph and phase geometry.
const texture = (await readFile('static/brand/moon-texture.png')).toString('base64');
const boundary = [];
for (let i = 160; i >= 0; i--) {
	const y = -1 + (2 * i) / 160;
	boundary.push(`${50 + 48 * 0.54 * Math.sqrt(Math.max(0, 1 - y * y))} ${50 + 48 * y}`);
}
const path = `M50 2A48 48 0 0 1 50 98L${boundary.join('L')}Z`;
const svg = (mono = false) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">${mono ? '' : '<rect width="100" height="100" fill="#15182b"/>'}<g transform="translate(17 17) scale(.66)">${mono ? `<path d="${path}" fill="white"/>` : `<defs><clipPath id="moon"><path d="${path}"/></clipPath></defs><image href="data:image/png;base64,${texture}" width="100" height="100" clip-path="url(#moon)"/>`}<circle cx="27" cy="30" r="5" fill="${mono ? 'white' : '#c9c3ec'}"/></g></svg>`;
await mkdir('static/icons', { recursive: true });
for (const size of [180, 192, 512])
	await sharp(Buffer.from(svg())).resize(size, size).png().toFile(`static/icons/app-${size}.png`);
await sharp(Buffer.from(svg())).png().toFile('static/icons/maskable-512.png');
await writeFile('static/icons/monochrome.svg', svg(true));
await sharp(Buffer.from(svg(true)))
	.resize(96, 96)
	.png()
	.toFile('static/icons/badge-96.png');
