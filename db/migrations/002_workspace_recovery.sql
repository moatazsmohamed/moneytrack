-- Additive cloud recovery storage for workspace restore. Never drop or truncate data.
ALTER TABLE mt_user_settings
  ADD COLUMN recovery_json JSON NULL,
  ADD COLUMN recovery_updated_at DATETIME(6) NULL;
