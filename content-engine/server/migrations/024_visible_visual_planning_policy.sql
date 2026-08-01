INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'VISUAL_PLANNING', provider, connection_id, model, now(), now()
FROM agent_model_policies
WHERE scope = 'AGENT_PLANNER'
ON CONFLICT (workspace_id, scope) DO NOTHING;
