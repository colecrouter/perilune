CREATE TABLE browser_pairing (
 hash TEXT PRIMARY KEY,
 code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 expires INTEGER NOT NULL,
 owner TEXT REFERENCES user(id) ON DELETE CASCADE,
 epoch INTEGER,
 approved INTEGER NOT NULL DEFAULT 0,
 session_id TEXT,
 integration_id TEXT
);
CREATE TABLE paired_browser (
 session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 created INTEGER NOT NULL,
 integration_id TEXT
);
