import { parseKlipperReference } from '#lib/domain/klipper-reference.js';
export const helpFixture = parseKlipperReference(
	'## Printer\n```\n[printer]\nmax_velocity: 200\n#   Maximum speed <b>in mm/s</b>.\n```\n## Cartesian kinematics\n```\n[printer]\nkinematics: cartesian\nmax_z_velocity: 10\n#   Cartesian vertical speed.\n```\n## Linear delta kinematics\n```\n[printer]\nkinematics: delta\nmax_z_velocity: 10\n#   Delta vertical speed.\n```',
	{
		revision: 'a'.repeat(40),
		sha256: 'b'.repeat(64),
		url: 'https://example.test',
		license: 'GPL-3.0',
		licenseUrl: 'https://example.test/license'
	}
);
