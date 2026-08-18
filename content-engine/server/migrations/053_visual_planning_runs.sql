CREATE TABLE visual_planning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  draft_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  input_json jsonb NOT NULL,
  result_json jsonb,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, draft_id) REFERENCES content_drafts(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id)
);

CREATE INDEX visual_planning_runs_project_idx
  ON visual_planning_runs (workspace_id, project_id, created_at DESC);
