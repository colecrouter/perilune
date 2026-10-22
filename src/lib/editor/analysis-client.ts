import { analyseSource, type Problem } from './config-analysis.js';
export const INLINE_ANALYSIS_LIMIT = 32 * 1024;
/** One running request and one replaceable pending request; disposal resolves every caller. */
export function createAnalysisClient(
	factory = () => new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
) {
	type Request = { id: number; path: string; text: string; resolve: (problems: Problem[]) => void };
	let worker: Worker | undefined,
		active: Request | undefined,
		queued: Request | undefined,
		sequence = 0,
		disposed = false;
	const unavailable = (request: Request): Problem[] => [
		{
			path: request.path,
			from: 0,
			to: 0,
			line: 1,
			severity: 'info',
			message:
				'Language analysis is unavailable for this file. Editing, export and reviewed saves remain available.'
		}
	];
	const send = (request: Request) => {
		active = request;
		try {
			worker!.postMessage({ id: request.id, path: request.path, text: request.text });
		} catch {
			fail();
		}
	};
	const fail = () => {
		if (active) active.resolve(unavailable(active));
		if (queued) queued.resolve(unavailable(queued));
		active = queued = undefined;
		worker?.terminate();
		worker = undefined;
	};
	return {
		analyse(path: string, text: string): Promise<Problem[]> {
			if (disposed) return Promise.resolve([]);
			if (text.length <= INLINE_ANALYSIS_LIMIT || text.length > 262144) {
				active?.resolve([]);
				queued?.resolve([]);
				queued = undefined;
				return Promise.resolve(analyseSource(path, text).problems);
			}
			return new Promise((resolve) => {
				const request = { id: ++sequence, path, text, resolve };
				if (!worker) {
					try {
						worker = factory();
					} catch {
						resolve(unavailable(request));
						return;
					}
					worker.onmessage = ({ data }) => {
						if (disposed || !active || data.id !== active.id) return;
						active.resolve(data.failed ? unavailable(active) : data.problems);
						active = undefined;
						if (queued) {
							const next = queued;
							queued = undefined;
							send(next);
						}
					};
					worker.onerror = () => fail();
				}
				if (active) {
					active.resolve([]);
					queued?.resolve([]);
					queued = request;
				} else send(request);
			});
		},
		destroy() {
			disposed = true;
			active?.resolve([]);
			queued?.resolve([]);
			active = queued = undefined;
			worker?.terminate();
			worker = undefined;
		}
	};
}
