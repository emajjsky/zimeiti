ALTER TABLE project_agent_messages
  RENAME COLUMN generation_run_id TO action_run_id;

ALTER TABLE project_agent_messages
  ADD COLUMN stage text NOT NULL DEFAULT 'RESEARCH'
    CHECK (stage IN ('RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW')),
  ADD COLUMN message_type text NOT NULL DEFAULT 'MESSAGE'
    CHECK (message_type IN ('MESSAGE', 'CONFIRMATION', 'RUN_STATUS', 'ARTIFACT', 'SYSTEM_EVENT')),
  ADD COLUMN artifact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(artifact_refs_json) = 'array'),
  ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata_json) = 'object');

CREATE TABLE project_stage_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW')),
  platform text CHECK (platform IS NULL OR platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  through_message_id uuid REFERENCES project_agent_messages(id) ON DELETE SET NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, stage, platform, version)
);

CREATE INDEX project_stage_summaries_project_idx
  ON project_stage_summaries (workspace_id, project_id, stage, platform, version DESC);

CREATE TABLE project_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  artifact_type text NOT NULL
    CHECK (artifact_type IN ('RESEARCH_PLAN', 'OUTLINE', 'CONTENT_MASTER', 'PLATFORM_COPY')),
  stage text NOT NULL CHECK (stage IN ('RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW')),
  platform text CHECK (platform IS NULL OR platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO')),
  status text NOT NULL DEFAULT 'CANDIDATE'
    CHECK (status IN ('CANDIDATE', 'ACCEPTED', 'REJECTED')),
  action_run_id uuid REFERENCES generation_runs(id) ON DELETE SET NULL,
  created_by_message_id uuid REFERENCES project_agent_messages(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 300),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata_json) = 'object'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (artifact_type IN ('RESEARCH_PLAN', 'CONTENT_MASTER') AND platform IS NULL)
    OR
    (artifact_type IN ('OUTLINE', 'PLATFORM_COPY') AND platform IS NOT NULL)
  )
);

CREATE INDEX project_artifacts_project_idx
  ON project_artifacts (workspace_id, project_id, stage, platform, created_at DESC);

CREATE INDEX project_artifacts_status_idx
  ON project_artifacts (workspace_id, project_id, artifact_type, status, created_at DESC);

ALTER TABLE project_research_plans
  ADD COLUMN artifact_id uuid UNIQUE REFERENCES project_artifacts(id) ON DELETE SET NULL;

CREATE TABLE content_master_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  artifact_id uuid NOT NULL UNIQUE REFERENCES project_artifacts(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  thesis text NOT NULL DEFAULT '',
  facts_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(facts_json) = 'array'),
  cases_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cases_json) = 'array'),
  preserved_expressions_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(preserved_expressions_json) = 'array'),
  facts_to_verify_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(facts_to_verify_json) = 'array'),
  material_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(material_refs_json) = 'array'),
  parent_version_id uuid REFERENCES content_master_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, version_number)
);

CREATE INDEX content_master_versions_project_idx
  ON content_master_versions (workspace_id, project_id, version_number DESC);

CREATE TABLE platform_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO')),
  objective text NOT NULL DEFAULT '',
  target_length integer CHECK (target_length IS NULL OR target_length > 0),
  hook text NOT NULL DEFAULT '',
  call_to_action text NOT NULL DEFAULT '',
  channel_rules_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(channel_rules_json) = 'object'),
  user_overrides_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(user_overrides_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, platform)
);

CREATE INDEX platform_strategies_project_idx
  ON platform_strategies (workspace_id, project_id, platform);

CREATE TABLE platform_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO')),
  artifact_id uuid NOT NULL UNIQUE REFERENCES project_artifacts(id) ON DELETE CASCADE,
  content_master_version_id uuid REFERENCES content_master_versions(id) ON DELETE SET NULL,
  parent_version_id uuid REFERENCES platform_content_versions(id) ON DELETE SET NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  facts_to_verify_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(facts_to_verify_json) = 'array'),
  change_summary text NOT NULL DEFAULT '' CHECK (char_length(change_summary) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, platform, version_number)
);

CREATE INDEX platform_content_versions_project_idx
  ON platform_content_versions (workspace_id, project_id, platform, version_number DESC);
