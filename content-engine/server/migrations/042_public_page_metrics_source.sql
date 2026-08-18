ALTER TABLE metric_snapshots
  DROP CONSTRAINT IF EXISTS metric_snapshots_source_check;

ALTER TABLE metric_snapshots
  ADD CONSTRAINT metric_snapshots_source_check
  CHECK (source IN ('MANUAL', 'OFFICIAL_API', 'PUBLIC_PAGE'));
