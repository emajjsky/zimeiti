CREATE TABLE content_draft_migration_controls (
  name text PRIMARY KEY,
  archive_manifest_path text,
  archive_manifest_sha256 text CHECK (archive_manifest_sha256 IS NULL OR archive_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  archive_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wechat_layout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('SYSTEM', 'CUSTOM')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  current_version_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name)
);

CREATE TABLE wechat_layout_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  template_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  rules_json jsonb NOT NULL CHECK (jsonb_typeof(rules_json) = 'object'),
  source_type text NOT NULL CHECK (source_type IN ('SYSTEM', 'MANUAL', 'WECHAT_URL')),
  source_url text,
  source_fingerprint text CHECK (source_fingerprint IS NULL OR source_fingerprint ~ '^[0-9a-f]{64}$'),
  prompt_version text,
  generation_run_id uuid REFERENCES generation_runs(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, template_id)
    REFERENCES wechat_layout_templates(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, template_id, version_number),
  CHECK ((source_type = 'WECHAT_URL' AND source_url IS NOT NULL) OR source_type <> 'WECHAT_URL')
);

ALTER TABLE wechat_layout_templates
  ADD CONSTRAINT wechat_layout_templates_current_version_fk
  FOREIGN KEY (workspace_id, current_version_id)
  REFERENCES wechat_layout_template_versions(workspace_id, id) ON DELETE RESTRICT;

CREATE TABLE content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')),
  status text NOT NULL DEFAULT 'EDITING' CHECK (status IN ('EDITING', 'READY', 'ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  visual_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(visual_plan_json) = 'object'),
  layout_template_version_id uuid,
  source_draft_version_id uuid,
  source_stale boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, platform)
);

ALTER TABLE content_drafts
  ADD CONSTRAINT content_drafts_layout_template_fk
  FOREIGN KEY (workspace_id, layout_template_version_id)
  REFERENCES wechat_layout_template_versions(workspace_id, id) ON DELETE RESTRICT;

CREATE TABLE content_draft_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')),
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  visual_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(visual_plan_json) = 'object'),
  rendered_html text,
  layout_template_version_id uuid,
  source_draft_version_id uuid,
  generation_run_id uuid REFERENCES generation_runs(id) ON DELETE SET NULL,
  migration_source text CHECK (migration_source IS NULL OR migration_source IN ('PLATFORM_CONTENT_VERSION', 'MIGRATED_CURRENT')),
  migration_source_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, draft_id)
    REFERENCES content_drafts(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, draft_id, id),
  UNIQUE (workspace_id, draft_id, version_number)
);

CREATE UNIQUE INDEX content_draft_versions_migration_source_key_idx
  ON content_draft_versions (workspace_id, migration_source, migration_source_key)
  WHERE migration_source IS NOT NULL;

ALTER TABLE content_draft_versions
  ADD CONSTRAINT content_draft_versions_layout_template_fk
  FOREIGN KEY (workspace_id, layout_template_version_id)
  REFERENCES wechat_layout_template_versions(workspace_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT content_draft_versions_source_version_fk
  FOREIGN KEY (workspace_id, source_draft_version_id)
  REFERENCES content_draft_versions(workspace_id, id) ON DELETE RESTRICT;

ALTER TABLE content_drafts
  ADD CONSTRAINT content_drafts_source_version_fk
  FOREIGN KEY (workspace_id, source_draft_version_id)
  REFERENCES content_draft_versions(workspace_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT content_drafts_current_version_fk
  FOREIGN KEY (workspace_id, current_version_id)
  REFERENCES content_draft_versions(workspace_id, id) ON DELETE RESTRICT;

CREATE INDEX content_drafts_project_idx
  ON content_drafts (workspace_id, project_id, platform);

CREATE INDEX content_draft_versions_draft_idx
  ON content_draft_versions (workspace_id, draft_id, version_number DESC);

CREATE TABLE content_draft_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  draft_version_id uuid,
  asset_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('COVER', 'BODY', 'CARD', 'MAIN')),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, draft_id)
    REFERENCES content_drafts(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, draft_id, draft_version_id)
    REFERENCES content_draft_versions(workspace_id, draft_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, asset_id)
    REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, id)
);

CREATE UNIQUE INDEX content_draft_assets_working_asset_idx
  ON content_draft_assets (workspace_id, draft_id, asset_id)
  WHERE draft_version_id IS NULL;

