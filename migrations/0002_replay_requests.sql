CREATE TABLE replay_requests (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  status TEXT NOT NULL DEFAULT 'pending',
  clip_id TEXT REFERENCES clips(id),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  finished_at TEXT
);

CREATE INDEX replay_requests_court_status_idx
  ON replay_requests(court_id, status, created_at);
