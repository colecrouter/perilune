import { Schema } from 'effect';

// Account-owned display defaults only. Drafts, file selections and physical
// commands never belong in preferences. Device push permissions remain local.
export const PreferencePatch = Schema.Struct({
	serif: Schema.optional(Schema.Boolean),
	consoleFilter: Schema.optional(Schema.Literals(['all', 'errors', 'commands'])),
	consoleShowInternal: Schema.optional(Schema.Boolean),
	consoleCompact: Schema.optional(Schema.Boolean),
	consoleFollow: Schema.optional(Schema.Boolean),
	jobsPageSize: Schema.optional(Schema.Literals([10, 25, 50])),
	jobsMaterial: Schema.optional(Schema.Boolean),
	jobsDuration: Schema.optional(Schema.Boolean),
	jobsSize: Schema.optional(Schema.Boolean),
	jobsUploaded: Schema.optional(Schema.Boolean),
	temperatureMinutes: Schema.optional(Schema.Literals([5, 15, 60]))
});
export type PreferencePatch = typeof PreferencePatch.Type;
export type Preferences = Required<PreferencePatch>;
export const defaultPreferences: Preferences = {
	serif: true,
	consoleFilter: 'all',
	consoleShowInternal: false,
	consoleCompact: true,
	consoleFollow: true,
	jobsPageSize: 10,
	jobsMaterial: true,
	jobsDuration: true,
	jobsSize: true,
	jobsUploaded: true,
	temperatureMinutes: 15
};
const decode = Schema.decodeUnknownSync(PreferencePatch, { onExcessProperty: 'error' });
export function preferencePatch(value: unknown): PreferencePatch {
	const patch = decode(value);
	if (Object.keys(patch).length === 0) throw Error('Choose a preference to update.');
	return patch;
}
