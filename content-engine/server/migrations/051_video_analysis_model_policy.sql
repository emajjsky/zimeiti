UPDATE agent_model_policies video_policy
SET model = content_policy.model,
    provider = content_policy.provider,
    connection_id = content_policy.connection_id,
    updated_at = now()
FROM agent_model_policies content_policy
WHERE video_policy.workspace_id = content_policy.workspace_id
  AND video_policy.scope = 'VIDEO_ANALYSIS'
  AND content_policy.scope = 'CONTENT_UNDERSTANDING'
  AND content_policy.provider = 'BAILIAN_CLI'
  AND content_policy.model ~* '^qwen3\.[6-8]([-_.]|$)'
  AND content_policy.model !~* 'omni'
  AND (video_policy.model !~* '^qwen3\.[6-8]([-_.]|$)' OR video_policy.model ~* 'omni');

DELETE FROM agent_model_policies
WHERE scope = 'VIDEO_ANALYSIS'
  AND (provider <> 'BAILIAN_CLI' OR model !~* '^qwen3\.[6-8]([-_.]|$)' OR model ~* 'omni');
