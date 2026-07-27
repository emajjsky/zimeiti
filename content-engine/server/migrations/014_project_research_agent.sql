INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('project-research-plan', '生成研究计划', '读取用户选择的项目资料，生成待核验问题、事实主张和下一步研究动作。', 'AGENT_PLANNER', 'worker', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('project-research-plan:1.0.0', 'project-research-plan', '1.0.0',
   '{"requires":["project","writingBrief","request","selectedMaterials","modelRoute"]}'::jsonb,
   '{"outputs":["title","summary","questions","claims","nextActions"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE project_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  generation_run_id uuid REFERENCES generation_runs(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_agent_messages_project_idx
  ON project_agent_messages (workspace_id, project_id, created_at ASC);

CREATE TABLE project_research_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  output_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_research_plans_project_idx
  ON project_research_plans (workspace_id, project_id, created_at DESC);

CREATE TABLE project_research_materials (
  generation_run_id uuid NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  input_id uuid REFERENCES project_inputs(id) ON DELETE CASCADE,
  reference_id uuid REFERENCES project_references(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(input_id, reference_id) = 1)
);

CREATE UNIQUE INDEX project_research_material_input_idx
  ON project_research_materials (generation_run_id, input_id)
  WHERE input_id IS NOT NULL;

CREATE UNIQUE INDEX project_research_material_reference_idx
  ON project_research_materials (generation_run_id, reference_id)
  WHERE reference_id IS NOT NULL;
