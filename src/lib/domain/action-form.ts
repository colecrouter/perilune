import { Schema } from 'effect';
import { ActionRequest, type PrinterCommand } from './printer.js';
export function parseActionForm(data: FormData): ActionRequest {
	const field = (name: string) => {
		const values = data.getAll(name);
		if (values.length !== 1 || typeof values[0] !== 'string')
			throw new Error(`Missing or repeated ${name}.`);
		return values[0];
	};
	const boolean = (name: string) => {
		const value = field(name);
		if (!['true', 'false'].includes(value)) throw new Error('Invalid choice.');
		return value === 'true';
	};
	const type = field('intent');
	let command: PrinterCommand;
	switch (type) {
		case 'temperature': {
			const raw = field('target');
			if (!raw.trim()) throw new Error('Enter a heater target.');
			command = { type, heater: field('heater') as 'bed' | 'nozzle', target: Number(raw) };
			break;
		}
		case 'cooldown':
			command = { type };
			break;
		case 'home':
			command = { type, axes: field('axes') as 'xy' | 'z' | 'all' };
			break;
		case 'start':
			command = { type, fileId: field('fileId') };
			break;
		case 'pause':
		case 'resume':
		case 'cancel': {
			const expectedJob = { filename: field('filename'), runId: field('runId') || null };
			command =
				type === 'cancel'
					? {
							type,
							expectedJob,
							coolBed: boolean('coolBed'),
							coolNozzle: boolean('coolNozzle')
						}
					: { type, expectedJob };
			if (type === 'cancel' && field('confirmed') !== 'true')
				throw new Error('Confirm stopping this print.');
			break;
		}
		default:
			throw new Error('Unsupported form action.');
	}
	return Schema.decodeUnknownSync(ActionRequest)({ id: field('id'), command });
}
