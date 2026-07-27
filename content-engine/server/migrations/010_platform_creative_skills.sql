ALTER TABLE creative_skill_compositions
  ADD COLUMN platform_versions_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE creative_skill_compositions c
SET platform_versions_json = jsonb_strip_nulls(jsonb_build_object(
  'WECHAT', CASE
    WHEN b.selected_platforms_json ? 'WECHAT' THEN jsonb_build_object(
      'LAYOUT', 'creative-layout-wechat:1.0.0',
      'CHANNEL', 'creative-channel-wechat:1.0.0'
    )
  END,
  'XIAOHONGSHU', CASE
    WHEN b.selected_platforms_json ? 'XIAOHONGSHU' THEN jsonb_build_object(
      'LAYOUT', 'creative-layout-xhs:1.0.0',
      'CHANNEL', 'creative-channel-xhs:1.0.0'
    )
  END
))
FROM writing_briefs b
WHERE b.composition_id = c.id;
