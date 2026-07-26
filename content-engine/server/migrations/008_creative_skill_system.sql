CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  positioning text NOT NULL DEFAULT '',
  target_audience text NOT NULL DEFAULT '',
  voice_rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creative_skill_definitions (
  id text PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  dimension text NOT NULL CHECK (dimension IN ('SUBJECT', 'CONTENT_TYPE', 'VOICE', 'LAYOUT', 'CHANNEL')),
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (workspace_id, dimension, slug)
);

CREATE TABLE creative_skill_versions (
  id text PRIMARY KEY,
  definition_id text NOT NULL REFERENCES creative_skill_definitions(id) ON DELETE CASCADE,
  version text NOT NULL,
  instructions_md text NOT NULL,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version)
);

CREATE TABLE creative_skill_compositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  selected_versions_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id)
);

CREATE TABLE writing_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  composition_id uuid NOT NULL REFERENCES creative_skill_compositions(id) ON DELETE RESTRICT,
  objective text NOT NULL DEFAULT '',
  target_audience text NOT NULL DEFAULT '',
  core_message text NOT NULL DEFAULT '',
  source_requirements text NOT NULL DEFAULT '',
  length_target text NOT NULL DEFAULT '',
  selected_platforms_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id)
);

CREATE INDEX creative_skill_catalog_idx ON creative_skill_definitions (dimension, sort_order, name) WHERE enabled;
CREATE INDEX writing_briefs_workspace_updated_idx ON writing_briefs (workspace_id, updated_at DESC);

INSERT INTO creative_skill_definitions (id, dimension, slug, name, description, sort_order) VALUES
  ('creative-subject-general', 'SUBJECT', 'general', '通用', '不附加垂直领域术语，优先保证事实与表达清楚。', 10),
  ('creative-subject-ai', 'SUBJECT', 'ai-technology', 'AI 科技', '解释技术能力、使用边界和普通人的实际应用。', 20),
  ('creative-subject-finance', 'SUBJECT', 'finance', '财经', '区分事实、数据与观点，避免收益承诺。', 30),
  ('creative-subject-history', 'SUBJECT', 'history-humanities', '历史人文', '尊重史料语境，区分史实、推断和演绎。', 40),
  ('creative-subject-classics', 'SUBJECT', 'chinese-classics', '国学', '引用经典需标明出处，避免玄化和伪古文。', 50),
  ('creative-type-education', 'CONTENT_TYPE', 'education', '科普', '从读者问题出发，用例子解释概念和边界。', 10),
  ('creative-type-analysis', 'CONTENT_TYPE', 'analysis', '深度解读', '交代背景、因果、影响和仍不确定的部分。', 20),
  ('creative-type-commentary', 'CONTENT_TYPE', 'commentary', '评论', '先陈述事实，再给出有依据的明确观点。', 30),
  ('creative-type-tutorial', 'CONTENT_TYPE', 'tutorial', '教程', '按可执行步骤组织，并写明前提、结果和常见错误。', 40),
  ('creative-type-list', 'CONTENT_TYPE', 'list', '盘点', '用统一标准筛选条目，避免简单堆砌。', 50),
  ('creative-type-story', 'CONTENT_TYPE', 'story', '故事化', '用人物、冲突和转折承载信息，不虚构关键事实。', 60),
  ('creative-voice-fresh', 'VOICE', 'plain-fresh', '通俗清新', '短句为主，自然亲切，不使用夸张营销话术。', 10),
  ('creative-voice-professional', 'VOICE', 'professional', '专业克制', '表达准确、结构紧凑，重要判断给出依据。', 20),
  ('creative-voice-sharp', 'VOICE', 'sharp-commentary', '犀利评论', '观点鲜明但不攻击个人，不用情绪代替证据。', 30),
  ('creative-voice-narrative', 'VOICE', 'narrative', '故事化表达', '用具体场景推进，让抽象信息可感知。', 40),
  ('creative-layout-wechat', 'LAYOUT', 'wechat-longform', '公众号长文', '适配移动阅读，使用短段落、小标题、重点句和配图位。', 10),
  ('creative-layout-xhs', 'LAYOUT', 'xiaohongshu-carousel', '小红书分页图文', '一页一个信息点，首图给结论，末页给行动建议。', 20),
  ('creative-channel-wechat', 'CHANNEL', 'wechat', '公众号', '标题、摘要、封面和正文共同服务完整阅读。', 10),
  ('creative-channel-xhs', 'CHANNEL', 'xiaohongshu', '小红书', '强调搜索词、首屏吸引力、收藏价值和互动问题。', 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO creative_skill_versions (id, definition_id, version, instructions_md, rules_json)
SELECT id || ':1.0.0', id, '1.0.0', description, jsonb_build_object('builtIn', true)
FROM creative_skill_definitions
WHERE workspace_id IS NULL
ON CONFLICT (id) DO NOTHING;
