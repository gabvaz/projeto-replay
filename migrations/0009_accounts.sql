-- Contas email/senha (admin global e portal da arena).

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'arena')),
  venue_id TEXT REFERENCES venues(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  disabled_at TEXT,
  CHECK (
    (role = 'admin' AND venue_id IS NULL) OR
    (role = 'arena' AND venue_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX accounts_email_idx ON accounts(email);
CREATE INDEX accounts_venue_idx ON accounts(venue_id) WHERE role = 'arena';
