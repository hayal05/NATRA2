-- Local database migration.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('UPSERT','DELETE')),
  payload TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(synced_at,id);
