import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Mirrors migration 020. Existing Effect migrations remain the schema authority. */
export const userPreferences = sqliteTable('user_preferences', {
	owner: text().primaryKey(),
	value: text().notNull()
});

/** Mirrors migration 023; revision remains the compare-and-swap authority. */
export const filamentChangeSettings = sqliteTable('filament_change_settings', {
	target: text().primaryKey(),
	revision: integer().notNull(),
	value: text().notNull()
});
