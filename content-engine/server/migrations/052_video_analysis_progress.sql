ALTER TABLE video_analyses
  ADD COLUMN IF NOT EXISTS progress_json jsonb NOT NULL DEFAULT '{"phase":"PROBING","completedSegments":0,"totalSegments":0}'::jsonb
  CHECK (jsonb_typeof(progress_json) = 'object');