CREATE UNIQUE INDEX content_draft_assets_working_order_idx
  ON content_draft_assets (workspace_id, draft_id, sort_order)
  WHERE draft_version_id IS NULL;

CREATE UNIQUE INDEX content_draft_assets_version_asset_idx
  ON content_draft_assets (workspace_id, draft_version_id, asset_id)
  WHERE draft_version_id IS NOT NULL;

CREATE UNIQUE INDEX content_draft_assets_version_order_idx
  ON content_draft_assets (workspace_id, draft_version_id, sort_order)
  WHERE draft_version_id IS NOT NULL;

CREATE TABLE channel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  external_account_label text NOT NULL DEFAULT '' CHECK (char_length(external_account_label) <= 200),
  mode text NOT NULL CHECK (mode IN ('MANUAL', 'OFFICIAL')),
  status text NOT NULL CHECK (status IN ('MANUAL_READY', 'DISCONNECTED', 'CONNECTED', 'ERROR')),
  capabilities_json jsonb NOT NULL DEFAULT '{"canCreateDraft":false,"verifiedAt":null,"reason":"尚未验证"}'::jsonb
    CHECK (jsonb_typeof(capabilities_json) = 'object'),
  last_error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, platform, name)
);

CREATE TABLE channel_account_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  account_id uuid NOT NULL,
  encrypted_secret bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES channel_accounts(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, account_id)
);

CREATE TABLE platform_draft_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  draft_version_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')),
  mode text NOT NULL CHECK (mode IN ('MANUAL', 'OFFICIAL_API')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'MANUAL_PENDING', 'MANUAL_CONFIRMED', 'CANCELLED')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 32 AND 200),
  package_asset_id uuid,
  external_draft_id text,
  response_summary_json jsonb CHECK (response_summary_json IS NULL OR jsonb_typeof(response_summary_json) = 'object'),
  error_code text,
  error_message text,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  manually_confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  manually_confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES channel_accounts(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, draft_version_id)
    REFERENCES content_draft_versions(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, package_asset_id)
    REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  CHECK ((status = 'SUCCEEDED' AND external_draft_id IS NOT NULL) OR status <> 'SUCCEEDED'),
  CHECK ((status = 'MANUAL_CONFIRMED' AND manually_confirmed_by IS NOT NULL AND manually_confirmed_at IS NOT NULL) OR status <> 'MANUAL_CONFIRMED')
);

CREATE INDEX channel_accounts_workspace_idx
  ON channel_accounts (workspace_id, platform, status, updated_at DESC);

CREATE INDEX platform_draft_tasks_workspace_idx
  ON platform_draft_tasks (workspace_id, status, updated_at DESC);

CREATE TABLE wechat_layout_system_presets (
  name text PRIMARY KEY,
  rules_json jsonb NOT NULL
);

