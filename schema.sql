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
