CREATE TABLE channel_account_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  data_date date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'OFFICIAL_API')),
  follower_count integer CHECK (follower_count IS NULL OR follower_count >= 0),
  follower_delta integer,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_json) = 'object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES channel_accounts(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, account_id, data_date, source)
);

CREATE INDEX channel_account_metrics_latest_idx
  ON channel_account_metric_snapshots (workspace_id, account_id, captured_at DESC, created_at DESC);
