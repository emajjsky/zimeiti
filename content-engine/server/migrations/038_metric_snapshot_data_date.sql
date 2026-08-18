ALTER TABLE metric_snapshots
  ADD COLUMN data_date date;

UPDATE metric_snapshots
SET data_date = captured_at::date
WHERE data_date IS NULL;

ALTER TABLE metric_snapshots
  ALTER COLUMN data_date SET NOT NULL;

CREATE INDEX metric_snapshots_data_date_idx
  ON metric_snapshots (workspace_id, publication_id, data_date DESC, captured_at DESC);
