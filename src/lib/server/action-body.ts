import { error } from '@sveltejs/kit';
/** Tiny finite form reads must never wait for upload/camera transfer permits. */
export async function readActionBody(request: Request): Promise<FormData> {
	if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
		error(415, 'Use an encoded action form.');
	if (!request.body) error(400, 'Missing action form.');
	const reader = request.body.getReader();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void reader.cancel('Action form timed out.').catch(() => {});
	}, 5000);
	const aborted = () => {
		void reader.cancel('Request aborted.').catch(() => {});
	};
	request.signal.addEventListener('abort', aborted, { once: true });
	if (request.signal.aborted) aborted();
	const chunks: Uint8Array[] = [];
	let size = 0,
		finished = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				finished = true;
				break;
			}
			size += value.length;
			if (size > 8192) error(413, 'Action form is too large.');
			chunks.push(value);
		}
		if (timedOut) error(408, 'Action form timed out.');
		if (request.signal.aborted) error(400, 'Request aborted.');
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		const form = new FormData();
		for (const [key, value] of new URLSearchParams(new TextDecoder().decode(bytes)))
			form.append(key, value);
		return form;
	} finally {
		clearTimeout(timer);
		request.signal.removeEventListener('abort', aborted);
		if (!finished) await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
