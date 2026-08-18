CREATE TABLE video_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  source_asset_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ANALYZING'
    CHECK (status IN ('ANALYZING', 'EXTRACTING_FRAMES', 'SUCCEEDED', 'FAILED')),
  target_platform text NOT NULL DEFAULT 'WECHAT',
  model text NOT NULL,
  result_json jsonb,
  keyframe_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_asset_id) REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, id)
);

CREATE INDEX video_analyses_project_idx
  ON video_analyses (workspace_id, project_id, created_at DESC);
