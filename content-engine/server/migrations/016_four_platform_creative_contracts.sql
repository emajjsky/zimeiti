INSERT INTO creative_skill_definitions (id, dimension, slug, name, description, sort_order) VALUES
  ('creative-layout-zhihu', 'LAYOUT', 'zhihu-answer', '知乎回答', '结论前置，围绕问题语境建立清晰论证层次，使用可扫读的小标题和证据段落。', 30),
  ('creative-layout-weibo', 'LAYOUT', 'weibo-thread', '微博单条与串文', '优先适配单条表达；信息较多时拆成前后连贯、每条可独立阅读的串文。', 40),
  ('creative-channel-zhihu', 'CHANNEL', 'zhihu', '知乎', '回应具体问题，明确结论、依据和边界，避免只有态度没有论证。', 30),
  ('creative-channel-weibo', 'CHANNEL', 'weibo', '微博', '突出时效、观点密度和首句信息量，控制单条与串文的阅读节奏。', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO creative_skill_versions (id, definition_id, version, instructions_md, rules_json)
SELECT id || ':1.0.0', id, '1.0.0', description, jsonb_build_object('builtIn', true)
FROM creative_skill_definitions
WHERE id IN (
  'creative-layout-zhihu',
  'creative-layout-weibo',
  'creative-channel-zhihu',
  'creative-channel-weibo'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE creative_outline_candidates
  DROP CONSTRAINT IF EXISTS creative_outline_candidates_platform_check;

ALTER TABLE creative_outline_candidates
  ADD CONSTRAINT creative_outline_candidates_platform_check
  CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO'));

ALTER TABLE creative_draft_candidates
  DROP CONSTRAINT IF EXISTS creative_draft_candidates_platform_check;

ALTER TABLE creative_draft_candidates
  ADD CONSTRAINT creative_draft_candidates_platform_check
  CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO'));
