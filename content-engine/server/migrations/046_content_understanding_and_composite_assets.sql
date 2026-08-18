CREATE TABLE content_ingestion_assets (
  ingestion_id uuid NOT NULL REFERENCES content_ingestions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 8),
  PRIMARY KEY (ingestion_id, asset_id),
  UNIQUE (ingestion_id, position),
  FOREIGN KEY (workspace_id, asset_id) REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT
);

INSERT INTO content_ingestion_assets (ingestion_id, workspace_id, asset_id, position)
SELECT id, workspace_id, source_asset_id, 0
FROM content_ingestions
WHERE source_asset_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE content_ingestions DROP CONSTRAINT IF EXISTS content_ingestions_input_kind_check;
ALTER TABLE content_ingestions
  ADD CONSTRAINT content_ingestions_input_kind_check
  CHECK (input_kind IN ('URL', 'TEXT', 'ASSET', 'COMPOSITE'));

ALTER TABLE content_ingestions DROP CONSTRAINT IF EXISTS content_ingestions_processing_kind_check;
ALTER TABLE content_ingestions
  ADD CONSTRAINT content_ingestions_processing_kind_check
  CHECK (processing_kind IN ('TEXT', 'PDF_TEXT', 'IMAGE_VISION', 'AUDIO_ASR', 'VIDEO_ASR_VISION', 'COMPOSITE'));

ALTER TABLE content_ingestions DROP COLUMN source_asset_id;

ALTER TABLE content_draft_versions
  ADD COLUMN preflight_json jsonb;

INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'CONTENT_UNDERSTANDING', provider, connection_id, model, created_at, updated_at
FROM agent_model_policies
WHERE scope = 'PUBLIC_CONTENT_INGESTION'
ON CONFLICT (workspace_id, scope) DO NOTHING;

INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'CONTENT_UNDERSTANDING', provider, connection_id, model, created_at, updated_at
FROM agent_model_policies
WHERE scope = 'AUTHOR_CONTENT_INGESTION'
ON CONFLICT (workspace_id, scope) DO NOTHING;

DELETE FROM agent_model_policies
WHERE scope IN ('PUBLIC_CONTENT_INGESTION', 'AUTHOR_CONTENT_INGESTION');
