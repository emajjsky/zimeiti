CREATE TABLE creative_draft_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU')),
  outline_candidate_id uuid NOT NULL REFERENCES creative_outline_candidates(id),
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  output_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE', 'ACCEPTED', 'REJECTED')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX creative_draft_candidates_project_idx
  ON creative_draft_candidates (workspace_id, project_id, platform, created_at DESC);

INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('creative-draft', '生成初稿', '读取已采用大纲、WritingBrief 和当前平台 Skill，生成可审核的完整初稿。', 'CONTENT_WRITING', 'worker', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('creative-draft:1.0.0', 'creative-draft', '1.0.0',
   '{"requires":["project","writingBrief","skillComposition","acceptedOutline","platform","promptTemplate","modelRoute"]}'::jsonb,
   '{"outputs":["title","body","factsToVerify"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
