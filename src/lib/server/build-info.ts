import { version } from '../../../package.json';

export const buildInfo = {
	version: process.env.PERILUNE_BUILD_VERSION || version,
	revision: process.env.PERILUNE_BUILD_REVISION || 'unknown'
};
