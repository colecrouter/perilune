import { createHash } from 'node:crypto';
import type { FilamentChangeCapability } from '#lib/domain/filament-change.js';
import { discoverMacros } from '#lib/domain/console.js';

/** Raw configuration stays in the backend; only names, a digest and fixed findings leave it. */
export function filamentChangeCapability(
	objects: string[],
	config: unknown
): FilamentChangeCapability | null {
	if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
	const sections = config as Record<string, unknown>;
	const macros = discoverMacros(objects, {}).map((macro) => macro.name);
	// Hash all sections: macros can reference geometry and arbitrary config values.
	const canonical = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(canonical);
		if (value && typeof value === 'object')
			return Object.fromEntries(
				Object.entries(value)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, item]) => [key, canonical(item)])
			);
		return value;
	};
	const fingerprint = createHash('sha256')
		.update(JSON.stringify([objects.slice().sort(), canonical(sections)]))
		.digest('hex');
	const m600 = macros.includes('M600');
	return {
		fingerprint,
		macros,
		pauseResume: objects.includes('pause_resume'),
		m600,
		findings: [
			m600
				? 'M600 is registered as a printer macro. Its behavior has not been verified.'
				: 'No loaded M600 macro was found. Other custom change macros may still be available.',
			macros.includes('RESUME')
				? 'A custom RESUME macro is loaded; it may purge or require more than one explicit Resume.'
				: 'No custom RESUME macro was found.',
			'Parking, unloading, heater timeouts and runout handling must be reviewed on the printer. Perilune will not add duplicate movements to a printer macro.'
		]
	};
}
