ALTER TABLE workspaces
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DELETING')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE user_workspace_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'OTHER')),
  origin text NOT NULL CHECK (origin IN ('UPLOAD', 'AI_GENERATED', 'WEB_IMPORT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DELETING')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  source_url text,
  source_note text NOT NULL DEFAULT '',
  copyright_status text NOT NULL DEFAULT 'PENDING'
    CHECK (copyright_status IN ('PENDING', 'OWNED', 'LICENSED', 'OPEN_LICENSE', 'PROHIBITED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, sha256),
  UNIQUE (workspace_id, storage_key)
);

CREATE INDEX workspace_assets_workspace_updated_idx
  ON workspace_assets (workspace_id, status, updated_at DESC);

CREATE TABLE project_asset_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id text NOT NULL,
  asset_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('FACT', 'OPINION', 'STRUCTURE', 'VOICE', 'HOOK', 'VISUAL', 'NEGATIVE')),
  scope text NOT NULL CHECK (scope IN ('PROJECT', 'RESEARCH', 'WRITING', 'IMAGING')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  platforms_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(platforms_json) = 'array'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, asset_id)
    REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, asset_id)
);

CREATE INDEX project_asset_links_project_idx
  ON project_asset_links (workspace_id, project_id, sort_order, updated_at DESC);

CREATE TABLE storage_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('ASSET', 'WORKSPACE', 'ORPHAN_FILE')),
  target_id uuid NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX storage_deletion_active_target_idx
  ON storage_deletion_jobs (workspace_id, target_type, target_id)
  WHERE status IN ('PENDING', 'RUNNING');

INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
SELECT member.user_id,
  (array_agg(member.workspace_id ORDER BY workspace.created_at, member.workspace_id))[1]
FROM workspace_members member
JOIN workspaces workspace
  ON workspace.id = member.workspace_id
  AND workspace.status = 'ACTIVE'
GROUP BY member.user_id
HAVING count(*) = 1
ON CONFLICT (user_id) DO NOTHING;

UPDATE workspace_snapshots
SET state_json = state_json #- '{workspace,name}' #- '{workspace,materialRoot}';

