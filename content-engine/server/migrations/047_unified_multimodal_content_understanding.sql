ALTER TABLE content_ingestion_media
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'IMAGE';

ALTER TABLE content_ingestion_media
  DROP CONSTRAINT IF EXISTS content_ingestion_media_media_type_check;

ALTER TABLE content_ingestion_media
  ADD CONSTRAINT content_ingestion_media_media_type_check
  CHECK (media_type IN ('IMAGE', 'VIDEO', 'AUDIO'));

ALTER TABLE content_ingestions
  DROP CONSTRAINT IF EXISTS content_ingestions_processing_kind_check;

UPDATE content_ingestions
SET processing_kind = CASE
  WHEN processing_kind = 'PDF_TEXT' THEN 'DOCUMENT'
  WHEN processing_kind IN ('IMAGE_VISION', 'AUDIO_ASR', 'VIDEO_ASR_VISION') THEN 'MULTIMODAL'
  WHEN processing_kind = 'COMPOSITE' THEN 'MULTIMODAL'
  ELSE processing_kind
END;

ALTER TABLE content_ingestions
  ADD CONSTRAINT content_ingestions_processing_kind_check
  CHECK (processing_kind IN ('TEXT', 'DOCUMENT', 'MULTIMODAL'));

DELETE FROM agent_model_policies
WHERE scope = 'CONTENT_UNDERSTANDING'
  AND provider <> 'BAILIAN_CLI';

INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'CONTENT_UNDERSTANDING', provider, connection_id, model, created_at, updated_at
FROM agent_model_policies
WHERE scope = 'IMAGE_VISION'
ON CONFLICT (workspace_id, scope) DO NOTHING;

INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'CONTENT_UNDERSTANDING', provider, connection_id, model, created_at, updated_at
FROM agent_model_policies
WHERE scope = 'VIDEO_UNDERSTANDING'
ON CONFLICT (workspace_id, scope) DO NOTHING;

DELETE FROM agent_model_policies
WHERE scope IN ('IMAGE_VISION', 'VIDEO_UNDERSTANDING');
