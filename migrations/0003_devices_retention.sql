DROP TABLE IF EXISTS replay_requests;

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  kind TEXT NOT NULL DEFAULT 'pi',
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  agent_version TEXT,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX devices_venue_idx ON devices(venue_id);

CREATE TABLE heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX heartbeats_device_created_idx ON heartbeats(device_id, created_at DESC);
CREATE INDEX heartbeats_created_idx ON heartbeats(created_at);

ALTER TABLE clips ADD COLUMN device_id TEXT REFERENCES devices(id);
ALTER TABLE clips ADD COLUMN expires_at TEXT;

CREATE INDEX clips_expires_idx ON clips(expires_at);

UPDATE clips SET expires_at = datetime(created_at, '+7 days') WHERE expires_at IS NULL;