INSERT INTO wechat_layout_system_presets (name, rules_json) VALUES
  ('清爽阅读', '{"schemaVersion":1,"canvas":{"background":"#ffffff","textColor":"#273444","maxWidth":677},"title":{"fontSize":31,"fontWeight":800,"lineHeight":1.32,"color":"#102a43"},"body":{"fontSize":16,"lineHeight":1.95,"paragraphSpacing":20},"heading":{"fontSize":21,"color":"#2563eb","borderColor":"#60a5fa"},"quote":{"background":"#f8fafc","borderColor":"#93c5fd"},"image":{"borderRadius":12,"spacing":22,"captionColor":"#64748b"},"divider":{"color":"#dbeafe","thickness":1},"layout":{"titleVariant":"label","headingVariant":"left-bar","imageVariant":"framed","quoteVariant":"card","dividerVariant":"dots","leadVariant":"stripe"}}'),
  ('商务报告', '{"schemaVersion":1,"canvas":{"background":"#ffffff","textColor":"#243044","maxWidth":677},"title":{"fontSize":30,"fontWeight":800,"lineHeight":1.28,"color":"#172554"},"body":{"fontSize":16,"lineHeight":1.82,"paragraphSpacing":16},"heading":{"fontSize":20,"color":"#1e3a8a","borderColor":"#1e3a8a"},"quote":{"background":"#eff6ff","borderColor":"#3b82f6"},"image":{"borderRadius":0,"spacing":18,"captionColor":"#64748b"},"divider":{"color":"#94a3b8","thickness":2},"layout":{"titleVariant":"split","headingVariant":"numbered","imageVariant":"framed","quoteVariant":"outline","dividerVariant":"label","leadVariant":"card"}}'),
  ('科技媒体', '{"schemaVersion":1,"canvas":{"background":"#f8fbff","textColor":"#1e293b","maxWidth":677},"title":{"fontSize":32,"fontWeight":900,"lineHeight":1.22,"color":"#0f172a"},"body":{"fontSize":16,"lineHeight":1.86,"paragraphSpacing":18},"heading":{"fontSize":21,"color":"#0369a1","borderColor":"#06b6d4"},"quote":{"background":"#ecfeff","borderColor":"#38bdf8"},"image":{"borderRadius":10,"spacing":22,"captionColor":"#475569"},"divider":{"color":"#7dd3fc","thickness":2},"layout":{"titleVariant":"poster","headingVariant":"pill","imageVariant":"shadow","quoteVariant":"bubble","dividerVariant":"dots","leadVariant":"stripe"}}'),
  ('人文杂志', '{"schemaVersion":1,"canvas":{"background":"#fffdf8","textColor":"#3f3a34","maxWidth":677},"title":{"fontSize":31,"fontWeight":700,"lineHeight":1.42,"color":"#292524"},"body":{"fontSize":17,"lineHeight":2.05,"paragraphSpacing":22},"heading":{"fontSize":21,"color":"#9a3412","borderColor":"#c08457"},"quote":{"background":"#faf5ed","borderColor":"#d6b38a"},"image":{"borderRadius":4,"spacing":24,"captionColor":"#78716c"},"divider":{"color":"#d6b38a","thickness":1},"layout":{"titleVariant":"card","headingVariant":"stamp","imageVariant":"framed","quoteVariant":"bubble","dividerVariant":"dots","leadVariant":"kicker"}}'),
  ('现代报刊', '{"schemaVersion":1,"canvas":{"background":"#ffffff","textColor":"#202020","maxWidth":677},"title":{"fontSize":34,"fontWeight":900,"lineHeight":1.16,"color":"#111111"},"body":{"fontSize":16,"lineHeight":1.78,"paragraphSpacing":16},"heading":{"fontSize":22,"color":"#111111","borderColor":"#111111"},"quote":{"background":"#f5f5f5","borderColor":"#4b5563"},"image":{"borderRadius":0,"spacing":18,"captionColor":"#5f6368"},"divider":{"color":"#111111","thickness":3},"layout":{"titleVariant":"bar","headingVariant":"underline","imageVariant":"cutout","quoteVariant":"outline","dividerVariant":"label","leadVariant":"stripe"}}'),
  ('知识长文', '{"schemaVersion":1,"canvas":{"background":"#ffffff","textColor":"#263238","maxWidth":677},"title":{"fontSize":30,"fontWeight":800,"lineHeight":1.34,"color":"#102a43"},"body":{"fontSize":16,"lineHeight":1.98,"paragraphSpacing":20},"heading":{"fontSize":21,"color":"#0f766e","borderColor":"#14b8a6"},"quote":{"background":"#f0fdfa","borderColor":"#5eead4"},"image":{"borderRadius":8,"spacing":20,"captionColor":"#52606d"},"divider":{"color":"#99f6e4","thickness":1},"layout":{"titleVariant":"label","headingVariant":"band","imageVariant":"poster","quoteVariant":"card","dividerVariant":"dots","leadVariant":"card"}}');

