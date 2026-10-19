/** Read display dimensions from a bounded fMP4 initialization segment. No decoding. */
export function mp4VideoSize(bytes: Uint8Array): { width: number; height: number } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const scan = (start: number, end: number): { width: number; height: number } | null => {
		for (let offset = start; offset + 8 <= end;) {
			const size = view.getUint32(offset);
			if (size < 8 || offset + size > end) return null;
			const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
			if (type === 'moov' || type === 'trak') {
				const result = scan(offset + 8, offset + size);
				if (result) return result;
			} else if (type === 'tkhd' && size >= 84) {
				const width = view.getUint32(offset + size - 8) / 65536;
				const height = view.getUint32(offset + size - 4) / 65536;
				if (width >= 1 && height >= 1 && width <= 16384 && height <= 16384)
					return { width: Math.round(width), height: Math.round(height) };
			}
			offset += size;
		}
		return null;
	};
	return scan(0, bytes.length);
}
