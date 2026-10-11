ALTER TABLE asset_metadata
  ADD COLUMN scan_state text NOT NULL DEFAULT 'quarantined'
    CHECK(scan_state IN ('quarantined','scanning','clean','rejected','deleted')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN rejected_reason text,
  ADD COLUMN expires_at timestamptz;
CREATE INDEX asset_metadata_scan_pending ON asset_metadata(scan_state,created_at) WHERE scan_state IN ('quarantined','scanning');
CREATE INDEX asset_metadata_expiry ON asset_metadata(expires_at) WHERE expires_at IS NOT NULL;