CREATE OR REPLACE FUNCTION seed_wechat_layout_templates(target_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO wechat_layout_templates (workspace_id, name, kind, status)
  SELECT target_workspace_id, preset.name, 'SYSTEM', 'ACTIVE'
  FROM wechat_layout_system_presets preset
  ON CONFLICT (workspace_id, name) DO NOTHING;

  INSERT INTO wechat_layout_template_versions (workspace_id, template_id, version_number, rules_json, source_type)
  SELECT template.workspace_id, template.id, 1, preset.rules_json, 'SYSTEM'
  FROM wechat_layout_templates template
  JOIN wechat_layout_system_presets preset ON preset.name = template.name
  WHERE template.workspace_id = target_workspace_id
    AND template.kind = 'SYSTEM'
    AND NOT EXISTS (
      SELECT 1 FROM wechat_layout_template_versions version
      WHERE version.workspace_id = template.workspace_id AND version.template_id = template.id
    );

  UPDATE wechat_layout_templates template
  SET current_version_id = version.id
  FROM wechat_layout_template_versions version
  WHERE template.workspace_id = target_workspace_id
    AND template.current_version_id IS NULL
    AND version.workspace_id = template.workspace_id
    AND version.template_id = template.id
    AND version.version_number = 1;
END;
$$;

SELECT seed_wechat_layout_templates(workspace.id)
FROM workspaces workspace;

WITH draft_platforms AS (
  SELECT project.workspace_id, project.project_id, 'WECHAT'::text AS platform
  FROM content_projects project
  UNION
  SELECT version.workspace_id, version.project_id, version.platform
  FROM platform_content_versions version
  WHERE version.platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')
  UNION
  SELECT project.workspace_id, project.project_id, value->>'platform'
  FROM content_projects project
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(project.project_json->'versions') = 'array' THEN project.project_json->'versions' ELSE '[]'::jsonb END
  ) value
  WHERE value->>'platform' IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')
  UNION
  SELECT project.workspace_id, project.project_id, entry.key
  FROM content_projects project
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(project.project_json #> '{delivery,platforms}') = 'object' THEN project.project_json #> '{delivery,platforms}' ELSE '{}'::jsonb END
  ) entry
  WHERE entry.key IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')
)
INSERT INTO content_drafts (workspace_id, project_id, platform, created_at, updated_at)
SELECT platform.workspace_id, platform.project_id, platform.platform, project.created_at, project.updated_at
FROM draft_platforms platform
JOIN content_projects project
  ON project.workspace_id = platform.workspace_id AND project.project_id = platform.project_id
ON CONFLICT (workspace_id, project_id, platform) DO NOTHING;

INSERT INTO content_draft_versions (
  id, workspace_id, draft_id, platform, version_number, title, body,
  generation_run_id, migration_source, migration_source_key, created_at
)
SELECT version.id, version.workspace_id, draft.id, version.platform, version.version_number,
  version.title, version.body, artifact.action_run_id,
  'PLATFORM_CONTENT_VERSION', version.id::text, version.created_at
FROM platform_content_versions version
JOIN content_drafts draft
  ON draft.workspace_id = version.workspace_id
  AND draft.project_id = version.project_id
  AND draft.platform = version.platform
LEFT JOIN project_artifacts artifact ON artifact.id = version.artifact_id
WHERE version.platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')
ON CONFLICT DO NOTHING;

WITH current_json AS (
  SELECT DISTINCT ON (project.workspace_id, project.project_id, value->>'platform')
    project.workspace_id,
    project.project_id,
    value->>'platform' AS platform,
    COALESCE(value->>'title', '') AS title,
    COALESCE(value->>'body', '') AS body,
    project.updated_at,
    value.ordinality
  FROM content_projects project
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(project.project_json->'versions') = 'array' THEN project.project_json->'versions' ELSE '[]'::jsonb END
  ) WITH ORDINALITY value(value, ordinality)
  WHERE value->>'platform' IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')
  ORDER BY project.workspace_id, project.project_id, value->>'platform', value.ordinality DESC
), candidates AS (
  SELECT current.workspace_id, current.project_id, current.platform, current.title, current.body, current.updated_at,
    draft.id AS draft_id,
    COALESCE((SELECT max(version.version_number) FROM content_draft_versions version WHERE version.workspace_id = current.workspace_id AND version.draft_id = draft.id), 0) + 1 AS version_number
  FROM current_json current
  JOIN content_drafts draft
    ON draft.workspace_id = current.workspace_id
    AND draft.project_id = current.project_id
    AND draft.platform = current.platform
  WHERE NOT EXISTS (
    SELECT 1 FROM content_draft_versions version
    WHERE version.workspace_id = current.workspace_id
      AND version.draft_id = draft.id
      AND version.title = current.title
      AND version.body = current.body
  )
)
INSERT INTO content_draft_versions (
  workspace_id, draft_id, platform, version_number, title, body,
  migration_source, migration_source_key, created_at
)
SELECT workspace_id, draft_id, platform, version_number, title, body,
  'MIGRATED_CURRENT', workspace_id::text || ':' || project_id || ':' || platform, updated_at
FROM candidates
ON CONFLICT DO NOTHING;

