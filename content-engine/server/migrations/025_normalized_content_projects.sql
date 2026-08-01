CREATE TABLE content_projects (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  project_json jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  CHECK (project_json->>'id' = project_id)
);

CREATE INDEX content_projects_workspace_position_idx
  ON content_projects (workspace_id, position, updated_at DESC);

INSERT INTO content_projects (workspace_id, project_id, project_json, position, created_at, updated_at)
SELECT snapshot.workspace_id,
  project.value->>'id',
  project.value,
  project.ordinality - 1,
  snapshot.updated_at,
  snapshot.updated_at
FROM workspace_snapshots snapshot
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(snapshot.state_json->'projects', '[]'::jsonb)) WITH ORDINALITY AS project(value, ordinality)
WHERE NULLIF(project.value->>'id', '') IS NOT NULL
ON CONFLICT (workspace_id, project_id) DO NOTHING;

UPDATE workspace_snapshots
SET state_json = state_json - 'projects' - 'sources' - 'intelligence' - 'topics';
