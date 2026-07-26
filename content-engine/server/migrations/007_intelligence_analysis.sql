CREATE TABLE prompt_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  body text NOT NULL CHECK (char_length(body) <= 12000),
  source text NOT NULL CHECK (source IN ('DEFAULT', 'CUSTOM')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scope, version)
);

CREATE INDEX prompt_template_versions_current_idx ON prompt_template_versions (workspace_id, scope, version DESC);

CREATE TABLE intelligence_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  intelligence_item_id uuid NOT NULL REFERENCES intelligence_items(id) ON DELETE CASCADE,
  generation_run_id uuid NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  selected_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_json jsonb NOT NULL,
  overall_score integer NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  decision text NOT NULL CHECK (decision IN ('FOLLOW', 'WATCH', 'SKIP')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intelligence_analyses_latest_idx ON intelligence_analyses (workspace_id, intelligence_item_id, created_at DESC);
