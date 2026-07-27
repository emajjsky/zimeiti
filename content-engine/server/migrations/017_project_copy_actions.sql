INSERT INTO agent_action_definitions
  (id, name, description, model_scope, execution_target, requires_confirmation)
VALUES
  ('project-copy-generate-outline', '生成文案大纲', '根据项目上下文生成目标平台的大纲候选。', 'CONTENT_WRITING', 'worker', true),
  ('project-copy-generate-draft', '生成完整文案', '根据项目上下文生成目标平台的完整正文候选。', 'CONTENT_WRITING', 'worker', true),
  ('project-copy-polish-existing-draft', '润色现有文案', '保留事实与观点，改善现有文案表达。', 'CONTENT_REWRITE', 'worker', true),
  ('project-copy-restructure-draft', '重构文案', '保留核心观点，重新组织现有文案结构。', 'CONTENT_REWRITE', 'worker', true),
  ('project-copy-expand-draft', '扩写文案', '围绕已有内容补充解释、案例和必要细节。', 'CONTENT_REWRITE', 'worker', true),
  ('project-copy-shorten-draft', '压缩文案', '保留核心信息，压缩重复或次要表达。', 'CONTENT_REWRITE', 'worker', true),
  ('project-copy-revise-selection', '修改选区', '只修改用户明确选择的文案范围。', 'CONTENT_REWRITE', 'worker', true),
  ('project-copy-adapt-platform', '适配平台', '将现有内容改写为目标平台版本。', 'CONTENT_REWRITE', 'worker', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_action_versions
  (id, action_id, version, input_schema_json, output_schema_json)
VALUES
  ('project-copy-generate-outline:1.0.0', 'project-copy-generate-outline', '1.0.0',
    '{"requires":["project","request","platform","writingBrief","skills","modelRoute"]}'::jsonb,
    '{"outputs":["titleOptions","summary","sections","factsToVerify"]}'::jsonb),
  ('project-copy-generate-draft:1.0.0', 'project-copy-generate-draft', '1.0.0',
    '{"requires":["project","request","platform","writingBrief","skills","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb),
  ('project-copy-polish-existing-draft:1.0.0', 'project-copy-polish-existing-draft', '1.0.0',
    '{"requires":["project","request","platform","currentContent","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb),
  ('project-copy-restructure-draft:1.0.0', 'project-copy-restructure-draft', '1.0.0',
    '{"requires":["project","request","platform","currentContent","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb),
  ('project-copy-expand-draft:1.0.0', 'project-copy-expand-draft', '1.0.0',
    '{"requires":["project","request","platform","currentContent","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb),
  ('project-copy-shorten-draft:1.0.0', 'project-copy-shorten-draft', '1.0.0',
    '{"requires":["project","request","platform","currentContent","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb),
  ('project-copy-revise-selection:1.0.0', 'project-copy-revise-selection', '1.0.0',
    '{"requires":["project","request","platform","currentContent","selection","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb),
  ('project-copy-adapt-platform:1.0.0', 'project-copy-adapt-platform', '1.0.0',
    '{"requires":["project","request","platform","currentContent","modelRoute"]}'::jsonb,
    '{"outputs":["title","body","changeSummary","factsToVerify"]}'::jsonb)
ON CONFLICT (id) DO NOTHING;