WITH latest_versions AS (
  SELECT DISTINCT ON (version.workspace_id, version.draft_id)
    version.workspace_id,
    version.draft_id,
    version.id,
    version.title,
    version.body,
    version.created_at
  FROM content_draft_versions version
  ORDER BY version.workspace_id, version.draft_id, version.version_number DESC, version.created_at DESC, version.id DESC
)
UPDATE content_drafts draft
SET current_version_id = latest.id,
  title = latest.title,
  body = latest.body,
  status = CASE WHEN NULLIF(trim(latest.body), '') IS NULL THEN 'EDITING' ELSE 'READY' END,
  updated_at = GREATEST(draft.updated_at, latest.created_at)
FROM latest_versions latest
WHERE latest.workspace_id = draft.workspace_id AND latest.draft_id = draft.id;

UPDATE content_draft_versions derived
SET source_draft_version_id = source.current_version_id
FROM content_drafts derived_draft
JOIN content_drafts source
  ON source.workspace_id = derived_draft.workspace_id
  AND source.project_id = derived_draft.project_id
  AND source.platform = 'WECHAT'
WHERE derived.workspace_id = derived_draft.workspace_id
  AND derived.draft_id = derived_draft.id
  AND derived.platform IN ('XIAOHONGSHU', 'WEIBO')
  AND source.current_version_id IS NOT NULL;

UPDATE content_drafts derived
SET source_draft_version_id = source.current_version_id
FROM content_drafts source
WHERE source.workspace_id = derived.workspace_id
  AND source.project_id = derived.project_id
  AND source.platform = 'WECHAT'
  AND derived.platform IN ('XIAOHONGSHU', 'WEIBO')
  AND source.current_version_id IS NOT NULL;