CREATE TEMP TABLE migrated_asset_ids (
  reference_id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  workspace_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO migrated_asset_ids (reference_id, asset_id, workspace_id)
SELECT old.id, canonical.id, old.workspace_id
FROM project_references old
JOIN LATERAL (
  SELECT candidate.id
  FROM project_references candidate
  WHERE candidate.workspace_id = old.workspace_id
    AND candidate.source_type = 'FILE'
    AND lower(candidate.sha256) = lower(old.sha256)
  ORDER BY candidate.created_at, candidate.id
  LIMIT 1
) canonical ON true
WHERE old.source_type = 'FILE';

INSERT INTO workspace_assets (
  id,
  workspace_id,
  kind,
  origin,
  title,
  original_filename,
  mime_type,
  size_bytes,
  sha256,
  storage_key,
  created_at,
  updated_at
)
SELECT DISTINCT ON (reference.workspace_id, lower(reference.sha256))
  reference.id,
  reference.workspace_id,
  CASE
    WHEN reference.mime_type LIKE 'image/%' THEN 'IMAGE'
    WHEN reference.mime_type LIKE 'audio/%' THEN 'AUDIO'
    WHEN reference.mime_type LIKE 'video/%' THEN 'VIDEO'
    WHEN reference.mime_type IN ('application/pdf', 'application/msword')
      OR reference.mime_type LIKE 'application/vnd.openxmlformats-officedocument.%'
      OR reference.mime_type LIKE 'text/%' THEN 'DOCUMENT'
    ELSE 'OTHER'
  END,
  'UPLOAD',
  reference.title,
  reference.original_filename,
  reference.mime_type,
  reference.size_bytes,
  lower(reference.sha256),
  reference.storage_key,
  reference.created_at,
  reference.updated_at
FROM project_references reference
WHERE reference.source_type = 'FILE'
ORDER BY reference.workspace_id, lower(reference.sha256), reference.created_at, reference.id;

INSERT INTO project_asset_links (
  workspace_id,
  project_id,
  asset_id,
  role,
  scope,
  title,
  notes,
  platforms_json,
  created_at,
  updated_at
)
SELECT DISTINCT ON (reference.workspace_id, reference.project_id, mapping.asset_id)
  reference.workspace_id,
  reference.project_id,
  mapping.asset_id,
  reference.role,
  reference.scope,
  reference.title,
  reference.notes,
  reference.platforms_json,
  reference.created_at,
  reference.updated_at
FROM project_references reference
JOIN migrated_asset_ids mapping
  ON mapping.reference_id = reference.id
  AND mapping.workspace_id = reference.workspace_id
WHERE reference.source_type = 'FILE'
ORDER BY reference.workspace_id, reference.project_id, mapping.asset_id, reference.created_at, reference.id;

INSERT INTO storage_deletion_jobs (
  workspace_id,
  target_type,
  target_id,
  storage_key,
  status
)
SELECT reference.workspace_id,
  'ORPHAN_FILE',
  reference.id,
  reference.storage_key,
  'PENDING'
FROM project_references reference
JOIN migrated_asset_ids mapping
  ON mapping.reference_id = reference.id
  AND mapping.workspace_id = reference.workspace_id
JOIN workspace_assets asset
  ON asset.id = mapping.asset_id
  AND asset.workspace_id = reference.workspace_id
WHERE reference.source_type = 'FILE'
  AND reference.storage_key <> asset.storage_key;

CREATE FUNCTION migrated_asset_id(p_workspace_id uuid, p_reference_id text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  resolved uuid;
BEGIN
  IF NULLIF(p_reference_id, '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT asset_id
  INTO resolved
  FROM migrated_asset_ids
  WHERE workspace_id = p_workspace_id
    AND reference_id = p_reference_id::uuid;

  IF resolved IS NULL THEN
    RAISE EXCEPTION '无法迁移文件引用 %', p_reference_id;
  END IF;

  RETURN resolved;
END;
$$;

CREATE FUNCTION migrate_project_asset_ids(p_workspace_id uuid, p_project jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb := p_project;
  platform_key text;
  platform_value jsonb;
  visual jsonb;
  item jsonb;
  reference_item jsonb;
  rewritten_plan jsonb;
  rewritten_references jsonb;
  rewritten_asset_ids jsonb;
BEGIN
  FOR platform_key, platform_value IN
    SELECT key, value
    FROM jsonb_each(COALESCE(p_project #> '{delivery,platforms}', '{}'::jsonb))
  LOOP
    visual := platform_value->'visual';
    IF visual IS NULL OR jsonb_typeof(visual) <> 'object' THEN
      CONTINUE;
    END IF;

    rewritten_plan := '[]'::jsonb;
    FOR item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(visual->'plan', '[]'::jsonb))
    LOOP
      rewritten_references := '[]'::jsonb;
      FOR reference_item IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(item->'references', '[]'::jsonb))
      LOOP
        rewritten_references := rewritten_references || jsonb_build_array(
          (reference_item - 'referenceId') || jsonb_build_object(
            'assetId', migrated_asset_id(p_workspace_id, reference_item->>'referenceId')
          )
        );
      END LOOP;

      item := (item - 'assetReferenceId' - 'references') || jsonb_build_object(
        'assetId', migrated_asset_id(p_workspace_id, item->>'assetReferenceId'),
        'references', rewritten_references
      );
      rewritten_plan := rewritten_plan || jsonb_build_array(item);
    END LOOP;

    SELECT COALESCE(
      jsonb_agg(to_jsonb(migrated_asset_id(p_workspace_id, value))),
      '[]'::jsonb
    )
    INTO rewritten_asset_ids
    FROM jsonb_array_elements_text(COALESCE(visual->'assetReferenceIds', '[]'::jsonb));

    visual := (visual - 'coverReferenceId' - 'assetReferenceIds' - 'plan') || jsonb_build_object(
      'coverAssetId', migrated_asset_id(p_workspace_id, visual->>'coverReferenceId'),
      'assetIds', rewritten_asset_ids,
      'plan', rewritten_plan
    );

    result := jsonb_set(
      result,
      ARRAY['delivery', 'platforms', platform_key, 'visual'],
      visual,
      true
    );
  END LOOP;

  RETURN result;
END;
$$;

UPDATE content_projects project
SET project_json = migrate_project_asset_ids(project.workspace_id, project.project_json);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content_projects
    WHERE project_json::text LIKE '%assetReferenceId%'
      OR project_json::text LIKE '%coverReferenceId%'
      OR project_json::text LIKE '%assetReferenceIds%'
  ) THEN
    RAISE EXCEPTION '项目配图仍包含旧素材引用字段';
  END IF;
END;
$$;

ALTER TABLE project_research_materials
  ADD COLUMN asset_link_id uuid REFERENCES project_asset_links(id) ON DELETE CASCADE;

ALTER TABLE project_research_materials
  DROP CONSTRAINT project_research_materials_check;

UPDATE project_research_materials material
SET asset_link_id = link.id,
  reference_id = NULL
FROM project_references reference
JOIN migrated_asset_ids mapping
  ON mapping.reference_id = reference.id
  AND mapping.workspace_id = reference.workspace_id
JOIN project_asset_links link
  ON link.workspace_id = reference.workspace_id
  AND link.project_id = reference.project_id
  AND link.asset_id = mapping.asset_id
WHERE material.reference_id = reference.id
  AND reference.source_type = 'FILE';

ALTER TABLE project_research_materials
  ADD CONSTRAINT project_research_materials_one_source_check
    CHECK (num_nonnulls(input_id, reference_id, asset_link_id) = 1);

CREATE UNIQUE INDEX project_research_material_asset_link_idx
  ON project_research_materials (generation_run_id, asset_link_id)
  WHERE asset_link_id IS NOT NULL;

DROP INDEX project_references_hash_idx;

ALTER TABLE project_references
  DROP CONSTRAINT project_references_source_type_check,
  DROP CONSTRAINT project_references_check;

DELETE FROM project_references
WHERE source_type = 'FILE';

ALTER TABLE project_references
  DROP COLUMN storage_key,
  DROP COLUMN original_filename,
  DROP COLUMN mime_type,
  DROP COLUMN size_bytes,
  DROP COLUMN sha256,
  ADD CONSTRAINT project_references_link_only_check
    CHECK (source_type = 'LINK' AND url IS NOT NULL);

DROP FUNCTION migrate_project_asset_ids(uuid, jsonb);
DROP FUNCTION migrated_asset_id(uuid, text);
