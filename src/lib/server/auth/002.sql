-- A recovery epoch prevents in-flight logins from reauthorizing old credentials.
ALTER TABLE user ADD COLUMN authVersion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN authVersion INTEGER NOT NULL DEFAULT 0;
