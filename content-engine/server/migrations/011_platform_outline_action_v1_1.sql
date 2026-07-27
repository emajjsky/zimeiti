INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('creative-outline:1.1.0', 'creative-outline', '1.1.0',
   '{"requires":["project","writingBrief","sharedSkillComposition","platformSkillComposition","platform","modelRoute"]}'::jsonb,
   '{"outputs":["titleOptions","summary","sections","factsToVerify"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE generation_runs
SET status = 'CANCELLED',
    error = '平台规则已升级，请重新生成确认卡。',
    completed_at = now()
WHERE action_version_id = 'creative-outline:1.0.0'
  AND status = 'DRAFT';
