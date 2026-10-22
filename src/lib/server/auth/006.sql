-- Hashes remain server-only; independent record IDs identify revocable audit entries.
CREATE TABLE owner_reset_links (
 id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE,
 actor TEXT NOT NULL, target TEXT NOT NULL,
 actor_epoch INTEGER NOT NULL, actor_login_version INTEGER NOT NULL,
 created INTEGER NOT NULL, expires INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','revoked','redeemed')),
 updated INTEGER NOT NULL
);
CREATE INDEX owner_reset_target ON owner_reset_links(target,created);
