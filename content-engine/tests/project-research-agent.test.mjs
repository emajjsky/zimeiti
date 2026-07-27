import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProjectMaterialStore } from '../server/services/projectMaterials.cjs';
import {
  buildResearchPlanPrompt,
  parseResearchPlan,
} from '../server/services/project-research.cjs';
import { readProjectUploadText } from '../server/services/projectUploadStorage.cjs';

const validPlan = {
  title: '公众号选题研究计划',
  summary: '先核验产品能力和价格，再确认适合普通用户的使用场景。',
  questions: [{
    question: '产品当前支持哪些核心能力？',
    why: '避免引用过期功能。',
    preferredSources: ['产品官方文档', '官方价格页'],
  }],
  claims: [{ claim: '该功能面向所有免费用户开放。', priority: 'HIGH', reason: '影响文章结论。' }],
  nextActions: [{ action: 'SEARCH_WEB', purpose: '找到最新官方说明。', target: '产品名 官方文档 2026' }],
};

test('研究 Agent 迁移注册动作并持久化消息、计划和资料引用', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/014_project_research_agent.sql', import.meta.url), 'utf8');
  assert.match(migration, /project-research-plan:1\.0\.0/);
  assert.match(migration, /model_scope, execution_target, requires_confirmation/);
  assert.match(migration, /'AGENT_PLANNER', 'worker', true/);
  assert.match(migration, /CREATE TABLE project_agent_messages/);
  assert.match(migration, /CREATE TABLE project_research_plans/);
  assert.match(migration, /CREATE TABLE project_research_materials/);
});

test('研究计划只接受严格对象结构', () => {
  const parsed = parseResearchPlan(`\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``);
  assert.equal(parsed.questions[0].preferredSources.length, 2);
  assert.throws(() => parseResearchPlan(JSON.stringify({ ...validPlan, questions: ['核验产品能力'] })), /expected object/i);
  assert.throws(() => parseResearchPlan(JSON.stringify({ ...validPlan, claims: [{ ...validPlan.claims[0], priority: 'URGENT' }] })), /Invalid option/i);
  assert.throws(() => parseResearchPlan(JSON.stringify({ ...validPlan, nextActions: [{ ...validPlan.nextActions[0], action: 'BROWSE_ANYWHERE' }] })), /Invalid option/i);
});

test('研究提示词区分事实、观点、未读取链接和只有元数据的文件', () => {
  const prompt = buildResearchPlanPrompt({
    project: { title: 'AI 工具选择', coreViewpoint: '先验证真实任务。', factChecks: [] },
    brief: { objective: '公众号文章', targetAudience: '普通创作者', coreMessage: '看实际结果', sourceRequirements: '优先官方来源', notes: '' },
    request: '保留我的观点，核验关键数据。',
    materials: [
      { type: 'INPUT', kind: 'IDEA', title: '我的观点', body: '先看任务。' },
      { type: 'LINK', role: 'FACT', title: '官方说明', url: 'https://example.com', contentStatus: 'NOT_READ' },
      { type: 'FILE', role: 'VISUAL', title: '参考图', filename: 'cover.png', extractedText: null, contentStatus: 'METADATA_ONLY' },
    ],
  });
  assert.match(prompt.system, /不能把观点和风格参考当成已验证事实/);
  assert.match(prompt.system, /不得假装读过文件内容/);
  assert.match(prompt.message, /NOT_READ/);
  assert.match(prompt.message, /METADATA_ONLY/);
  assert.match(prompt.message, /保留我的观点/);
});

test('研究资料选择按工作空间和项目隔离', async () => {
  const calls = [];
  const inputId = '11111111-1111-4111-8111-111111111111';
  const referenceId = '22222222-2222-4222-8222-222222222222';
  const store = createProjectMaterialStore({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (/project_inputs/.test(sql)) return { rows: [{ id: inputId }] };
    return { rows: [{ id: referenceId }] };
  } });
  await store.researchSnapshot('workspace-a', 'project-a', [inputId], [referenceId]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => /workspace_id = \$1 AND project_id = \$2/.test(sql)));
  assert.ok(calls.every(({ params }) => params[0] === 'workspace-a' && params[1] === 'project-a'));

  const missingStore = createProjectMaterialStore({ query: async () => ({ rows: [] }) });
  await assert.rejects(
    () => missingStore.researchSnapshot('workspace-a', 'project-a', [inputId], []),
    (error) => error.statusCode === 400 && /不属于当前项目/.test(error.message),
  );
});

test('文本资料读取遵守字节上限并拒绝越界路径', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'content-engine-research-'));
  try {
    await fsp.mkdir(path.join(root, 'workspace'), { recursive: true });
    await fsp.writeFile(path.join(root, 'workspace', 'notes.txt'), '1234567890更多内容', 'utf8');
    assert.equal(await readProjectUploadText(root, 'workspace/notes.txt', 10), '1234567890');
    await assert.rejects(() => readProjectUploadText(root, '../outside.txt', 10), /路径无效/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('研究计划先准备确认卡，用户确认后才入队', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepareStart = server.indexOf("/research/prepare");
  const confirmStart = server.indexOf("/research-runs/:id/confirm");
  const cancelStart = server.indexOf("/research-runs/:id/cancel");
  assert.ok(prepareStart > -1 && confirmStart > prepareStart && cancelStart > confirmStart);
  assert.match(server.slice(prepareStart, confirmStart), /'DRAFT'/);
  assert.match(server.slice(prepareStart, confirmStart), /project_research_materials/);
  assert.doesNotMatch(server.slice(prepareStart, confirmStart), /await enqueue/);
  assert.match(server.slice(confirmStart, cancelStart), /PROJECT_RESEARCH_PLAN/);
  assert.match(server.slice(confirmStart, cancelStart), /await enqueue/);
});

test('项目资料页具备真实进度、资料选择和 Agent 完整状态', () => {
  const materials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(materials, /项目概览[\s\S]*项目资料[\s\S]*研究计划[\s\S]*正式文案/);
  assert.match(materials, /selectedInputIds[\s\S]*selectedReferenceIds/);
  assert.match(materials, /研究已引用/);
  assert.match(materials, /webCreative\.agentContext/);
  assert.match(agent, /发送/);
  assert.match(agent, /确认调用/);
  assert.match(agent, /QUEUED[\s\S]*RUNNING[\s\S]*FAILED/);
  assert.match(agent, /待回答问题[\s\S]*待核验主张[\s\S]*下一步/);
  assert.match(workspace, /draftCandidate\?\.status === 'ACCEPTED'/);
  assert.match(workspace, /body !== project\.coreViewpoint\.trim\(\)/);
  assert.match(styles, /\.project-research-layout/);
  assert.match(styles, /\.project-agent\{/);
  assert.match(styles, /@media \(max-width:1100px\).*\.project-research-layout\{grid-template-columns:1fr\}/s);
});

test('研究与文案共用一个 ProjectAgent 组件', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const materials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
  assert.match(agent, /CURRENT[\s\S]*ALL/);
  assert.match(agent, /MESSAGE[\s\S]*CONFIRMATION[\s\S]*RUN_STATUS[\s\S]*ARTIFACT[\s\S]*SYSTEM_EVENT/);
  assert.match(agent, /acceptArtifact/);
  assert.match(materials, /<ProjectAgent/);
  assert.doesNotMatch(materials, /ProjectResearchAgent/);
});
