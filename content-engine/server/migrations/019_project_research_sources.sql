INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('project-research-sources', '查找研究来源', '执行研究计划中的网页搜索、公开链接读取和人工补充动作。', 'SOURCE_DISCOVERY', 'worker', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('project-research-sources:1.0.0', 'project-research-sources', '1.0.0',
   '{"requires":["project","researchPlan","actions","tools"]}'::jsonb,
   '{"outputs":["sources","capturedCount","needsUserCount","failedCount"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE project_artifacts
  DROP CONSTRAINT IF EXISTS project_artifacts_artifact_type_check,
  DROP CONSTRAINT IF EXISTS project_artifacts_check,
  DROP CONSTRAINT IF EXISTS project_artifacts_type_platform_check;

ALTER TABLE project_artifacts
  ADD CONSTRAINT project_artifacts_artifact_type_check
    CHECK (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'OUTLINE', 'CONTENT_MASTER', 'PLATFORM_COPY')),
  ADD CONSTRAINT project_artifacts_type_platform_check
    CHECK (
      (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'CONTENT_MASTER') AND platform IS NULL)
      OR
      (artifact_type IN ('OUTLINE', 'PLATFORM_COPY') AND platform IS NOT NULL)
    );

CREATE TABLE project_research_source_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  research_plan_id uuid NOT NULL REFERENCES project_research_plans(id) ON DELETE CASCADE,
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  artifact_id uuid UNIQUE REFERENCES project_artifacts(id) ON DELETE SET NULL,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_research_source_runs_project_idx
  ON project_research_source_runs (workspace_id, project_id, created_at DESC);

CREATE TABLE project_research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  source_run_id uuid NOT NULL REFERENCES project_research_source_runs(id) ON DELETE CASCADE,
  action_index integer NOT NULL CHECK (action_index >= 0),
  action text NOT NULL CHECK (action IN ('SEARCH_WEB', 'READ_LINK', 'ASK_USER')),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 300),
  target text NOT NULL CHECK (char_length(target) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('CAPTURED', 'NEEDS_USER', 'FAILED')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  url text,
  source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  error text CHECK (error IS NULL OR char_length(error) <= 2000),
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_research_sources_run_idx
  ON project_research_sources (workspace_id, project_id, source_run_id, action_index, retrieved_at ASC);
