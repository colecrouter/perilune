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

/** Fixed definitions; caller validates the private input and supplies its capture adapter. */
export function cameraDefinitions(
	id: string,
	input: { kind: string; streamUrl: string },
	capture: string,
	httpRemux = false
): Array<[string, string]> {
	const profiles = cameraProfiles(id);
	if (httpRemux && !new URL(input.streamUrl).protocol.startsWith('http'))
		throw Error('HTTP remux needs an HTTP(S) input.');
	const endpoint = input.streamUrl.replace(
		/["'`{}\\]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	);
	const format =
		input.kind === 'local' ? new URL(input.streamUrl).searchParams.get('input_format') : null;
	const source = format === 'mjpeg' ? `http://127.0.0.1:1984/api/stream.mjpeg?src=${id}` : id;
	const raw = format === 'yuyv422' || format === 'nv12';
	return [
		[id, httpRemux ? `ffmpeg:${endpoint}#video=copy` : capture],
		[profiles.compatible, `ffmpeg:${source}#video=${raw ? 'copy' : 'h264'}`],
		[profiles.balanced, `ffmpeg:${source}#video=h264#width=640`],
		[profiles['data-saver'], `ffmpeg:${source}#video=h264#width=320`]
	];
}
