CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE courts (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  content_type TEXT NOT NULL DEFAULT 'video/mp4',
  bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ready_at TEXT
);

CREATE INDEX clips_court_created_idx ON clips(court_id, created_at DESC);

-- Seed: 1 arena / 1 quadra para testes locais
INSERT INTO venues (id, name) VALUES ('venue-demo', 'Arena Demo');
INSERT INTO courts (id, venue_id, name, public_key)
VALUES ('court-01', 'venue-demo', 'Quadra 01', 'demo01');
