/** Waxing lunar terminator: illuminated projected area equals progress. */
export function moonPhasePath(progress: number): string {
	const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
	if (p === 0) return '';
	if (p === 1) return 'M50 2a48 48 0 1 1 0 96a48 48 0 1 1 0-96';
	const boundary = [];
	for (let i = 160; i >= 0; i--) {
		const y = -1 + (2 * i) / 160;
		boundary.push(`${50 + 48 * (1 - 2 * p) * Math.sqrt(Math.max(0, 1 - y * y))} ${50 + 48 * y}`);
	}
	return `M50 2A48 48 0 0 1 50 98L${boundary.join('L')}Z`;
}
