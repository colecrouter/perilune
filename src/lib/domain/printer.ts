import { Data, Schema } from 'effect';

export class CommandRejected extends Data.TaggedError('CommandRejected')<{ message: string }> {}

export const PrinterCommand = Schema.Union([
	Schema.Struct({ type: Schema.Literal('pause') }),
	Schema.Struct({ type: Schema.Literal('resume') }),
	Schema.Struct({
		type: Schema.Literal('cancel'),
		coolBed: Schema.Boolean,
		coolNozzle: Schema.Boolean
	}),
	Schema.Struct({
		type: Schema.Literal('temperature'),
		heater: Schema.Literals(['bed', 'nozzle']),
		target: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 300 }))
	})
]);
export type PrinterCommand = typeof PrinterCommand.Type;
export const ActionRequest = Schema.Struct({
	id: Schema.String.check(Schema.isUUID()),
	command: PrinterCommand
});
export type ActionRequest = typeof ActionRequest.Type;
export type ActionStatus = 'queued' | 'sending' | 'completed' | 'failed' | 'unknown';
export interface ActionRecord {
	id: string;
	label: string;
	status: ActionStatus;
	createdAt: number;
	message: string | null;
}
export interface PrinterSnapshot {
	revision: number;
	updatedAt: number;
	connection: 'connected' | 'disconnected';
	connectionGeneration: number;
	storage: 'healthy' | 'degraded';
	job: {
		filename: string;
		state: 'printing' | 'paused' | 'cancelled';
		progress: number;
		layer: number;
		totalLayers: number;
		remainingMinutes: number;
	};
	heaters: {
		nozzle: { current: number; target: number };
		bed: { current: number; target: number };
	};
	actions: ActionRecord[];
}
export const initialSnapshot = (): PrinterSnapshot => ({
	revision: 0,
	updatedAt: Date.now(),
	connection: 'connected',
	connectionGeneration: 0,
	storage: 'healthy',
	job: {
		filename: 'orbital-bracket.gcode',
		state: 'printing',
		progress: 42,
		layer: 84,
		totalLayers: 200,
		remainingMinutes: 38
	},
	heaters: { nozzle: { current: 210, target: 210 }, bed: { current: 60, target: 60 } },
	actions: []
});
export function actionLabel(command: PrinterCommand): string {
	switch (command.type) {
		case 'pause':
			return 'Pause print';
		case 'resume':
			return 'Resume print';
		case 'cancel':
			return 'Stop print';
		case 'temperature':
			return `Set ${command.heater} to ${command.target}°C`;
	}
}
/** Validate against the current state at execution time, not the browser's stale view. */
export function applyCommand(state: PrinterSnapshot, command: PrinterCommand): PrinterSnapshot {
	const next = structuredClone(state);
	if (command.type === 'temperature') {
		const maximum = command.heater === 'bed' ? 120 : 300;
		if (command.target < 0 || command.target > maximum)
			throw new CommandRejected({ message: `Target must be between 0 and ${maximum}°C` });
		next.heaters[command.heater].target = command.target;
	} else if (command.type === 'pause') {
		if (state.job.state !== 'printing')
			throw new CommandRejected({ message: 'The print is no longer running' });
		next.job.state = 'paused';
	} else if (command.type === 'resume') {
		if (state.job.state !== 'paused')
			throw new CommandRejected({ message: 'The print is no longer paused' });
		next.job.state = 'printing';
	} else {
		if (state.job.state === 'cancelled')
			throw new CommandRejected({ message: 'The print is already stopped' });
		next.job.state = 'cancelled';
		if (command.coolBed) next.heaters.bed.target = 0;
		if (command.coolNozzle) next.heaters.nozzle.target = 0;
	}
	return next;
}
