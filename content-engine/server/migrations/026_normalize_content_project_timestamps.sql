WITH normalized AS (
  SELECT
    project.workspace_id,
    project.project_id,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          project.project_json,
          '{createdAt}',
          to_jsonb(
            CASE
              WHEN pg_input_is_valid(NULLIF(project.project_json->>'createdAt', ''), 'timestamp with time zone')
                THEN (project.project_json->>'createdAt')::timestamptz
              ELSE project.created_at
            END
          ),
          true
        ),
        '{updatedAt}',
        to_jsonb(
          CASE
            WHEN pg_input_is_valid(NULLIF(project.project_json->>'updatedAt', ''), 'timestamp with time zone')
              THEN (project.project_json->>'updatedAt')::timestamptz
            ELSE project.updated_at
          END
        ),
        true
      ),
      '{versions}',
      COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN pg_input_is_valid(NULLIF(version.value->>'updatedAt', ''), 'timestamp with time zone')
              THEN version.value
            ELSE jsonb_set(version.value, '{updatedAt}', to_jsonb(project.updated_at), true)
          END
          ORDER BY version.ordinality
        )
        FROM jsonb_array_elements(COALESCE(project.project_json->'versions', '[]'::jsonb))
          WITH ORDINALITY AS version(value, ordinality)
      ), '[]'::jsonb),
      true
    ) AS project_json
  FROM content_projects project
)
UPDATE content_projects project
SET project_json = normalized.project_json
FROM normalized
WHERE project.workspace_id = normalized.workspace_id
  AND project.project_id = normalized.project_id
  AND project.project_json IS DISTINCT FROM normalized.project_json;
