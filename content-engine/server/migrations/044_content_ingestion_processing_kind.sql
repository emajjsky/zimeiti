ALTER TABLE content_ingestions
  ADD COLUMN IF NOT EXISTS processing_kind text NOT NULL DEFAULT 'TEXT'
    CHECK (processing_kind IN ('TEXT', 'PDF_TEXT', 'IMAGE_VISION', 'AUDIO_ASR', 'VIDEO_ASR_VISION'));

CREATE INDEX IF NOT EXISTS content_ingestions_processing_kind_idx
  ON content_ingestions (workspace_id, processing_kind, stage);
