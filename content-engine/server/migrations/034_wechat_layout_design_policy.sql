WITH ranked_layout_policies AS (
  SELECT
    workspace_id,
    provider,
    connection_id,
    model,
    row_number() OVER (
      PARTITION BY workspace_id
      ORDER BY CASE scope
        WHEN 'WECHAT_TEMPLATE_ANALYSIS' THEN 0
        WHEN 'WECHAT_VISUAL_PLANNING' THEN 1
        WHEN 'WECHAT_COPY_GENERATION' THEN 2
        ELSE 3
      END, updated_at DESC
    ) AS priority
  FROM agent_model_policies
  WHERE scope IN ('WECHAT_TEMPLATE_ANALYSIS', 'WECHAT_VISUAL_PLANNING', 'WECHAT_COPY_GENERATION')
)
INSERT INTO agent_model_policies
  (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'WECHAT_LAYOUT_DESIGN', provider, connection_id, model, now(), now()
FROM ranked_layout_policies
WHERE priority = 1
ON CONFLICT (workspace_id, scope) DO NOTHING;
