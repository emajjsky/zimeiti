CREATE TABLE agent_action_definitions (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  model_scope text NOT NULL,
  execution_target text NOT NULL CHECK (execution_target IN ('worker', 'cloud', 'human')),
  requires_confirmation boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_action_versions (
  id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES agent_action_definitions(id) ON DELETE CASCADE,
  version text NOT NULL,
  input_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, version)
);

ALTER TABLE generation_runs
  ALTER COLUMN skill_version_id DROP NOT NULL,
  ADD COLUMN action_version_id text REFERENCES agent_action_versions(id);

ALTER TABLE generation_runs
  ADD CONSTRAINT generation_runs_execution_reference_check
  CHECK (skill_version_id IS NOT NULL OR action_version_id IS NOT NULL);

CREATE TABLE creative_outline_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU')),
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  output_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE', 'ACCEPTED', 'REJECTED')),
  selected_title text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creative_outline_candidates_project_idx
  ON creative_outline_candidates (workspace_id, project_id, platform, created_at DESC);

INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('creative-outline', '生成大纲', '读取 WritingBrief 和五维 Skill 组合，生成可审核的大纲候选。', 'CONTENT_WRITING', 'worker', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('creative-outline:1.0.0', 'creative-outline', '1.0.0',
   '{"requires":["project","writingBrief","skillComposition","platform","modelRoute"]}'::jsonb,
   '{"outputs":["titleOptions","summary","sections","factsToVerify"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
