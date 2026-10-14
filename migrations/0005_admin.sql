ALTER TABLE venues ADD COLUMN city TEXT;
ALTER TABLE venues ADD COLUMN contact_name TEXT;
ALTER TABLE venues ADD COLUMN contact_phone TEXT;
ALTER TABLE venues ADD COLUMN contact_email TEXT;
ALTER TABLE venues ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('onboarding', 'active', 'paused', 'churned'));
ALTER TABLE venues ADD COLUMN notes TEXT;

ALTER TABLE devices ADD COLUMN last_payload TEXT;

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents >= 0),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  start_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX contracts_venue_idx ON contracts(venue_id);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  period TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  paid_at TEXT,
  paid_method TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (venue_id, period)
);

CREATE INDEX invoices_status_due_idx ON invoices(status, due_date);

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('camera', 'pi', 'switch', 'esp32', 'button', 'adapter', 'other')),
  model TEXT,
  serial TEXT UNIQUE,
  cost_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'stock'
    CHECK (status IN ('stock', 'installed', 'maintenance', 'lost', 'retired')),
  venue_id TEXT REFERENCES venues(id),
  court_id TEXT REFERENCES courts(id),
  device_id TEXT REFERENCES devices(id),
  installed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX equipment_venue_idx ON equipment(venue_id);

CREATE TABLE equipment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  type TEXT NOT NULL CHECK (type IN ('assigned', 'returned', 'maintenance', 'note')),
  venue_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX equipment_events_equipment_idx ON equipment_events(equipment_id, created_at DESC);

-- clip_events ganha 'created': clips somem na retenção, o volume histórico fica aqui.
CREATE TABLE clip_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL,
  court_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('created', 'view', 'download', 'share')),
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO clip_events_new (id, clip_id, court_id, venue_id, type, ip_hash, created_at)
SELECT id, clip_id, court_id, venue_id, type, ip_hash, created_at FROM clip_events;

DROP TABLE clip_events;
ALTER TABLE clip_events_new RENAME TO clip_events;

CREATE INDEX clip_events_venue_created_idx ON clip_events(venue_id, created_at);
CREATE INDEX clip_events_clip_idx ON clip_events(clip_id, type);
CREATE INDEX clip_events_created_idx ON clip_events(created_at);

INSERT INTO clip_events (clip_id, court_id, venue_id, type, created_at)
SELECT cl.id, cl.court_id, co.venue_id, 'created', cl.created_at
FROM clips cl JOIN courts co ON co.id = cl.court_id
WHERE cl.status = 'ready';
