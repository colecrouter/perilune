import type { PrinterSnapshot } from './printer.js';
export interface TemperatureSensor {
	id: string;
	label: string;
	current: number | null;
	target: number | null;
	heater: boolean;
}
export interface TemperatureSample {
	at: number;
	readings: Record<string, { current: number | null; target: number | null }>;
}
export const temperatureFields = (name: string): string[] | null =>
	/^(extruder\d*|heater_bed|heater_generic .+|temperature_fan .+)$/.test(name)
		? ['temperature', 'target']
		: /^temperature_sensor .+/.test(name)
			? ['temperature']
			: null;
export function temperatureSensors(state: PrinterSnapshot): TemperatureSensor[] {
	const primary: TemperatureSensor[] = [
		{ id: 'extruder', label: 'Nozzle', ...state.heaters.nozzle, heater: true },
		{ id: 'heater_bed', label: 'Bed', ...state.heaters.bed, heater: true }
	];
	return [
		...primary.filter(
			(sensor) =>
				state.mode === 'simulator' ||
				state.availableObjects.length === 0 ||
				state.availableObjects.includes(sensor.id)
		),
		...state.additionalTemperatures
	];
}
export function appendTemperatureSample(
	history: TemperatureSample[],
	state: PrinterSnapshot,
	at: number
): TemperatureSample[] {
	const last = history.at(-1);
	if (last && at <= last.at) return history;
	const ready = state.connection === 'connected' && state.klippy === 'ready';
	const readings = Object.fromEntries(
		temperatureSensors(state).map((sensor) => [
			sensor.id,
			{
				current: ready && Number.isFinite(sensor.current) ? sensor.current : null,
				target: ready && Number.isFinite(sensor.target) ? sensor.target : null
			}
		])
	);
	return [...history.filter((sample) => at - sample.at <= 3_600_000), { at, readings }].slice(-721);
}
export function heaterState(
	current: number | null,
	target: number | null,
	available = true
): string {
	if (!available || current === null || target === null) return 'Unknown';
	if (target === 0) return current > 35 ? 'Cooling' : 'Off';
	if (Math.abs(current - target) <= 2) return 'Holding';
	return current < target ? 'Heating' : 'Cooling';
}
/** Off refers to the requested targets, not the current surface temperature. */
export function heaterTargetsOff(state: Pick<PrinterSnapshot, 'heaters'>): boolean {
	return state.heaters.nozzle.target === 0 && state.heaters.bed.target === 0;
}
export function temperatureReason(
	state: PrinterSnapshot,
	heater?: 'nozzle' | 'bed',
	includePending = true
): string | null {
	if (state.configurationBusy) return 'Configuration recovery owns the printer.';
	if (state.liveRecovery) return state.liveRecovery.message;
	if (state.mode === 'moonraker' && !state.liveControls)
		return 'Live temperature controls are read-only until coordinated printer testing.';
	if (state.connection !== 'connected' || state.klippy !== 'ready')
		return 'Wait for the printer to reconnect and become ready.';
	if (state.storage !== 'healthy') return 'Action storage is recovering. Please wait.';
	if (heater && state.motion.calibration)
		return 'Calibration owns the heater controls. Finish or cancel it first.';
	if (heater && (state.heaters[heater].current === null || state.heaters[heater].target === null))
		return 'Heater telemetry is unavailable.';
	if (
		includePending &&
		state.actions.some((action) => ['queued', 'sending'].includes(action.status))
	)
		return 'Another action is pending. Wait for it to finish.';
	return null;
}
