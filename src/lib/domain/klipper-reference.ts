export interface ReferenceSource {
	revision: string;
	sha256: string;
	url: string;
	license: string;
	licenseUrl: string;
}
export interface ReferenceOption {
	id: string;
	section: string;
	key: string;
	heading: string;
	anchor: string;
	context: string | null;
	exampleValue: string;
	commented: boolean;
	description: string;
	line: number;
}
export interface ReferenceCatalogue {
	schemaVersion: 1;
	source: ReferenceSource;
	options: ReferenceOption[];
}
const headingContext: Record<string, string> = {
	'cartesian kinematics': 'cartesian',
	'linear delta kinematics': 'delta',
	'deltesian kinematics': 'deltesian',
	'corexy kinematics': 'corexy',
	'corexz kinematics': 'corexz',
	'hybrid-corexy kinematics': 'hybrid_corexy',
	'hybrid-corexz kinematics': 'hybrid_corexz',
	'polar kinematics': 'polar',
	'rotary delta kinematics': 'rotary_delta',
	'cable winch kinematics': 'winch',
	'generic cartesian kinematics': 'generic_cartesian',
	'none kinematics': 'none'
};
const slug = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9_\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
/** Extract documentation examples, never a validation schema or inferred defaults. */
export function parseKlipperReference(
	markdown: string,
	source: ReferenceSource
): ReferenceCatalogue {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const options: ReferenceOption[] = [];
	let heading = '',
		anchor = '',
		section = '',
		context: string | null = null,
		inCode = false;
	let current: ReferenceOption | null = null;
	const finish = () => {
		if (current) {
			current.description = current.description.replace(/\n{3,}/g, '\n\n').trim();
			options.push(current);
			current = null;
		}
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith('```')) {
			finish();
			inCode = !inCode;
			section = '';
			context = headingContext[heading.toLowerCase()] ?? null;
			continue;
		}
		if (!inCode) {
			const title = /^#{2,}\s+(.+)$/.exec(line);
			if (title) {
				heading = title[1]!;
				anchor = slug(heading);
			}
			continue;
		}
		const header = /^\[([^\]]+)\]\s*$/.exec(line);
		if (header) {
			finish();
			section = header[1]!;
			continue;
		}
		const field = /^(#?)([a-z_][a-z0-9_]*):[ \t]*(.*)$/.exec(line);
		if (field) {
			finish();
			if (field[2] === 'kinematics' && field[3] && !field[1]) context = field[3].trim();
			current = {
				id: `${anchor}:${section}:${field[2]}:${i + 1}`,
				section,
				key: field[2]!,
				heading,
				anchor,
				context,
				exampleValue: field[3]!,
				commented: field[1] === '#',
				description: '',
				line: i + 1
			};
			continue;
		}
		if (current) {
			const comment = /^# {3}(.*)$/.exec(line);
			if (comment) current.description += (current.description ? ' ' : '') + comment[1];
			else if (line === '#') current.description += '\n\n';
			else if (line.trim() && !line.startsWith('#')) finish();
		}
	}
	finish();
	if (inCode || options.length < 1)
		throw new Error('The reference source has no complete supported option blocks.');
	return { schemaVersion: 1, source, options };
}
export function isReferenceCatalogue(value: unknown): value is ReferenceCatalogue {
	if (!value || typeof value !== 'object') return false;
	const c = value as Partial<ReferenceCatalogue>;
	return (
		c.schemaVersion === 1 &&
		Boolean(
			c.source && /^[a-f0-9]{40}$/.test(c.source.revision) && /^[a-f0-9]{64}$/.test(c.source.sha256)
		) &&
		Array.isArray(c.options) &&
		c.options.length <= 3000 &&
		c.options.every(
			(o) =>
				typeof o.id === 'string' &&
				typeof o.section === 'string' &&
				/^[a-z_][a-z0-9_]*$/.test(o.key) &&
				typeof o.description === 'string' &&
				typeof o.heading === 'string' &&
				typeof o.anchor === 'string' &&
				typeof o.exampleValue === 'string' &&
				(o.context === null || typeof o.context === 'string')
		)
	);
}
export function referenceMatches(
	option: ReferenceOption,
	section: string,
	context: string | null
): boolean {
	if (option.context && option.context !== context) return false;
	if (option.section === section) return true;
	if (
		option.heading === '[stepper]' &&
		option.section === 'stepper_x' &&
		/^stepper_[a-z][a-z0-9_]*$/.test(section)
	)
		return true;
	const type = section.split(' ')[0];
	return (
		option.section.includes(' ') && section.includes(' ') && option.section.split(' ')[0] === type
	);
}
export const referenceUrl = (option: ReferenceOption) =>
	`https://www.klipper3d.org/Config_Reference.html#${option.anchor}`;
