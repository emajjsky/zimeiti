import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import copyActionModule from '../server/services/project-copy-action.cjs';

const {
  COPY_ACTIONS,
  buildCopyPrompt,
  copyActionVersion,
  copyTemplateScope,
  defaultRevisionTemplate,
  applyAcceptedCopyToState,
  copyPromptTemplateScope,
  mergeFactsToVerify,
  parseCopyOutput,
  resolveCopyAction,
} = copyActionModule;

function routeSlice(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `缺少路由 ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `缺少后续路由 ${end}`);
  return source.slice(from, to);
}

test('文案请求按固定优先级确定性映射到注册动作', () => {
  assert.equal(resolveCopyAction({ request: '把这篇文章润色一下', hasBody: true }).action, 'POLISH_EXISTING_DRAFT');
  assert.equal(resolveCopyAction({ request: '压缩到 800 字', hasBody: true }).action, 'SHORTEN_DRAFT');
  assert.equal(resolveCopyAction({ request: '改成微博串文', hasBody: true, targetPlatform: 'WEIBO' }).action, 'ADAPT_PLATFORM');
  assert.equal(resolveCopyAction({ request: '把选中的两段改得更清楚', hasBody: true, selection: '原文' }).action, 'REVISE_SELECTION');
  assert.equal(resolveCopyAction({ request: '扩写这篇内容', hasBody: true }).action, 'EXPAND_DRAFT');
  assert.equal(resolveCopyAction({ request: '重新调整文章结构', hasBody: true }).action, 'RESTRUCTURE_DRAFT');
  assert.equal(resolveCopyAction({ request: '先生成文章大纲', hasBody: false }).action, 'GENERATE_OUTLINE');
  assert.equal(resolveCopyAction({ request: '写一篇完整正文', hasBody: false }).action, 'GENERATE_DRAFT');
});

test('正文为空时，开始或正文默认生成完整正文而不反问', () => {
  assert.equal(resolveCopyAction({ request: '开始', hasBody: false }).action, 'GENERATE_DRAFT');
  assert.equal(resolveCopyAction({ request: '正文', hasBody: false }).action, 'GENERATE_DRAFT');
});

test('无法唯一判断的请求要求澄清且不创建动作', () => {
  assert.deepEqual(resolveCopyAction({ request: '处理一下', hasBody: true }), {
    needsClarification: true,
    question: '你希望润色、重构、扩写还是压缩当前文案？',
  });
  assert.deepEqual(resolveCopyAction({ request: '把这篇文章润色并压缩', hasBody: true }), {
    needsClarification: true,
    question: '这次要优先润色表达，还是压缩篇幅？',
  });
});

test('八个文案动作拥有稳定版本且模型输出保持待核验事实', () => {
  assert.equal(COPY_ACTIONS.length, 8);
  assert.equal(copyActionVersion('SHORTEN_DRAFT'), 'project-copy-shorten-draft:1.0.0');
  const output = parseCopyOutput(JSON.stringify({
    title: '调整后的标题',
    body: '这是调整后的完整正文。'.repeat(12),
    changeSummary: '压缩重复表达并保留核心观点。',
    factsToVerify: ['核验公开数据的发布日期'],
  }), 'SHORTEN_DRAFT');
  assert.deepEqual(output.factsToVerify, ['核验公开数据的发布日期']);
  assert.throws(() => parseCopyOutput(JSON.stringify({ ...output, factsToVerify: '已经核验' }), 'SHORTEN_DRAFT'), /array|expected/i);
});

test('四个平台拥有独立修订提示词 Scope 和规则', () => {
  for (const platform of ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']) {
    assert.equal(copyTemplateScope(platform), `CREATIVE_REVISION_${platform}`);
  }
  assert.match(defaultRevisionTemplate('WECHAT'), /公众号/);
  assert.match(defaultRevisionTemplate('XIAOHONGSHU'), /小红书/);
  assert.match(defaultRevisionTemplate('ZHIHU'), /知乎|论证/);
  assert.match(defaultRevisionTemplate('WEIBO'), /微博|单条|串文/);
});

test('文案提示词冻结动作、平台规则并禁止洗掉待核验事实', () => {
  const prompt = buildCopyPrompt({
    action: 'POLISH_EXISTING_DRAFT',
    request: '让表达更自然',
    platform: 'WECHAT',
    template: '保留作者的个人表达。',
    project: { title: '项目标题', coreViewpoint: '核心观点', factChecks: ['核验价格'] },
    brief: { objective: '完成文章', targetAudience: '普通读者', coreMessage: '先说明边界', sourceRequirements: '使用公开来源', lengthTarget: '1500 字', notes: '' },
    currentContent: { title: '原标题', body: '原正文', factsToVerify: ['核验价格'] },
    skills: [{ dimension: 'VOICE', name: '自然', version: { version: '1.0.0', instructions: '短句表达。' } }],
    materials: [],
  });
  assert.match(prompt.system, /POLISH_EXISTING_DRAFT/);
  assert.match(prompt.system, /factsToVerify/);
  assert.match(prompt.system, /不得.*已确认事实/);
  assert.match(prompt.message, /保留作者的个人表达/);
  assert.match(prompt.message, /核验价格/);
});

test('017 注册八个需要确认的受控文案动作', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/017_project_copy_actions.sql', import.meta.url), 'utf8');
  for (const action of COPY_ACTIONS) assert.match(migration, new RegExp(copyActionVersion(action).replace(/[.]/g, '\\.')));
  assert.match(migration, /requires_confirmation/);
  assert.match(migration, /CONTENT_WRITING/);
  assert.match(migration, /CONTENT_REWRITE/);
});

test('四平台修订提示词在设置页可见并接入服务端模板仓储', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../src/workspaces/settings/PromptTemplateSettings.tsx', import.meta.url), 'utf8');
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.WECHAT/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.XIAOHONGSHU/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.ZHIHU/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.WEIBO/);
  assert.match(api, /CREATIVE_REVISION_WECHAT/);
  assert.match(api, /CREATIVE_REVISION_WEIBO/);
  assert.match(settings, /id: 'REVISION', label: '修改文案'/);
});

test('不同文案动作冻结对应的大纲、初稿或修订模板', () => {
  assert.equal(copyPromptTemplateScope('GENERATE_OUTLINE', 'WECHAT'), 'CREATIVE_OUTLINE_WECHAT');
  assert.equal(copyPromptTemplateScope('GENERATE_DRAFT', 'ZHIHU'), 'CREATIVE_DRAFT_ZHIHU');
  assert.equal(copyPromptTemplateScope('POLISH_EXISTING_DRAFT', 'WEIBO'), 'CREATIVE_REVISION_WEIBO');
});

test('Project Agent prepare 不入队，confirm 才创建 Worker Job', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepare = routeSlice(server, "/agent/prepare", "/agent-runs/:id/confirm");
  const confirm = routeSlice(server, "/agent-runs/:id/confirm", "/agent-runs/:id/cancel");
  assert.match(prepare, /status.*DRAFT/s);
  assert.doesNotMatch(prepare, /await enqueue/);
  assert.match(confirm, /PROJECT_COPY_ACTION/);
  assert.match(confirm, /await enqueue/);
});

test('Project Agent Worker 只创建候选产物，不直接覆盖正式正文', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const execute = routeSlice(worker, 'async function generateProjectCopyAction', 'async function generateAgentPlan');
  assert.match(worker, /PROJECT_COPY_ACTION/);
  assert.match(execute, /project_artifacts/);
  assert.match(execute, /platform_content_versions/);
  assert.doesNotMatch(execute, /workspace_snapshots/);
});

test('采用候选时更新正式版本并合并待核验事实', () => {
  const state = {
    projects: [{
      id: 'project-1',
      title: '项目',
      status: 'BRIEF',
      factChecks: ['核验原始价格', ''],
      versions: [{ id: 'wechat-1', platform: 'WECHAT', status: 'DRAFT', title: '旧标题', body: '旧正文', updatedAt: '旧时间' }],
    }],
  };
  const result = applyAcceptedCopyToState(state, {
    projectId: 'project-1',
    platform: 'WECHAT',
    title: '新标题',
    body: '新正文',
    factsToVerify: ['核验原始价格', ' 核验发布日期 '],
    updatedAt: '12:30',
  });
  assert.equal(result.project.status, 'WRITING');
  assert.equal(result.project.versions[0].title, '新标题');
  assert.equal(result.project.versions[0].body, '新正文');
  assert.deepEqual(result.project.factChecks, ['核验原始价格', '核验发布日期']);
  assert.deepEqual(mergeFactsToVerify([' A ', '', 'B'], ['B', 'C']), ['A', 'B', 'C']);
});

test('采用候选和启用平台都锁定 workspace snapshot 且保持幂等', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const accept = routeSlice(server, "/project-artifacts/:id/accept", "/projects/:projectId/platforms/:platform");
  const enable = routeSlice(server, "/projects/:projectId/platforms/:platform", "/agent/skills");
  assert.match(accept, /FOR UPDATE/);
  assert.match(accept, /FOR UPDATE OF a(?!, v)/);
  assert.doesNotMatch(accept, /FOR UPDATE OF a, v/);
  assert.match(accept, /workspace_snapshots/);
  assert.match(accept, /platform_content_versions/);
  assert.match(accept, /upsertStageSummary/);
  assert.match(enable, /FOR UPDATE/);
  assert.match(enable, /existingVersion|find\(/);
  assert.match(enable, /VIDEO_CHANNEL/);
});
