-- Portal da arena: acesso por link, marca na galeria pública e trilha de auditoria.

CREATE TABLE venue_access_links (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX venue_access_links_venue_idx ON venue_access_links(venue_id, revoked_at);

ALTER TABLE venues ADD COLUMN public_name TEXT;
-- Presets com contraste testado contra o texto escuro (#07090a) dos botões.
ALTER TABLE venues ADD COLUMN brand_color TEXT CHECK (
  brand_color IS NULL OR brand_color IN (
    '#d7ff3a', '#ffd23f', '#ff9f43', '#ff7a7a', '#ff7ac0', '#b99aff', '#4dd4ff', '#3ee6a0'
  )
);
ALTER TABLE venues ADD COLUMN logo_key TEXT;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  venue_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX audit_log_venue_idx ON audit_log(venue_id, created_at);
