import { createHash } from 'node:crypto';
import snapshot from './Config_Reference.md?raw';
import source from './source.json';
import { parseKlipperReference } from '#lib/domain/klipper-reference.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** A pinned fetch and the bundled source must produce identical catalogue bytes. */
export async function buildReference(fetcher: typeof fetch = fetch) {
	if (hash(snapshot) !== source.sha256)
		throw new Error('Bundled Klipper reference checksum does not match its pinned source.');
	let text = snapshot;
	try {
		const response = await fetcher(source.url, {
			signal: AbortSignal.timeout(8000),
			redirect: 'error',
			cache: 'no-store'
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error('Upstream reference unavailable.');
		}
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No reference body.');
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				size += part.value.length;
				if (size > 512 * 1024) throw new Error('Reference source exceeds its size limit.');
				chunks.push(part.value);
			}
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		const fetched = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
			Buffer.concat(chunks)
		);
		if (hash(fetched) !== source.sha256) throw new Error('Upstream reference checksum mismatch.');
		text = fetched;
	} catch {
		/* A verified identical pinned snapshot keeps offline builds reproducible. */
	}
	const catalogue = parseKlipperReference(text, source);
	if (
		catalogue.options.length < 500 ||
		!catalogue.options.some(
			(o) => o.section === 'printer' && o.key === 'max_z_velocity' && o.context === 'cartesian'
		)
	)
		throw new Error('Pinned Klipper reference extraction failed its coverage checks.');
	return catalogue;
}
