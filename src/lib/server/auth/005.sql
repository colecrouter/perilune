-- Browser credential changes fence delayed sign-ins without revoking integrations.
ALTER TABLE user ADD COLUMN loginVersion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN loginVersion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE browser_pairing ADD COLUMN login_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE account_tokens (
 hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, owner TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 email TEXT NOT NULL, epoch INTEGER NOT NULL, login_version INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE invitation_details (
 hash TEXT PRIMARY KEY REFERENCES enrollment(hash) ON DELETE CASCADE,
 email TEXT, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE account_mail (
 id TEXT PRIMARY KEY, owner TEXT REFERENCES user(id) ON DELETE CASCADE, kind TEXT NOT NULL,
 sealed TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
 token_hash TEXT, invitation_hash TEXT, epoch INTEGER, login_version INTEGER
);
CREATE TABLE account_throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);

CREATE INDEX account_mail_expiry ON account_mail(created);
CREATE INDEX account_mail_queue ON account_mail(status,created);
CREATE INDEX account_token_expiry ON account_tokens(expires);
