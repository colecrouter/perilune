import { createHash } from 'node:crypto';

/** Private input configuration. Never serialize this object into browser snapshots. */
export interface CameraInput {
	kind: 'network' | 'snapshot';
	name: string;
	streamUrl: string;
	snapshotUrl?: string;
	rotation: 0 | 90 | 180 | 270;
	flipHorizontal: boolean;
	flipVertical: boolean;
}
export interface CameraCandidate {
	id: string;
	input: CameraInput;
}
const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

/** Only owners may supply these endpoints. No media-engine directives or local files. */
export function cameraEndpoint(value: unknown, snapshot = false, webOrigin?: string): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > 4096 ||
		value.split('').some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
		value.includes('#')
	)
		throw new Error('Enter a valid camera endpoint.');
	let url: URL;
	try {
		let base: URL | undefined;
		if (webOrigin) {
			base = new URL(webOrigin);
			if (
				!['http:', 'https:'].includes(base.protocol) ||
				base.username ||
				base.password ||
				base.search ||
				base.hash ||
				base.pathname !== '/'
			)
				throw new Error();
		}
		// Relative webcam paths refer to the printer web server, not Moonraker's API port.
		url = new URL(value.trim(), base);
	} catch {
		throw new Error('Enter an absolute camera endpoint or configure the printer web origin.');
	}
	if (!['http:', 'https:', ...(snapshot ? [] : ['rtsp:', 'rtsps:'])].includes(url.protocol))
		throw new Error('Use an HTTP(S) or RTSP camera endpoint; snapshots require HTTP(S).');
	if (!url.hostname || url.hash) throw new Error('Enter a valid camera endpoint.');
	return url.href;
}

export function cameraInput(value: unknown, webOrigin?: string): CameraInput {
	const data = record(value);
	const name = typeof data.name === 'string' ? data.name.trim() : '';
	if (!name || name.length > 120)
		throw new Error('Give this camera a name of up to 120 characters.');
	if (data.kind !== 'network' && data.kind !== 'snapshot')
		throw new Error('Choose a supported camera connection.');
	const rotation = data.rotation ?? 0;
	if (![0, 90, 180, 270].includes(rotation as number)) throw new Error('Choose a valid rotation.');
	for (const key of ['flipHorizontal', 'flipVertical'])
		if (data[key] !== undefined && typeof data[key] !== 'boolean')
			throw new Error('Choose valid camera orientation settings.');
	return {
		kind: data.kind,
		name,
		streamUrl: cameraEndpoint(data.streamUrl, data.kind === 'snapshot', webOrigin),
		...(data.snapshotUrl ? { snapshotUrl: cameraEndpoint(data.snapshotUrl, true, webOrigin) } : {}),
		rotation: rotation as CameraInput['rotation'],
		flipHorizontal: data.flipHorizontal === true,
		flipVertical: data.flipVertical === true
	};
}

/** Import only usable enabled entries; incomplete devices don't hide subsequent cameras. */
export function discoverCameraInputs(webcams: unknown, webOrigin?: string): CameraCandidate[] {
	if (!Array.isArray(webcams)) return [];
	const candidates: CameraCandidate[] = [];
	const seen = new Set<string>();
	for (const value of webcams.slice(0, 64)) {
		const item = record(value);
		if (item.enabled !== true) continue;
		try {
			const input = cameraInput(
				{
					kind: 'network',
					name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Printer camera',
					streamUrl: item.stream_url,
					snapshotUrl: item.snapshot_url,
					rotation: item.rotation,
					flipHorizontal: item.flip_horizontal,
					flipVertical: item.flip_vertical
				},
				webOrigin
			);
			const id = createHash('sha256')
				.update(typeof item.uid === 'string' ? item.uid : input.streamUrl)
				.digest('hex')
				.slice(0, 32);
			if (seen.has(id)) continue;
			seen.add(id);
			candidates.push({ id, input });
			if (candidates.length === 16) break;
		} catch {
			// Discovery is advisory; owners can correct endpoints in the setup form.
		}
	}
	return candidates;
}

/** The setup list contains labels and IDs, never endpoint credentials or addresses. */
export function cameraCandidateSummary(candidate: CameraCandidate) {
	return {
		id: candidate.id,
		name: candidate.input.name,
		protocol: new URL(candidate.input.streamUrl).protocol.startsWith('rtsp') ? 'RTSP' : 'HTTP'
	};
}
