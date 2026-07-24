CREATE TABLE skill_definitions (
  id text PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  execution_target text NOT NULL CHECK (execution_target IN ('cloud', 'worker', 'human')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_versions (
  id text PRIMARY KEY,
  skill_id text NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  version text NOT NULL,
  manifest_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);

CREATE TABLE topic_skill_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_skill_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (workspace_id, slug)
);

CREATE TABLE agent_model_policies (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('BAILIAN_CLI')),
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scope)
);

CREATE TABLE agent_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('GENERATING', 'WAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'FAILED')),
  request_text text NOT NULL,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan_json jsonb,
  planner_model text,
  error text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_plan_id uuid REFERENCES agent_plans(id) ON DELETE SET NULL,
  skill_version_id text NOT NULL REFERENCES skill_versions(id),
  status text NOT NULL CHECK (status IN ('DRAFT', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  source_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  model text,
  prompt_version text,
  estimated_cost jsonb,
  usage_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX agent_plans_workspace_created_idx ON agent_plans (workspace_id, created_at DESC);
CREATE INDEX generation_runs_workspace_created_idx ON generation_runs (workspace_id, created_at DESC);

INSERT INTO skill_definitions (id, workspace_id, name, description, execution_target) VALUES
  ('intelligence-analysis', NULL, '情报分析', '从已采集情报中生成摘要、热度和待核验事实。', 'worker'),
  ('source-verification', NULL, '来源核验', '整理来源证据、主张和风险项。', 'worker'),
  ('topic-scoring', NULL, '选题评分', '依据栏目、受众和平台输出选题建议。', 'worker'),
  ('content-writing', NULL, '内容写作', '根据已确认选题和来源生成结构化正文。', 'worker'),
  ('platform-package', NULL, '平台内容包', '将内容项目转为公众号、小红书或视频号版本。', 'worker'),
  ('publish-preflight', NULL, '发布预检', '检查平台版本的必填项、素材和事实风险。', 'cloud')
ON CONFLICT (id) DO NOTHING;

INSERT INTO skill_versions (id, skill_id, version, manifest_json) VALUES
  ('intelligence-analysis:1.0.0', 'intelligence-analysis', '1.0.0', '{"scope":"INTELLIGENCE_ANALYSIS","requiresConfirmation":true,"requiresSources":true,"outputs":["summary","heat","factsToVerify"]}'::jsonb),
  ('source-verification:1.0.0', 'source-verification', '1.0.0', '{"scope":"SOURCE_VERIFICATION","requiresConfirmation":true,"requiresSources":true,"outputs":["evidenceTable","risks"]}'::jsonb),
  ('topic-scoring:1.0.0', 'topic-scoring', '1.0.0', '{"scope":"TOPIC_SCORING","requiresConfirmation":true,"requiresSources":true,"outputs":["angle","score","audience"]}'::jsonb),
  ('content-writing:1.0.0', 'content-writing', '1.0.0', '{"scope":"CONTENT_WRITING","requiresConfirmation":true,"requiresSources":true,"outputs":["outline","draft"]}'::jsonb),
  ('platform-package:1.0.0', 'platform-package', '1.0.0', '{"scope":"PLATFORM_PACKAGE","requiresConfirmation":true,"requiresSources":true,"outputs":["platformVersion","assetChecklist"]}'::jsonb),
  ('publish-preflight:1.0.0', 'publish-preflight', '1.0.0', '{"scope":"PUBLISH_PREFLIGHT","requiresConfirmation":false,"requiresSources":false,"outputs":["blockingIssues","warnings","exportChecklist"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
