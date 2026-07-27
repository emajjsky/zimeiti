import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildDraftPrompt,
  parseDraftContent,
} from '../server/services/creative-draft.cjs';

const snapshot = {
  project: { id: 'project-1', title: '普通人如何使用 AI', coreViewpoint: '从真实任务出发。', factChecks: ['核验产品价格'] },
  brief: { objective: '形成公众号文章', targetAudience: '普通读者', coreMessage: '先定义问题', sourceRequirements: '仅使用已给来源', lengthTarget: '1500 字', selectedPlatforms: ['WECHAT'], notes: '' },
  skills: [
    { dimension: 'SUBJECT', name: 'AI 科普', version: { version: '1.0.0', instructions: '解释术语，不夸大能力。' } },
    { dimension: 'CONTENT_TYPE', name: '实用教程', version: { version: '1.0.0', instructions: '按任务步骤组织。' } },
    { dimension: 'VOICE', name: '清晰自然', version: { version: '1.0.0', instructions: '使用短句。' } },
    { dimension: 'LAYOUT', name: '公众号长文', version: { version: '1.0.0', instructions: '使用清晰小标题。' } },
    { dimension: 'CHANNEL', name: '公众号', version: { version: '1.0.0', instructions: '适合微信阅读。' } },
  ],
  platform: 'WECHAT',
  outline: {
    id: 'outline-1',
    selectedTitle: '普通人用 AI，先做对这一件事',
    summary: '先指出误区，再拆解方法。',
    sections: [
      { heading: '先定义问题', purpose: '明确任务', keyPoints: ['写清输入和输出'] },
      { heading: '再选择工具', purpose: '降低试错', keyPoints: ['比较成本'] },
      { heading: '最后验证结果', purpose: '形成闭环', keyPoints: ['设置验收标准'] },
    ],
    factsToVerify: ['产品价格'],
  },
};

const output = {
  title: '普通人用 AI，先做对这一件事',
  body: '很多人接触 AI 后，第一反应是寻找功能最多的工具。但真正决定结果的，往往不是工具数量，而是你能否先把问题说清楚。\n\n先写下任务的输入、期望输出和验收标准，再比较不同工具的学习成本与使用成本。完成一次真实任务后，根据结果决定是否继续使用。',
  factsToVerify: ['核验产品当前价格'],
};

test('初稿提示词冻结业务模板、已采用大纲和五维 Skill', () => {
  const prompt = buildDraftPrompt({ ...snapshot, template: '开头直接提出问题，结尾给出一项行动。' });
  assert.match(prompt.system, /完整正文/);
  assert.match(prompt.system, /不要使用 #、##、###/);
  assert.match(prompt.message, /开头直接提出问题/);
  assert.match(prompt.message, /普通人用 AI，先做对这一件事/);
  assert.match(prompt.message, /解释术语，不夸大能力/);
});

test('模型初稿必须是完整 JSON，正文不能过短', () => {
  const parsed = parseDraftContent(['```json', JSON.stringify(output), '```'].join('\n'));
  assert.equal(parsed.title, output.title);
  assert.match(parsed.body, /验收标准/);
  assert.throws(() => parseDraftContent(JSON.stringify({ ...output, body: '只有一句话。' })), /too small|expected/i);
  assert.throws(() => parseDraftContent(JSON.stringify({ ...output, body: `## 标题\n\n${output.body}` })), /Markdown 标题/);
});

test('初稿迁移建立候选表和受控动作版本', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/012_creative_draft_action.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE creative_draft_candidates/);
  assert.match(migration, /outline_candidate_id/);
  assert.match(migration, /creative-draft:1\.0\.0/);
  assert.match(migration, /requires_confirmation/);
});

test('初稿 API 要求已采用大纲，确认后才入队，采用后才写正文', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepareStart = server.indexOf("/draft/prepare");
  const confirmStart = server.indexOf("/draft-runs/:id/confirm");
  const acceptStart = server.indexOf("/draft-candidates/:id/accept");
  const acceptEnd = server.indexOf("/agent/skills", acceptStart);
  assert.ok(prepareStart > -1 && confirmStart > prepareStart && acceptStart > confirmStart && acceptEnd > acceptStart);
  const prepare = server.slice(prepareStart, confirmStart);
  const confirm = server.slice(confirmStart, server.indexOf("/draft-runs/:id/cancel", confirmStart));
  const accept = server.slice(acceptStart, acceptEnd);
  assert.match(prepare, /status = 'ACCEPTED'/);
  assert.match(prepare, /template: \{ id: template\.id, version: template\.version, body: template\.body \}/);
  assert.doesNotMatch(prepare, /await enqueue/);
  assert.match(confirm, /await enqueue/);
  assert.match(accept, /version\.body = candidate\.output_json\.body/);
  assert.match(accept, /UPDATE workspace_snapshots SET state_json/);
});

test('Worker 使用任务冻结的提示词模板并只保存候选', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const start = worker.indexOf('async function generateCreativeDraft');
  const end = worker.indexOf('async function generateAgentPlan', start);
  const draftWorker = worker.slice(start, end);
  assert.match(draftWorker, /template: input\.template\.body/);
  assert.match(draftWorker, /INSERT INTO creative_draft_candidates/);
  assert.doesNotMatch(draftWorker, /workspace_snapshots|version\.body/);
});
