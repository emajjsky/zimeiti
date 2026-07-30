import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCreativeSkillStore, DIMENSIONS, WRITING_DIMENSIONS } from '../server/services/creativeSkills.cjs';
import { creativeStages } from '../src/domain/creative-flow.mjs';

const selection = {
  SUBJECT: 'creative-subject-ai:1.0.0',
  CONTENT_TYPE: 'creative-type-education:1.0.0',
  VOICE: 'creative-voice-fresh:1.0.0',
  LAYOUT: 'creative-layout-wechat:1.0.0',
  CHANNEL: 'creative-channel-wechat:1.0.0',
};
const platformSkills = {
  WECHAT: { LAYOUT: 'creative-layout-wechat:1.0.0', CHANNEL: 'creative-channel-wechat:1.0.0' },
  XIAOHONGSHU: { LAYOUT: 'creative-layout-xhs:1.0.0', CHANNEL: 'creative-channel-xhs:1.0.0' },
};

test('创作 Skill 固定为五个规则维度', () => {
  assert.deepEqual(DIMENSIONS, ['SUBJECT', 'CONTENT_TYPE', 'VOICE', 'LAYOUT', 'CHANNEL']);
  assert.deepEqual(WRITING_DIMENSIONS, ['SUBJECT', 'CONTENT_TYPE', 'CHANNEL']);
  const migration = fs.readFileSync(new URL('../server/migrations/008_creative_skill_system.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE writing_briefs/);
  assert.match(migration, /CREATE TABLE creative_skill_compositions/);
  assert.doesNotMatch(migration, /DROP TABLE skill_definitions|ALTER TABLE skill_definitions/);
  const platformMigration = fs.readFileSync(new URL('../server/migrations/010_platform_creative_skills.sql', import.meta.url), 'utf8');
  assert.match(platformMigration, /ADD COLUMN platform_versions_json/);
  assert.match(platformMigration, /creative-layout-xhs:1\.0\.0/);
});

test('保存 WritingBrief 前校验每个维度对应的 Skill 版本', async () => {
  let transactionCalled = false;
  const store = createCreativeSkillStore({
    query: async () => ({ rowCount: 5, rows: Object.entries(selection).map(([dimension, id]) => ({ dimension, id })) }),
    transaction: async (callback) => {
      transactionCalled = true;
      let call = 0;
      return callback({ query: async () => {
        call += 1;
        if (call === 1) return { rows: [{ id: 'composition-id' }] };
        return { rows: [{ id: 'brief-id', project_id: 'project-1', objective: '解释一个问题', target_audience: '普通读者', core_message: '核心观点', source_requirements: '', length_target: '1500 字', selected_platforms_json: ['WECHAT'], notes: '', updated_at: '2026-07-26T08:00:00.000Z' }] };
      } });
    },
  });
  const result = await store.saveBrief('workspace-id', 'project-1', { objective: '解释一个问题', targetAudience: '普通读者', coreMessage: '核心观点', sourceRequirements: '', lengthTarget: '1500 字', selectedPlatforms: ['WECHAT'], notes: '', accountVoiceProfileId: '715a27a6-38d7-4bcf-ab68-4765fbb0f697', voiceOffset: 'SHARPER', selectedSkills: selection, platformSkills });
  assert.equal(transactionCalled, true);
  assert.deepEqual(result.selectedSkills, selection);
  assert.deepEqual(result.platformSkills, platformSkills);
  assert.equal(result.accountVoiceProfileId, '715a27a6-38d7-4bcf-ab68-4765fbb0f697');
  assert.equal(result.voiceOffset, 'SHARPER');
});

test('错误维度的 Skill 组合不会写入数据库', async () => {
  let transactionCalled = false;
  const store = createCreativeSkillStore({
    query: async () => ({ rowCount: 5, rows: Object.entries(selection).map(([dimension, id], index) => ({ dimension: index === 0 ? 'VOICE' : dimension, id })) }),
    transaction: async () => { transactionCalled = true; },
  });
  await assert.rejects(() => store.saveBrief('workspace-id', 'project-1', { selectedPlatforms: ['WECHAT'], selectedSkills: selection, platformSkills }), /写作策略无效/);
  assert.equal(transactionCalled, false);
});

test('生成小红书内容只冻结写作维度和小红书平台规则', async () => {
  let call = 0;
  const rows = [
    { id: 'creative-subject-ai', dimension: 'SUBJECT', slug: 'ai-technology', name: 'AI 科技', description: '', sort_order: 1, version_id: selection.SUBJECT, version: '1.0.0', instructions_md: 'AI 规则', rules_json: {} },
    { id: 'creative-type-education', dimension: 'CONTENT_TYPE', slug: 'education', name: '科普', description: '', sort_order: 1, version_id: selection.CONTENT_TYPE, version: '1.0.0', instructions_md: '科普规则', rules_json: {} },
    { id: 'creative-voice-fresh', dimension: 'VOICE', slug: 'plain-fresh', name: '通俗清新', description: '', sort_order: 1, version_id: selection.VOICE, version: '1.0.0', instructions_md: '语言规则', rules_json: {} },
    { id: 'creative-channel-xhs', dimension: 'CHANNEL', slug: 'xiaohongshu', name: '小红书', description: '', sort_order: 1, version_id: platformSkills.XIAOHONGSHU.CHANNEL, version: '1.0.0', instructions_md: '小红书渠道', rules_json: {} },
  ];
  const store = createCreativeSkillStore({
    accountVoiceStore: { getWritingSnapshot: async () => ({ id: 'voice-1', name: '把话说透', version: 1, rules: {}, offset: 'DEFAULT' }) },
    query: async () => {
      call += 1;
      if (call === 1) return { rowCount: 1, rows: [{ id: 'brief-id', project_id: 'project-1', selected_platforms_json: ['WECHAT', 'XIAOHONGSHU'], selected_versions_json: selection, platform_versions_json: platformSkills, account_voice_profile_id: 'voice-1', voice_offset: 'DEFAULT' }] };
      return { rowCount: rows.length, rows };
    },
    transaction: async () => { throw new Error('不应进入事务'); },
  });
  const context = await store.getContext('workspace-id', 'project-1', 'XIAOHONGSHU');
  assert.deepEqual(context.skills.map((skill) => skill.name), ['AI 科技', '科普', '小红书']);
  assert.equal(context.skills.some((skill) => skill.dimension === 'LAYOUT'), false);
  assert.equal(context.skills.some((skill) => skill.name === '公众号长文' || skill.name === '公众号'), false);
});

test('写作上下文读取账号声音快照而不是 VOICE Skill', async () => {
  let call = 0;
  const store = createCreativeSkillStore({
    accountVoiceStore: { getWritingSnapshot: async () => ({ id: 'voice-1', name: '把话说透', version: 2, rules: { opening: '直接进入事实。' }, offset: 'SHARPER' }) },
    query: async () => {
      call += 1;
      if (call === 1) return { rowCount: 1, rows: [{ project_id: 'project-1', selected_platforms_json: ['WECHAT'], selected_versions_json: selection, platform_versions_json: platformSkills, account_voice_profile_id: 'voice-1', voice_offset: 'SHARPER' }] };
      return { rowCount: 3, rows: [
        { id: 'subject', dimension: 'SUBJECT', slug: 'ai', name: 'AI 科技', description: '', sort_order: 1, version_id: selection.SUBJECT, version: '1.0.0', instructions_md: '题材规则', rules_json: {} },
        { id: 'type', dimension: 'CONTENT_TYPE', slug: 'education', name: '科普', description: '', sort_order: 1, version_id: selection.CONTENT_TYPE, version: '1.0.0', instructions_md: '内容规则', rules_json: {} },
        { id: 'channel', dimension: 'CHANNEL', slug: 'wechat', name: '公众号', description: '', sort_order: 1, version_id: platformSkills.WECHAT.CHANNEL, version: '1.0.0', instructions_md: '渠道规则', rules_json: {} },
      ] };
    },
    transaction: async () => { throw new Error('不应写入'); },
  });

  const context = await store.getContext('workspace-1', 'project-1', 'WECHAT');

  assert.deepEqual(context.skills.map((skill) => skill.dimension), ['SUBJECT', 'CONTENT_TYPE', 'CHANNEL']);
  assert.equal(context.accountVoice.name, '把话说透');
  assert.equal(context.accountVoice.offset, 'SHARPER');
});

test('未选择账号声音时仍可获得写作上下文', async () => {
  let call = 0;
  let voiceSnapshotCalled = false;
  const store = createCreativeSkillStore({
    accountVoiceStore: {
      getWritingSnapshot: async () => {
        voiceSnapshotCalled = true;
        return null;
      },
    },
    query: async () => {
      call += 1;
      if (call === 1) {
        return {
          rowCount: 1,
          rows: [{
            project_id: 'project-1',
            selected_platforms_json: ['WECHAT'],
            selected_versions_json: selection,
            platform_versions_json: platformSkills,
            account_voice_profile_id: null,
            voice_offset: 'DEFAULT',
          }],
        };
      }
      return {
        rowCount: 3,
        rows: [
          { id: 'subject', dimension: 'SUBJECT', slug: 'ai', name: 'AI 科技', description: '', sort_order: 1, version_id: selection.SUBJECT, version: '1.0.0', instructions_md: '题材规则', rules_json: {} },
          { id: 'type', dimension: 'CONTENT_TYPE', slug: 'education', name: '科普', description: '', sort_order: 1, version_id: selection.CONTENT_TYPE, version: '1.0.0', instructions_md: '内容规则', rules_json: {} },
          { id: 'channel', dimension: 'CHANNEL', slug: 'wechat', name: '公众号', description: '', sort_order: 1, version_id: platformSkills.WECHAT.CHANNEL, version: '1.0.0', instructions_md: '渠道规则', rules_json: {} },
        ],
      };
    },
    transaction: async () => { throw new Error('不应写入'); },
  });

  const context = await store.getContext('workspace-1', 'project-1', 'WECHAT');

  assert.deepEqual(context.skills.map((skill) => skill.dimension), ['SUBJECT', 'CONTENT_TYPE', 'CHANNEL']);
  assert.equal(context.accountVoice, null);
  assert.equal(voiceSnapshotCalled, false);
});

test('创作主流程不再把视频列为必经步骤', () => {
  assert.deepEqual(
    creativeStages.map(({ id, label }) => ({ id, label })),
    [
      { id: 'planning', label: '规划' },
      { id: 'research', label: '研究' },
      { id: 'master', label: '正文' },
      { id: 'platform', label: '平台版本' },
      { id: 'visual', label: '配图' },
      { id: 'layout', label: '排版' },
      { id: 'review', label: '审核' },
    ],
  );
  assert.equal(creativeStages.some(({ id, label }) => id === 'video' || label === '视频'), false);

  const source = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const briefSchema = fs.readFileSync(new URL('../server/services/writing-brief.cjs', import.meta.url), 'utf8');
  assert.match(source, /version\.platform !== 'VIDEO_CHANNEL'/);
  assert.match(source, /webCreative\.saveBrief/);
  assert.match(briefSchema, /const creativePlatform = z\.enum\(\['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO'\]\)/);
  assert.match(briefSchema, /selectedPlatforms: z\.array\(creativePlatform\)/);
  assert.doesNotMatch(briefSchema, /const creativePlatform = z\.enum\([^\n]*VIDEO_CHANNEL/);
});

test('Skill 只在文案阶段作为写作策略出现，排版不参与写作确认', () => {
  const planning = fs.readFileSync(new URL('../src/workspaces/create/PlanningWorkspace.tsx', import.meta.url), 'utf8');
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  assert.deepEqual(WRITING_DIMENSIONS, ['SUBJECT', 'CONTENT_TYPE', 'CHANNEL']);
  assert.doesNotMatch(planning, /Skill 组合|creative-skill-panel|写作策略/);
  assert.match(copy, /copy-strategy/);
  assert.match(copy, /题材[\s\S]*内容类型[\s\S]*语言风格/);
  assert.match(copy, /sharedDimensions\.map/);
  assert.match(copy, /内容结构[\s\S]*渠道规则/);
  assert.doesNotMatch(copy, />排版</);
});

test('提示词模板按任务和四个图文平台分别配置', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/settings/PromptTemplateSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /CREATIVE_\$\{task\}_\$\{platform\}/);
  assert.match(source, /公众号图文/);
  assert.match(source, /小红书图文/);
  assert.match(source, /知乎回答/);
  assert.match(source, /微博内容/);
  assert.match(source, /prompt-platform-tabs/);
  assert.doesNotMatch(source, /CREATIVE_OUTLINE'|CREATIVE_DRAFT'/);
});
