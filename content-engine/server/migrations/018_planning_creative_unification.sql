CREATE TABLE IF NOT EXISTS project_planning_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED')),
  planning_json jsonb NOT NULL,
  source_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (workspace_id, project_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_project_planning_versions_project
  ON project_planning_versions (workspace_id, project_id, version_number DESC);

CREATE TABLE IF NOT EXISTS legacy_topic_project_mappings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_topic_id text NOT NULL,
  project_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, legacy_topic_id),
  UNIQUE (workspace_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_topic_project_mappings_project
  ON legacy_topic_project_mappings (workspace_id, project_id);
