-- Piloto: eventos do agente (taxa aperto → clip) e alertas com dedupe por e-mail.

CREATE TABLE device_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  type TEXT NOT NULL CHECK (
    type IN ('press', 'clip_ok', 'clip_fail', 'ffmpeg_restart', 'boot', 'queue_drop')
  ),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX device_events_device_created_idx ON device_events(device_id, created_at);
CREATE INDEX device_events_created_idx ON device_events(created_at);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  kind TEXT NOT NULL,
  detail TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  notified_open INTEGER NOT NULL DEFAULT 0,
  notified_close INTEGER NOT NULL DEFAULT 0
);

-- Um alerta aberto por (device, tipo): o cron não duplica.
CREATE UNIQUE INDEX alerts_open_idx ON alerts(device_id, kind) WHERE resolved_at IS NULL;
CREATE INDEX alerts_opened_idx ON alerts(opened_at);
