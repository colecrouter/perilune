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
	const record = (value: unknown): Record<string, unknown> =>
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const extruder = record(sections.extruder),
		printer = record(sections.printer);
	const positive = (value: unknown) => {
		const result = Number(value);
		return Number.isFinite(result) && result > 0 ? result : null;
	};
	const nozzle = positive(extruder.nozzle_diameter),
		diameter = positive(extruder.filament_diameter),
		velocity = positive(printer.max_velocity);
	const defaultVelocity =
		nozzle && diameter && velocity
			? (velocity * 4 * nozzle ** 2) / (Math.PI * (diameter / 2) ** 2)
			: null;
	const maxVelocity = positive(extruder.max_extrude_only_velocity ?? defaultVelocity);
	const maxDistance = positive(extruder.max_extrude_only_distance ?? 50);
	const native = [
		'G0',
		'G1',
		'G90',
		'G91',
		'M82',
		'M83',
		'M220',
		'M221',
		'M400',
		'SAVE_GCODE_STATE',
		'RESTORE_GCODE_STATE'
	];
	const reason = !['cartesian', 'corexy'].includes(String(printer.kinematics))
		? 'Assisted handling currently supports Cartesian and CoreXY printers.'
		: objects.some(
					(name) =>
						/^extruder\d+$/.test(name) ||
						[
							'dual_carriage',
							'skew_correction',
							'bed_tilt',
							'axis_twist_compensation',
							'z_thermal_adjust'
						].includes(name) ||
						name.startsWith('manual_stepper ')
			  )
			? 'Use printer macros for multiple tools, dual carriages or skew correction.'
			: !objects.includes('extruder') || !objects.includes('gcode_move')
				? 'Extruder and G-code position telemetry are required for assisted handling.'
				: objects.some(
							(name) =>
								name.startsWith('gcode_macro ') && native.includes(name.slice(12).toUpperCase())
					  )
					? 'Native movement or state commands are overridden. Use reviewed printer macros instead.'
					: !maxDistance || !maxVelocity
						? 'Configured extrusion distance and velocity limits are required.'
						: null;

	return {
		fingerprint,
		macros,
		pauseResume: objects.includes('pause_resume'),
		m600,
		assisted: {
			supported: reason === null,
			reason,
			maxDistance,
			maxVelocity,
			customPause: objects.some((name) => name.toUpperCase() === 'GCODE_MACRO PAUSE')
		},
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
