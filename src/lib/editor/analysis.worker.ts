import { analyseSource } from './config-analysis.js';
const scope = globalThis as unknown as {
	onmessage: (event: MessageEvent<{ id: number; path: string; text: string }>) => void;
	postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
	try {
		scope.postMessage({ id: data.id, problems: analyseSource(data.path, data.text).problems });
	} catch {
		scope.postMessage({ id: data.id, failed: true });
	}
};
