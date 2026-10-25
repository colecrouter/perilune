import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { moonPhasePath } from '../src/lib/domain/moon.ts';

// Static brand artwork only: no printer state, media, account or deployment data.
const stars = [
	[72, 76, 1.5],
	[357, 58, 1],
	[621, 93, 1.3],
	[1114, 86, 1.4],
	[1082, 538, 1],
	[680, 561, 1.5],
	[92, 528, 1],
	[514, 491, 1],
	[993, 366, 1.2],
	[826, 64, 1],
	[1158, 390, 1]
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#15182a"/>
<g fill="#c9c3ec" opacity=".65">${stars.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
<circle cx="1100" cy="-62" r="330" fill="none" stroke="#c9c3ec" stroke-opacity=".4" stroke-width="1.5" stroke-dasharray="2 10"/>
<g transform="translate(914 210) scale(1.6)"><path d="${moonPhasePath(0.23)}" fill="#edece8"/><circle cx="27" cy="30" r="5" fill="#c9c3ec"/></g>
<text x="84" y="266" fill="#edece8" font-family="Georgia,serif" font-size="108">Perilune</text>
<text x="88" y="340" fill="#e3e2f5" font-family="Arial,sans-serif" font-size="36">Your printer, in orbit.</text>
<path d="M88 397h72" stroke="#70b4a9" stroke-width="4"/>
<text x="88" y="462" fill="#b8bed1" font-family="Arial,sans-serif" font-size="26">A calm home for your Klipper printer.</text>
</svg>`;
await writeFile('static/social-card.svg', svg);
await sharp(Buffer.from(svg)).png().toFile('static/social-card.png');
console.log('Generated static 1200×630 brand card.');
