import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const copy = require('../server/services/project-copy-action.cjs');
const visual = require('../server/services/visual-planning.cjs');
const { runView } = require('../server/services/project-agent.cjs');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `缺少起点：${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `缺少终点：${end}`);
  return source.slice(from, to);
}

test('公众号正文和视觉策划使用各自显式任务 Scope', () => {
  assert.equal(copy.WECHAT_COPY_GENERATION_SCOPE, 'WECHAT_COPY_GENERATION');
  for (const action of copy.COPY_ACTIONS) assert.equal(copy.copyActionScope(action), 'WECHAT_COPY_GENERATION');
  assert.equal(visual.VISUAL_PLANNING_SCOPE, 'WECHAT_VISUAL_PLANNING');
  assert.equal(visual.VISUAL_PLANNING_OPERATION, 'WECHAT_VISUAL_PLANNING');
});

test('正文准备只接受公众号并冻结可见策略快照', async () => {
  const server = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepare = section(server, "/agent/prepare", "/agent-runs/:id/confirm");
  assert.match(prepare, /input\.platform !== 'WECHAT'/);
  assert.match(prepare, /platform:\s*'WECHAT'/);
  assert.match(prepare, /scope:\s*WECHAT_COPY_GENERATION_SCOPE/);
  assert.match(prepare, /provider:\s*route\.provider/);
  assert.match(prepare, /connectionId:\s*route\.connectionId \?\? null/);
  assert.match(prepare, /model:\s*route\.model/);
  assert.match(prepare, /promptVersion:\s*template\.version/);
});

test('生成任务 DTO 直接公开完整策略快照', () => {
  const view = runView({
    id: 'run-1',
    action_version_id: 'project-copy-generate-draft:1.0.0',
    status: 'DRAFT',
    model: 'qwen-plus',
    prompt_version: '3',
    source_snapshot_json: {
      request: '生成正文',
      platform: 'WECHAT',
      policy: {
        scope: 'WECHAT_COPY_GENERATION',
        provider: 'EXTERNAL_API',
        connectionId: '11111111-1111-4111-8111-111111111111',
        model: 'qwen-plus',
        promptVersion: 3,
      },
    },
    input_json: {},
  });

  assert.deepEqual(view.policy, {
    scope: 'WECHAT_COPY_GENERATION',
    provider: 'EXTERNAL_API',
    connectionId: '11111111-1111-4111-8111-111111111111',
    model: 'qwen-plus',
    promptVersion: 3,
  });
});

test('Agent 运行状态接口按当前工作空间读取终态', async () => {
  const server = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const status = section(server, "app.get('/api/v1/creative/agent-runs/:id'", "app.post('/api/v1/creative/agent-runs/:id/confirm'");
  assert.match(status, /id = \$1 AND workspace_id = \$2/);
  assert.match(status, /runView\(result\.rows\[0\]\)/);
  assert.match(status, /statusCode = 404/);
});

test('缺失任务策略返回稳定错误码且图生图不回退到文生图', async () => {
  const server = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const routeResolver = section(server, 'async function textTaskRoute', 'function analysisItem');
  const imageGeneration = section(server, "/visual/generate", 'function escapeDeliveryHtml');
  assert.match(routeResolver, /TASK_POLICY_REQUIRED/);
  assert.doesNotMatch(imageGeneration, /scope = 'TEXT_TO_IMAGE'/);
  assert.match(imageGeneration, /TASK_POLICY_REQUIRED/);
});

test('Worker 成功结果只更新公众号工作草稿而不双写旧平台正文', async () => {
  const worker = await readFile(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const execute = section(worker, 'async function generateProjectCopyAction', 'async function generateAgentPlan');
  assert.match(execute, /draftStore\.upsertWechat/);
  assert.match(execute, /scope:\s*WECHAT_COPY_GENERATION_SCOPE/);
  assert.doesNotMatch(execute, /platform_content_versions/);
  assert.doesNotMatch(execute, /updateCreativeProjects/);
  assert.doesNotMatch(execute, /applyAcceptedCopyToState/);
});

test('视觉保存只写公众号草稿视觉计划和有序素材', async () => {
  const server = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const saveVisual = section(server, "app.put('/api/v1/creative/projects/:projectId/visual'", "app.post('/api/v1/creative/projects/:projectId/visual/complete'");
  assert.match(saveVisual, /draftStore\.patchWorkingCopy/);
  assert.match(saveVisual, /draftStore\.replaceWorkingAssets/);
  assert.doesNotMatch(saveVisual, /delivery\.platforms/);
  assert.doesNotMatch(saveVisual, /updateCreativeProjects/);
});

test('前端模型任务契约没有 fallback 字段并公开新任务 Scope', async () => {
  const integrations = await readFile(new URL('../src/domain/integrations.ts', import.meta.url), 'utf8');
  assert.match(integrations, /'WECHAT_COPY_GENERATION'/);
  assert.match(integrations, /'WECHAT_VISUAL_PLANNING'/);
  assert.match(integrations, /'WECHAT_TEMPLATE_ANALYSIS'/);
  assert.match(integrations, /'XIAOHONGSHU_ADAPTATION'/);
  assert.match(integrations, /'WEIBO_ADAPTATION'/);
  assert.match(integrations, /'CONTENT_PREFLIGHT_REVIEW'/);
  assert.doesNotMatch(integrations, /fallbackProvider|fallbackConnectionId|fallbackModel/);
});
