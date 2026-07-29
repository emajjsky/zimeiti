INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('project-research-workflow', '一键研究', '自动完成研究计划、来源检索、相关性筛选和事实核验，并输出可采用的研究结果。', 'AGENT_PLANNER', 'worker', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('project-research-workflow:1.0.0', 'project-research-workflow', '1.0.0',
   '{"requires":["project","brief","materials","request"]}'::jsonb,
   '{"outputs":["summary","facts","cautions","angles","sources","materialContext"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE project_artifacts
  DROP CONSTRAINT IF EXISTS project_artifacts_artifact_type_check,
  DROP CONSTRAINT IF EXISTS project_artifacts_type_platform_check;

ALTER TABLE project_artifacts
  ADD CONSTRAINT project_artifacts_artifact_type_check
    CHECK (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'RESEARCH_VERIFICATION', 'RESEARCH_RESULT', 'OUTLINE', 'CONTENT_MASTER', 'PLATFORM_COPY')),
  ADD CONSTRAINT project_artifacts_type_platform_check
    CHECK (
      (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'RESEARCH_VERIFICATION', 'RESEARCH_RESULT', 'CONTENT_MASTER') AND platform IS NULL)
      OR
      (artifact_type IN ('OUTLINE', 'PLATFORM_COPY') AND platform IS NOT NULL)
    );

CREATE TABLE project_research_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL UNIQUE REFERENCES project_artifacts(id) ON DELETE CASCADE,
  output_json jsonb NOT NULL CHECK (jsonb_typeof(output_json) = 'object'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_research_results_project_idx
  ON project_research_results (workspace_id, project_id, created_at DESC);
