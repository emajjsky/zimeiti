ALTER TABLE intelligence_items
  ADD COLUMN matched_keywords jsonb NOT NULL DEFAULT '[]'::jsonb;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY workspace_id, canonical_url
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM intelligence_items
  WHERE canonical_url IS NOT NULL
)
DELETE FROM intelligence_items
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX intelligence_items_workspace_url_idx
  ON intelligence_items (workspace_id, canonical_url)
  WHERE canonical_url IS NOT NULL;
