INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('source-verification', '核验研究事实', '使用用户选择的来源逐条核验研究计划中的事实主张。', 'SOURCE_VERIFICATION', 'worker', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('source-verification:1.0.0', 'source-verification', '1.0.0',
   '{"requires":["project","researchPlan","selectedSources","modelRoute"]}'::jsonb,
   '{"outputs":["summary","claims","evidence"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE project_research_sources
  ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  ADD COLUMN selected boolean NOT NULL DEFAULT false;

ALTER TABLE project_artifacts
  DROP CONSTRAINT IF EXISTS project_artifacts_artifact_type_check,
  DROP CONSTRAINT IF EXISTS project_artifacts_type_platform_check;

ALTER TABLE project_artifacts
  ADD CONSTRAINT project_artifacts_artifact_type_check
    CHECK (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'RESEARCH_VERIFICATION', 'OUTLINE', 'CONTENT_MASTER', 'PLATFORM_COPY')),
  ADD CONSTRAINT project_artifacts_type_platform_check
    CHECK (
      (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'RESEARCH_VERIFICATION', 'CONTENT_MASTER') AND platform IS NULL)
      OR
      (artifact_type IN ('OUTLINE', 'PLATFORM_COPY') AND platform IS NOT NULL)
    );

CREATE TABLE project_source_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  source_run_id uuid NOT NULL REFERENCES project_research_source_runs(id) ON DELETE CASCADE,
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL UNIQUE REFERENCES project_artifacts(id) ON DELETE CASCADE,
  output_json jsonb NOT NULL CHECK (jsonb_typeof(output_json) = 'object'),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_source_verifications_project_idx
  ON project_source_verifications (workspace_id, project_id, created_at DESC);
