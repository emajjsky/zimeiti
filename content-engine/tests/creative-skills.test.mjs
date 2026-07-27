import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCreativeSkillStore, DIMENSIONS } from '../server/services/creativeSkills.cjs';

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
  const result = await store.saveBrief('workspace-id', 'project-1', { objective: '解释一个问题', targetAudience: '普通读者', coreMessage: '核心观点', sourceRequirements: '', lengthTarget: '1500 字', selectedPlatforms: ['WECHAT'], notes: '', selectedSkills: selection, platformSkills });
  assert.equal(transactionCalled, true);
  assert.deepEqual(result.selectedSkills, selection);
  assert.deepEqual(result.platformSkills, platformSkills);
});

test('错误维度的 Skill 组合不会写入数据库', async () => {
  let transactionCalled = false;
  const store = createCreativeSkillStore({
    query: async () => ({ rowCount: 5, rows: Object.entries(selection).map(([dimension, id], index) => ({ dimension: index === 0 ? 'VOICE' : dimension, id })) }),
    transaction: async () => { transactionCalled = true; },
  });
  await assert.rejects(() => store.saveBrief('workspace-id', 'project-1', { selectedPlatforms: ['WECHAT'], selectedSkills: selection, platformSkills }), /Skill 组合无效/);
  assert.equal(transactionCalled, false);
});

test('生成小红书内容只冻结小红书排版与渠道 Skill', async () => {
  let call = 0;
  const rows = [
    { id: 'creative-subject-ai', dimension: 'SUBJECT', slug: 'ai-technology', name: 'AI 科技', description: '', sort_order: 1, version_id: selection.SUBJECT, version: '1.0.0', instructions_md: 'AI 规则', rules_json: {} },
    { id: 'creative-type-education', dimension: 'CONTENT_TYPE', slug: 'education', name: '科普', description: '', sort_order: 1, version_id: selection.CONTENT_TYPE, version: '1.0.0', instructions_md: '科普规则', rules_json: {} },
    { id: 'creative-voice-fresh', dimension: 'VOICE', slug: 'plain-fresh', name: '通俗清新', description: '', sort_order: 1, version_id: selection.VOICE, version: '1.0.0', instructions_md: '语言规则', rules_json: {} },
    { id: 'creative-layout-xhs', dimension: 'LAYOUT', slug: 'xiaohongshu-carousel', name: '小红书分页图文', description: '', sort_order: 1, version_id: platformSkills.XIAOHONGSHU.LAYOUT, version: '1.0.0', instructions_md: '小红书排版', rules_json: {} },
    { id: 'creative-channel-xhs', dimension: 'CHANNEL', slug: 'xiaohongshu', name: '小红书', description: '', sort_order: 1, version_id: platformSkills.XIAOHONGSHU.CHANNEL, version: '1.0.0', instructions_md: '小红书渠道', rules_json: {} },
  ];
  const store = createCreativeSkillStore({
    query: async () => {
      call += 1;
      if (call === 1) return { rowCount: 1, rows: [{ id: 'brief-id', project_id: 'project-1', selected_platforms_json: ['WECHAT', 'XIAOHONGSHU'], selected_versions_json: selection, platform_versions_json: platformSkills }] };
      return { rowCount: rows.length, rows };
    },
    transaction: async () => { throw new Error('不应进入事务'); },
  });
  const context = await store.getContext('workspace-id', 'project-1', 'XIAOHONGSHU');
  assert.deepEqual(context.skills.map((skill) => skill.name), ['AI 科技', '科普', '通俗清新', '小红书分页图文', '小红书']);
  assert.equal(context.skills.some((skill) => skill.name === '公众号长文' || skill.name === '公众号'), false);
});

test('创作主流程不再把视频列为必经步骤', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /创作设定[\s\S]*文案[\s\S]*配图[\s\S]*排版[\s\S]*审核/);
  assert.doesNotMatch(source, /label: '视频'/);
  assert.match(source, /version\.platform !== 'VIDEO_CHANNEL'/);
  assert.match(source, /webCreative\.saveBrief/);
  assert.match(server, /selectedPlatforms: z\.array\(z\.enum\(\['WECHAT', 'XIAOHONGSHU'\]\)\)/);
});
