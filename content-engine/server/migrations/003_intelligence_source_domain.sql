ALTER TABLE intelligence_items ADD COLUMN source_key text;
CREATE UNIQUE INDEX intelligence_items_source_key_idx ON intelligence_items (workspace_id, source_id, source_key) WHERE source_key IS NOT NULL;

CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  urgency text NOT NULL DEFAULT '中' CHECK (urgency IN ('高', '中', '低')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'PROJECT_CREATED', 'DISCARDED')),
  core_viewpoint text NOT NULL,
  planned_date date,
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topics_workspace_updated_idx ON topics (workspace_id, updated_at DESC);
