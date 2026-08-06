ALTER TABLE publications
  DROP CONSTRAINT IF EXISTS publications_workspace_id_task_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'publications'::regclass
      AND conname = 'publications_task_id_fk'
  ) THEN
    ALTER TABLE publications
      ADD CONSTRAINT publications_task_id_fk
      FOREIGN KEY (task_id) REFERENCES platform_draft_tasks(id) ON DELETE SET NULL;
  END IF;
END;
$$;
