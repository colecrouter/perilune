export interface SettingOrigin {
	path: string;
	line: number;
	section: string;
	option: string;
	value: string;
	generated: boolean;
	multiline: boolean;
}
export interface ConfigSources {
	root: string;
	fingerprint: string;
	dependencies: { path: string; version: string }[];
	definitions: SettingOrigin[];
}

export function effectiveSetting(sources: ConfigSources, section: string, option: string) {
	return (
		sources.definitions.filter((d) => d.section === section && d.option === option).at(-1) ?? null
	);
}
