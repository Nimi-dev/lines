-- lines telemetry schema (D1). Applied via:
--   npx wrangler d1 execute lines-telemetry --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS events (
  id   TEXT PRIMARY KEY,   -- client-generated; ingest upserts on it
  t    INTEGER NOT NULL,   -- ms epoch
  type TEXT NOT NULL,
  dev  TEXT NOT NULL,      -- per-install device id
  ses  TEXT NOT NULL,      -- per-app-open session id
  ver  TEXT NOT NULL,      -- APP_VER at the time
  data TEXT NOT NULL       -- JSON payload
);
CREATE INDEX IF NOT EXISTS idx_events_t ON events (t);
CREATE INDEX IF NOT EXISTS idx_events_type_t ON events (type, t);
CREATE INDEX IF NOT EXISTS idx_events_dev_t ON events (dev, t);