UPDATE content_drafts draft
SET visual_plan_json = project.project_json #> ARRAY['delivery', 'platforms', draft.platform, 'visual']
FROM content_projects project
WHERE project.workspace_id = draft.workspace_id
  AND project.project_id = draft.project_id
  AND jsonb_typeof(project.project_json #> ARRAY['delivery', 'platforms', draft.platform, 'visual']) = 'object';

WITH default_template AS (
  SELECT template.workspace_id, version.id AS version_id
  FROM wechat_layout_templates template
  JOIN wechat_layout_template_versions version
    ON version.workspace_id = template.workspace_id AND version.id = template.current_version_id
  WHERE template.name = '清爽阅读' AND template.kind = 'SYSTEM'
)
UPDATE content_drafts draft
SET layout_template_version_id = template.version_id
FROM default_template template
WHERE draft.workspace_id = template.workspace_id AND draft.platform = 'WECHAT';

UPDATE content_draft_versions version
SET layout_template_version_id = draft.layout_template_version_id,
  visual_plan_json = draft.visual_plan_json,
  rendered_html = NULLIF(project.project_json #>> ARRAY['delivery', 'platforms', draft.platform, 'layout', 'content'], '')
FROM content_drafts draft
JOIN content_projects project
  ON project.workspace_id = draft.workspace_id AND project.project_id = draft.project_id
WHERE version.workspace_id = draft.workspace_id
  AND version.id = draft.current_version_id;

WITH raw_assets AS (
  SELECT draft.workspace_id, draft.id AS draft_id, draft.current_version_id,
    visual->>'coverAssetId' AS asset_id, 0::bigint AS requested_order, 'COVER'::text AS role
  FROM content_drafts draft
  JOIN content_projects project
    ON project.workspace_id = draft.workspace_id AND project.project_id = draft.project_id
  CROSS JOIN LATERAL (SELECT project.project_json #> ARRAY['delivery', 'platforms', draft.platform, 'visual'] AS visual) source
  WHERE NULLIF(visual->>'coverAssetId', '') IS NOT NULL
  UNION ALL
  SELECT draft.workspace_id, draft.id, draft.current_version_id,
    item.value, item.ordinality, 'BODY'
  FROM content_drafts draft
  JOIN content_projects project
    ON project.workspace_id = draft.workspace_id AND project.project_id = draft.project_id
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(project.project_json #> ARRAY['delivery', 'platforms', draft.platform, 'visual', 'assetIds']) = 'array'
      THEN project.project_json #> ARRAY['delivery', 'platforms', draft.platform, 'visual', 'assetIds'] ELSE '[]'::jsonb END
  ) WITH ORDINALITY item(value, ordinality)
), valid_assets AS (
  SELECT raw.workspace_id, raw.draft_id, raw.current_version_id, asset.id AS asset_id,
    CASE WHEN bool_or(raw.role = 'COVER') THEN 'COVER' ELSE 'BODY' END AS role,
    min(raw.requested_order) AS requested_order
  FROM raw_assets raw
  JOIN workspace_assets asset
    ON asset.workspace_id = raw.workspace_id
    AND raw.asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND asset.id = raw.asset_id::uuid
  GROUP BY raw.workspace_id, raw.draft_id, raw.current_version_id, asset.id
), ordered_assets AS (
  SELECT *, row_number() OVER (PARTITION BY workspace_id, draft_id ORDER BY CASE role WHEN 'COVER' THEN 0 ELSE 1 END, requested_order, asset_id) - 1 AS sort_order
  FROM valid_assets
)
INSERT INTO content_draft_assets (workspace_id, draft_id, asset_id, role, sort_order)
SELECT workspace_id, draft_id, asset_id, role, sort_order
FROM ordered_assets;

INSERT INTO content_draft_assets (workspace_id, draft_id, draft_version_id, asset_id, role, sort_order)
SELECT working.workspace_id, working.draft_id, draft.current_version_id, working.asset_id, working.role, working.sort_order
FROM content_draft_assets working
JOIN content_drafts draft
  ON draft.workspace_id = working.workspace_id AND draft.id = working.draft_id
WHERE working.draft_version_id IS NULL AND draft.current_version_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content_drafts derived
    LEFT JOIN content_draft_versions source
      ON source.workspace_id = derived.workspace_id
      AND source.id = derived.source_draft_version_id
      AND source.platform = 'WECHAT'
    WHERE derived.platform IN ('XIAOHONGSHU', 'WEIBO')
      AND derived.current_version_id IS NOT NULL
      AND source.id IS NULL
  ) THEN
    RAISE EXCEPTION '迁移后的派生草稿缺少公众号来源版本';
  END IF;
END;
$$;

UPDATE agent_action_definitions
SET model_scope = 'WECHAT_COPY_GENERATION', updated_at = now()
WHERE id LIKE 'project-copy-%';

INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('wechat-visual-planning', '公众号配图策划', '根据公众号母稿生成图片内容优先的配图方案。', 'WECHAT_VISUAL_PLANNING', 'cloud', false)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  model_scope = excluded.model_scope,
  execution_target = excluded.execution_target,
  requires_confirmation = excluded.requires_confirmation,
  updated_at = now();

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('wechat-visual-planning:1.0.0', 'wechat-visual-planning', '1.0.0',
    '{"requires":["projectId","draftId","bodyItemCount","styleProfile","modelRoute"]}'::jsonb,
    '{"outputs":["strategy","plan","policy"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

WITH ranked_copy_policies AS (
  SELECT policy.*,
    row_number() OVER (
      PARTITION BY policy.workspace_id
      ORDER BY CASE policy.scope WHEN 'CONTENT_WRITING' THEN 0 ELSE 1 END, policy.updated_at DESC
    ) AS priority
  FROM agent_model_policies policy
  WHERE policy.scope IN ('CONTENT_WRITING', 'CONTENT_REWRITE')
)
INSERT INTO agent_model_policies
  (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'WECHAT_COPY_GENERATION', provider, connection_id, model, now(), now()
FROM ranked_copy_policies
WHERE priority = 1
ON CONFLICT (workspace_id, scope) DO NOTHING;

INSERT INTO agent_model_policies
  (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'WECHAT_VISUAL_PLANNING', provider, connection_id, model, now(), now()
FROM agent_model_policies
WHERE scope = 'VISUAL_PLANNING'
ON CONFLICT (workspace_id, scope) DO NOTHING;

DELETE FROM agent_model_policies
WHERE scope IN ('CONTENT_WRITING', 'CONTENT_REWRITE', 'VISUAL_PLANNING');

WITH latest_wechat_copy_template AS (
  SELECT DISTINCT ON (template.workspace_id)
    template.workspace_id,
    template.body,
    template.source
  FROM prompt_template_versions template
  WHERE template.scope = 'CREATIVE_DRAFT_WECHAT'
  ORDER BY template.workspace_id, template.version DESC
)
INSERT INTO prompt_template_versions
  (workspace_id, scope, version, body, source)
SELECT workspace_id, 'WECHAT_COPY_GENERATION', 1, body, source
FROM latest_wechat_copy_template
ON CONFLICT (workspace_id, scope, version) DO NOTHING;
