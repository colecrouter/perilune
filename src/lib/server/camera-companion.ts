import { mp4VideoSize } from './camera-mp4.js';
import { cameraInput, type CameraInput } from './camera-input.js';

export type CameraQuality = 'original' | 'balanced' | 'data-saver';
export interface CameraProfiles {
	original: string;
	compatible: string;
	balanced: string;
	'data-saver': string;
}

export function cameraProfiles(id: string): CameraProfiles {
	if (!/^perilune_[a-f0-9]{32}$/.test(id)) throw new Error('Invalid camera generation.');
	return {
		original: id,
		compatible: `${id}_compatible`,
		balanced: `${id}_balanced`,
		'data-saver': `${id}_data_saver`
	};
}

/** Owned by a process-scoped service, never by a browser or finite request scope. */
export class CameraCompanion {
	private readonly base: URL;
	private readonly controllers = new Set<AbortController>();
	private disposed = false;
	constructor(base: string) {
		this.base = new URL(base.endsWith('/') ? base : `${base}/`);
		if (
			!['http:', 'https:'].includes(this.base.protocol) ||
			this.base.username ||
			this.base.password ||
			this.base.search ||
			this.base.hash
		)
			throw new Error('Configure a private HTTP(S) camera companion endpoint.');
	}
	dispose() {
		this.disposed = true;
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
	}
	private async request(
		path: string,
		params: Record<string, string>,
		method = 'GET',
		signal?: AbortSignal
	) {
		if (this.disposed) throw new Error('Camera service stopped.');
		const controller = new AbortController();
		this.controllers.add(controller);
		const url = new URL(path, this.base);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		try {
			const response = await fetch(url, {
				method,
				redirect: 'manual',
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(10_000),
					...(signal ? [signal] : [])
				])
			});
			return {
				response,
				release: () => {
					controller.abort();
					this.controllers.delete(controller);
				}
			};
		} catch {
			controller.abort();
			this.controllers.delete(controller);
			// Fetch errors can contain endpoint credentials; expose a fixed message only.
			throw new Error('Camera companion unavailable.');
		}
	}
	/** Opaque IDs and fixed templates prevent browser input becoming FFmpeg directives. */
	async prepare(
		id: string,
		value: CameraInput,
		signal?: AbortSignal,
		httpRemux = false
	): Promise<CameraProfiles> {
		if (!/^perilune_[a-f0-9]{32}$/.test(id)) throw new Error('Invalid camera generation.');
		const input = cameraInput(value);
		const profiles = cameraProfiles(id);
		if (httpRemux && !new URL(input.streamUrl).protocol.startsWith('http'))
			throw new Error('HTTP remux needs an HTTP(S) input.');
		// URI-encode quote/template characters before go2rtc builds its argument list.
		const endpoint = input.streamUrl.replace(
			/["'`{}\\]/g,
			(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
		);
		const definitions = [
			[id, httpRemux ? `ffmpeg:${endpoint}#video=copy` : input.streamUrl],
			[profiles.compatible, `ffmpeg:${id}#video=h264`],
			[profiles.balanced, `ffmpeg:${id}#video=h264#width=640`],
			[profiles['data-saver'], `ffmpeg:${id}#video=h264#width=320`]
		];
		for (const [name, src] of definitions) {
			const { response, release } = await this.request(
				'api/streams',
				{ name, src },
				'PATCH',
				signal
			);
			try {
				await response.body?.cancel().catch(() => {});
				if (!response.ok) throw new Error('Camera source could not be prepared.');
			} finally {
				release();
			}
		}
		return profiles;
	}
	async has(profile: string) {
		if (!/^perilune_[a-f0-9]{32}(?:_compatible|_balanced|_data_saver)?$/.test(profile))
			throw new Error('Invalid camera profile.');
		const { response, release } = await this.request('api/streams', { src: profile });
		try {
			await response.body?.cancel().catch(() => {});
			return response.ok;
		} finally {
			release();
		}
	}

	async remove(profiles: CameraProfiles) {
		for (const src of new Set(Object.values(profiles))) {
			if (!/^perilune_[a-f0-9]{32}(?:_compatible|_balanced|_data_saver)?$/.test(src))
				throw new Error('Invalid camera profile.');
			const { response, release } = await this.request('api/streams', { src }, 'DELETE');
			try {
				await response.body?.cancel().catch(() => {});
			} finally {
				release();
			}
		}
	}

	/** A bounded preview probe consumes only the initial media bytes and releases its viewer. */
	async probe(
		profile: string,
		signal?: AbortSignal
	): Promise<{ codec: 'H.264'; width: number; height: number }> {
		if (!/^perilune_[a-f0-9]{32}(?:_compatible|_balanced|_data_saver)?$/.test(profile))
			throw new Error('Invalid camera profile.');
		const { response, release } = await this.request(
			'api/stream.mp4',
			{ src: profile, video: 'h264' },
			'GET',
			signal
		);
		const reader = response.body?.getReader();
		try {
			if (
				!response.ok ||
				!reader ||
				!/^video\/mp4\s*;\s*codecs="avc1\.[0-9a-f]{6}"$/i.test(
					response.headers.get('content-type') ?? ''
				)
			)
				throw new Error('Camera did not provide compatible video.');
			const init = new Uint8Array(256 * 1024);
			let length = 0;
			while (length < init.length) {
				const chunk = await reader.read();
				if (chunk.done || !chunk.value.length || chunk.value.length + length > init.length) break;
				init.set(chunk.value, length);
				length += chunk.value.length;
				const size = mp4VideoSize(init.subarray(0, length));
				if (size) return { codec: 'H.264', ...size };
			}
			throw new Error('Camera did not provide compatible video.');
		} catch {
			throw new Error('Camera did not provide compatible video.');
		} finally {
			release();
			await reader?.cancel().catch(() => {});
		}
	}
}
