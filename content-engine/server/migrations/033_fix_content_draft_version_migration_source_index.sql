DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT conname INTO existing_constraint
  FROM pg_constraint
  WHERE conrelid = 'content_draft_versions'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE 'UNIQUE NULLS NOT DISTINCT%migration_source%'
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE content_draft_versions DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS content_draft_versions_migration_source_key_idx
  ON content_draft_versions (workspace_id, migration_source, migration_source_key)
  WHERE migration_source IS NOT NULL;
