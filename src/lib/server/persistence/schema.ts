import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Mirrors migration 020. Existing Effect migrations remain the schema authority. */
export const userPreferences = sqliteTable('user_preferences', {
	owner: text().primaryKey(),
	value: text().notNull()
});
