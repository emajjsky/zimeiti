INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model, created_at, updated_at)
SELECT workspace_id, 'TITLE_RECOMMENDATION', provider, connection_id, model, created_at, updated_at
FROM agent_model_policies
WHERE scope = 'TOPIC_RECOMMENDATION'
ON CONFLICT (workspace_id, scope) DO NOTHING;

DELETE FROM agent_model_policies
WHERE scope = 'TOPIC_RECOMMENDATION';
