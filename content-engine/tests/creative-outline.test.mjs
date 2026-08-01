import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildOutlinePrompt,
  defaultOutlineTemplate,
  outlineTemplateScope,
  parseOutlineContent,
} from '../server/services/creative-outline.cjs';

const snapshot = {
  project: { id: 'project-1', title: '普通人如何使用 AI', coreViewpoint: '从真实任务出发。', factChecks: ['核验产品价格'] },
  brief: { objective: '形成公众号文章', targetAudience: '普通读者', coreMessage: '先定义问题', sourceRequirements: '仅使用已给来源', lengthTarget: '1500 字', selectedPlatforms: ['WECHAT'], notes: '' },
  skills: [
    { dimension: 'SUBJECT', name: 'AI 科普', version: { version: '1.0.0', instructions: '解释术语，不夸大能力。' } },
    { dimension: 'CONTENT_TYPE', name: '实用教程', version: { version: '1.0.0', instructions: '按任务步骤组织。' } },
    { dimension: 'VOICE', name: '清晰自然', version: { version: '1.0.0', instructions: '使用短句。' } },
    { dimension: 'CHANNEL', name: '公众号', version: { version: '1.0.0', instructions: '适合微信阅读。' } },
  ],
  platform: 'WECHAT',
};

const output = {
  titleOptions: ['普通人用 AI，先做对这一件事', '别急着学提示词'],
  summary: '先指出误区，再用实际任务拆解方法。',
  sections: [
    { heading: '开篇', purpose: '建立问题', keyPoints: ['工具很多，任务定义更重要'] },
    { heading: '方法', purpose: '拆解流程', keyPoints: ['明确输入', '检查输出'] },
    { heading: '结尾', purpose: '给出行动', keyPoints: ['从一个真实任务开始'] },
  ],
  factsToVerify: ['产品价格与版本限制'],
};

test('大纲提示词包含 Brief、平台和四项写作规则，不包含排版', () => {
  const prompt = buildOutlinePrompt({ ...snapshot, template: '先解释误区，再给出行动路径。' });
  assert.match(prompt.system, /只生成大纲候选/);
  assert.match(prompt.system, /WECHAT/);
  assert.match(prompt.message, /形成公众号文章/);
  assert.match(prompt.message, /解释术语，不夸大能力/);
  assert.match(prompt.message, /先解释误区，再给出行动路径/);
  assert.doesNotMatch(prompt.message, /LAYOUT|公众号长文|使用分级标题/);
  assert.doesNotMatch(prompt.message, /selectedSkills|platformSkills/);
});

test('公众号和小红书使用独立大纲 Scope 与默认模板', () => {
  assert.equal(outlineTemplateScope('WECHAT'), 'CREATIVE_OUTLINE_WECHAT');
  assert.equal(outlineTemplateScope('XIAOHONGSHU'), 'CREATIVE_OUTLINE_XIAOHONGSHU');
  assert.match(defaultOutlineTemplate('WECHAT'), /公众号图文/);
  assert.match(defaultOutlineTemplate('XIAOHONGSHU'), /小红书图文/);
  assert.notEqual(defaultOutlineTemplate('WECHAT'), defaultOutlineTemplate('XIAOHONGSHU'));
});

test('模型大纲通过严格 JSON 结构校验', () => {
  const parsed = parseOutlineContent(['```json', JSON.stringify(output), '```'].join('\n'));
  assert.equal(parsed.sections.length, 3);
  assert.equal(parsed.titleOptions[0], output.titleOptions[0]);
});

test('字符串章节和字符串平台式结果会被拒绝', () => {
  assert.throws(() => parseOutlineContent(JSON.stringify({ ...output, sections: ['开篇', '方法', '结尾'] })), /expected object/i);
  assert.throws(() => parseOutlineContent(JSON.stringify({ ...output, sections: [{ heading: '只有标题' }] })), /expected/i);
});

test('Agent 动作迁移保留旧 Skill 系统并建立动作执行引用', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/009_creative_outline_action.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE agent_action_definitions/);
  assert.match(migration, /ADD COLUMN action_version_id/);
  assert.match(migration, /creative-outline:1\.0\.0/);
  assert.doesNotMatch(migration, /DROP TABLE skill_definitions|ALTER TABLE skill_definitions/);
  const platformActionMigration = fs.readFileSync(new URL('../server/migrations/011_platform_outline_action_v1_1.sql', import.meta.url), 'utf8');
  assert.match(platformActionMigration, /creative-outline:1\.1\.0/);
  assert.match(platformActionMigration, /status = 'CANCELLED'/);
});

test('大纲 API 仅在确认后入队，采用候选时才更新目标项目', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepareStart = server.indexOf("/outline/prepare");
  const confirmStart = server.indexOf("/outline-runs/:id/confirm");
  const acceptStart = server.indexOf("/outline-candidates/:id/accept");
  const acceptEnd = server.indexOf("/draft/prepare", acceptStart);
  assert.ok(prepareStart > -1 && confirmStart > prepareStart && acceptStart > confirmStart && acceptEnd > acceptStart);
  assert.match(server.slice(prepareStart, confirmStart), /textTaskRoute\(workspace\.id, OUTLINE_SCOPE, '文案生成'\)/);
  assert.doesNotMatch(server.slice(prepareStart, confirmStart), /await enqueue/);
  assert.match(server.slice(confirmStart, acceptStart), /await enqueue/);
  assert.match(server.slice(acceptStart, acceptEnd), /updateCreativeProjects/);
  assert.doesNotMatch(server.slice(acceptStart, acceptEnd), /UPDATE workspace_snapshots SET state_json/);
  assert.match(server.slice(acceptStart, acceptEnd), /status = 'ACCEPTED'/);
  assert.doesNotMatch(server.slice(acceptStart, acceptEnd), /version\.body\s*=/);
});

test('开发环境同时启动 API、Web 与 Worker', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.dev, /npm:dev:worker/);
});
