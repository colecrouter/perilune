/** Feed go2rtc's fragmented MP4 directly into MediaSource with bounded buffering. */
export async function playCamera(
	video: HTMLVideoElement,
	url: string,
	signal: AbortSignal,
	onBlocked: () => void
): Promise<void> {
	const response = await fetch(url, { signal, cache: 'no-store' });
	const type = response.headers.get('content-type') ?? '';
	if (!response.ok || !response.body) {
		await response.body?.cancel().catch(() => {});
		throw new Error('Camera video unavailable');
	}
	if (!MediaSource.isTypeSupported(type)) {
		await response.body.cancel().catch(() => {});
		throw new Error('Camera format unsupported');
	}
	const media = new MediaSource();
	const objectUrl = URL.createObjectURL(media);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		const opened = new Promise<void>((resolve, reject) => {
			const ready = () => {
				cleanup();
				resolve();
			};
			const aborted = () => {
				cleanup();
				reject(new Error('Camera stopped'));
			};
			const cleanup = () => {
				media.removeEventListener('sourceopen', ready);
				signal.removeEventListener('abort', aborted);
			};
			media.addEventListener('sourceopen', ready, { once: true });
			signal.addEventListener('abort', aborted, { once: true });
			if (signal.aborted) aborted();
		});
		video.src = objectUrl;
		await opened;
		if (signal.aborted) return;
		const buffer = media.addSourceBuffer(type);
		const update = (action: () => void) =>
			new Promise<void>((resolve, reject) => {
				const done = () => {
					cleanup();
					resolve();
				};
				const failed = () => {
					cleanup();
					reject(new Error('Camera video could not be decoded'));
				};
				const cleanup = () => {
					buffer.removeEventListener('updateend', done);
					buffer.removeEventListener('error', failed);
					signal.removeEventListener('abort', failed);
				};
				buffer.addEventListener('updateend', done, { once: true });
				buffer.addEventListener('error', failed, { once: true });
				signal.addEventListener('abort', failed, { once: true });
				if (signal.aborted) {
					failed();
					return;
				}
				try {
					action();
				} catch {
					failed();
				}
			});
		reader = response.body.getReader();
		void video.play().catch(() => {
			if (!signal.aborted) onBlocked();
		});
		while (!signal.aborted) {
			const chunk = await reader.read();
			if (chunk.done) {
				if (media.readyState === 'open') media.endOfStream();
				throw new Error('Camera stream ended');
			}
			if (chunk.value.byteLength > 8 * 1024 * 1024) throw new Error('Camera buffer limit exceeded');
			await update(() => buffer.appendBuffer(new Uint8Array(chunk.value).buffer));
			if (buffer.buffered.length) {
				const end = buffer.buffered.end(buffer.buffered.length - 1);
				if (end - video.currentTime > 2)
					video.currentTime = Math.max(buffer.buffered.start(0), end - 0.5);
				if (video.currentTime > 4 && buffer.buffered.start(0) < video.currentTime - 4)
					await update(() => buffer.remove(0, video.currentTime - 2));
			}
		}
	} finally {
		await reader?.cancel().catch(() => {});
		if (!reader) await response.body.cancel().catch(() => {});
		if (media.readyState === 'open') {
			try {
				media.endOfStream();
			} catch {
				/* abort may be updating */
			}
		}
		URL.revokeObjectURL(objectUrl);
	}
}
