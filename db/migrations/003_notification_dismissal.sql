-- Budget and goal alerts are regenerated from live data using a per-user dedupe key.
-- Deleting such an alert keeps a tombstone (dismissed_at) so the same alert is not created again.
ALTER TABLE mt_notifications ADD COLUMN dismissed_at DATETIME(6) NULL DEFAULT NULL;
