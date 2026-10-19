import type {
	FilamentChangeCommand,
	FilamentChangeSession,
	FilamentChangeSettings
} from '#lib/domain/filament-change.js';
import type { MoonrakerSnapshot, ControlOperation } from './moonraker.js';
type Position = { x: number; y: number; z: number };
export function sameFilamentPosition(
	a: Position | undefined | null,
	b: Position | undefined | null
): boolean {
	return (
		!!a &&
		!!b &&
		(['x', 'y', 'z'] as const).every(
			(axis) =>
				Number.isFinite(a[axis]) && Number.isFinite(b[axis]) && Math.abs(a[axis] - b[axis]) < 0.05
		)
	);
}
export function assistedFilamentPlan(
	command: Extract<FilamentChangeCommand, { type: 'filamentChangePark' | 'filamentChangeFeed' }>,
	session: FilamentChangeSession,
	settings: FilamentChangeSettings,
	fresh: MoonrakerSnapshot
): { session: FilamentChangeSession; operations: ControlOperation[] } {
	const profile = settings.assisted,
		cap = fresh.filamentChange?.assisted,
		position = fresh.gcodePosition;
	if (
		settings.mode !== 'assisted' ||
		!profile ||
		!cap?.supported ||
		!position ||
		![position.x, position.y, position.z, position.e].every(Number.isFinite) ||
		fresh.filament?.active !== 'extruder'
	)
		throw Error(
			'Assisted handling needs a reviewed profile, standard G-code coordinates and the configured single extruder.'
		);
	const physical = fresh.motion.position;
	if (
		!Object.values(physical).every((value) => typeof value === 'number' && Number.isFinite(value))
	)
		throw Error('Fresh physical position is unavailable.');
	const physicalPosition = physical as Position;
	const next: FilamentChangeSession = { ...session, step: session.step + 1, stage: 'waiting' };
	const name = `perilune_swap_${session.id.replaceAll('-', '')}`;
	const script = (body: string): ControlOperation[] => [
		{
			type: 'controlScript',
			script: `SAVE_GCODE_STATE NAME=${name}\n${body}\nM400\nRESTORE_GCODE_STATE NAME=${name}`
		}
	];
	if (command.type === 'filamentChangePark') {
		if (session.assisted?.parked)
			throw Error('Parking is already verified. It will not be repeated.');
		if (profile.parking === 'printer')
			return {
				session: {
					...next,
					pendingMove: {
						kind: 'park',
						position: { x: position.x, y: position.y, z: position.z },
						physicalPosition: { ...physicalPosition }
					},
					message:
						'Verifying the stationary printer parking you inspected. No park movement was sent.'
				},
				operations: []
			};
		if (cap.customPause)
			throw Error('A custom PAUSE macro may already park. Keep printer parking instead.');
		if (
			fresh.bedMesh.active ||
			fresh.bedMesh.status === 'invalid' ||
			(fresh.availableObjects.includes('bed_mesh') && fresh.bedMesh.status === 'unavailable')
		)
			throw Error(
				'An active or unverified bed mesh changes physical parking height. Use printer parking or a reviewed printer macro.'
			);
		const target = { x: profile.parkX, y: profile.parkY, z: position.z + profile.zLift };
		const delta = { x: target.x - position.x, y: target.y - position.y, z: profile.zLift };
		const physicalTarget = {
			x: physicalPosition.x + delta.x,
			y: physicalPosition.y + delta.y,
			z: physicalPosition.z + delta.z
		};
		for (const axis of ['x', 'y', 'z'] as const) {
			const limits = fresh.motion.limits[axis];
			if (
				!limits ||
				!Number.isFinite(limits.min) ||
				!Number.isFinite(limits.max) ||
				[target[axis], physicalTarget[axis]].some(
					(value) => value < limits.min || value > limits.max
				)
			)
				throw Error('Parking exceeds configured travel or Z headroom. No partial park was sent.');
		}
		if (Math.hypot(delta.x, delta.y) / 30 + profile.zLift / 5 > 90)
			throw Error('This park is too long for a single bounded operation.');
		return {
			session: {
				...next,
				pendingMove: { kind: 'park', position: target, physicalPosition: physicalTarget },
				message:
					'Lifting Z, then parking XY at the reviewed location. No extrusion or return move is included.'
			},
			operations: script(
				`G91\nM220 S100\nG1 Z${profile.zLift.toFixed(3)} F300\nG1 X${delta.x.toFixed(3)} Y${delta.y.toFixed(3)} F1800`
			)
		};
	}
	if (
		!session.assisted?.parked ||
		!sameFilamentPosition(position, session.assisted.position) ||
		!sameFilamentPosition(physicalPosition, session.assisted.physicalPosition)
	)
		throw Error(
			'The verified parking position changed. Inspect and recover guidance before extrusion.'
		);
	if (!fresh.filament.canExtrude || !fresh.heaters.nozzle.target)
		throw Error(
			'The nozzle is cold or its target is off. Explicitly reheat and wait before extrusion.'
		);
	const length = profile[command.operation],
		distance = command.operation === 'unload' ? -length : length;
	if (
		fresh.filament.maxDistance === null ||
		Math.abs(distance) > fresh.filament.maxDistance ||
		cap.maxDistance === null ||
		Math.abs(distance) > cap.maxDistance ||
		cap.maxVelocity === null ||
		profile.speed > cap.maxVelocity ||
		length / profile.speed > 90
	)
		throw Error('This extrusion step exceeds the printer distance, speed or duration limit.');
	return {
		session: {
			...next,
			pendingMove: { kind: 'feed', startE: position.e, distance, operation: command.operation },
			message: `Waiting for ${command.operation} ${length} mm at ${profile.speed} mm/s.`
		},
		operations: script(
			`M83\nM220 S100\nM221 S100\nG1 E${distance.toFixed(3)} F${(profile.speed * 60).toFixed(3)}`
		)
	};
}
