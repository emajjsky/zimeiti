DELETE FROM agent_model_policies
WHERE scope = 'CONTENT_PREFLIGHT_REVIEW';

ALTER TABLE content_draft_versions
  DROP COLUMN IF EXISTS preflight_json;
