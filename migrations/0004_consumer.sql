ALTER TABLE clips ADD COLUMN thumb_key TEXT;

-- Sem FK pra clips: métricas sobrevivem à retenção de 7 dias.
CREATE TABLE clip_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  court_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('view', 'download', 'share')),
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX clip_events_venue_created_idx ON clip_events(venue_id, created_at);
CREATE INDEX clip_events_clip_idx ON clip_events(clip_id, type);
