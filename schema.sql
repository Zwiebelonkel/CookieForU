CREATE TABLE IF NOT EXISTS cookies (
  id TEXT PRIMARY KEY NOT NULL
    CHECK(length(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'),
  owner_token_hash TEXT NOT NULL UNIQUE
    CHECK(length(owner_token_hash) = 64),
  created_at TEXT NOT NULL,
  max_streak INTEGER NOT NULL CHECK(max_streak BETWEEN 1 AND 64),
  rules_version INTEGER NOT NULL DEFAULT 1 CHECK(rules_version = 1),
  bites INTEGER NOT NULL DEFAULT 0 CHECK(bites BETWEEN 0 AND 3),
  eaten_at TEXT,
  CHECK ((bites = 3 AND eaten_at IS NOT NULL)
      OR (bites < 3 AND eaten_at IS NULL))
);

-- Covers the all-time top 10: walk the first ten index entries without
-- reading or sorting the full cookie register. Maintained on every insertion.
CREATE INDEX IF NOT EXISTS cookies_rarity_ranking
  ON cookies(max_streak DESC, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS owner_checks (
  code TEXT PRIMARY KEY NOT NULL
    CHECK(length(code) = 16 AND code NOT GLOB '*[^0-9a-f]*'),
  cookie_id TEXT NOT NULL REFERENCES cookies(id),
  verifier_token_hash TEXT NOT NULL UNIQUE CHECK(length(verifier_token_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  confirmed_at INTEGER,
  CHECK(confirmed_at IS NULL OR (confirmed_at >= created_at AND confirmed_at < expires_at))
);

CREATE INDEX IF NOT EXISTS owner_checks_expiry ON owner_checks(expires_at);

CREATE TABLE IF NOT EXISTS cookie_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash) = 64),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cookie_issuances (
  cookie_id TEXT PRIMARY KEY NOT NULL REFERENCES cookies(id),
  session_hash TEXT NOT NULL REFERENCES cookie_sessions(token_hash),
  issued_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cookie_issuances_session_time ON cookie_issuances(session_hash, issued_at);
