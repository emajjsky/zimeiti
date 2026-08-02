import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAFT_ADAPTATION_PROMPT_VERSION,
  adaptationScope,
  buildAdaptationPrompt,
  createDraftAdaptationService,
  parseAdaptationOutput,
} from '../server/services/draft-adaptation.cjs';
import { registerContentDraftRoutes } from '../server/routes/content-drafts.cjs';
import { createContentDraftStore } from '../server/services/content-drafts.cjs';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const JOB_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ASSET_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const NOW = '2026-08-02T12:00:00.000Z';

function sourceDraft(overrides = {}) {
  return {
    id: SOURCE_DRAFT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: 'project-1',
    platform: 'WECHAT',
    status: 'READY',
    revision: 4,
    title: '公众号母稿',
    body: '这是已经完成并冻结的公众号正文。',
    visualPlan: {},
    layoutTemplateVersionId: null,
    sourceDraftVersionId: null,
    sourceStale: false,
    currentVersionId: SOURCE_VERSION_ID,
    assets: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function sourceVersion() {
  return {
    id: SOURCE_VERSION_ID,
    workspaceId: WORKSPACE_ID,
    draftId: SOURCE_DRAFT_ID,
    platform: 'WECHAT',
    versionNumber: 2,
    title: '公众号母稿',
    body: '这是已经完成并冻结的公众号正文。',
    visualPlan: {},
    renderedHtml: '<article>正文</article>',
    layoutTemplateVersionId: null,
    sourceDraftVersionId: null,
    generationRunId: null,
    assets: [{ id: 'asset-link-1', workspaceId: WORKSPACE_ID, draftId: SOURCE_DRAFT_ID, draftVersionId: SOURCE_VERSION_ID, assetId: ASSET_ID, role: 'COVER', sortOrder: 0, createdAt: NOW }],
    createdAt: NOW,
  };
}

function runRow(platform = 'XIAOHONGSHU') {
  const scope = adaptationScope(platform);
  return {
    id: RUN_ID,
    status: 'QUEUED',
    created_at: NOW,
    source_snapshot_json: {
      draftId: SOURCE_DRAFT_ID,
      projectId: 'project-1',
      platform,
      sourceDraftVersionId: SOURCE_VERSION_ID,
      source: sourceVersion(),
      strategy: { platform, imageLimit: 9, layoutRequired: false },
      policy: { scope, provider: 'OPENAI_COMPATIBLE', connectionId: 'connection-1', model: 'model-1', promptVersion: DRAFT_ADAPTATION_PROMPT_VERSION },
    },
    input_json: { route: { provider: 'OPENAI_COMPATIBLE', connectionId: 'connection-1', model: 'model-1' } },
  };
}

test('平台适配 Scope 只允许小红书和微博', () => {
  assert.equal(adaptationScope('XIAOHONGSHU'), 'XIAOHONGSHU_ADAPTATION');
  assert.equal(adaptationScope('WEIBO'), 'WEIBO_ADAPTATION');
  assert.throws(() => adaptationScope('WECHAT'), (error) => error.code === 'DRAFT_PLATFORM_UNSUPPORTED');
});

test('适配提示词冻结公众号版本和内容型图片规则', () => {
  const prompt = buildAdaptationPrompt(runRow().source_snapshot_json);
  const message = JSON.parse(prompt.message);
  assert.equal(message.source.versionId, SOURCE_VERSION_ID);
  assert.equal(message.source.assets[0].assetId, ASSET_ID);
  assert.equal(message.strategy.layoutRequired, false);
  assert.match(prompt.system, /图片内容为主/);
  assert.match(prompt.system, /避免.*PPT/);
});

test('严格解析小红书和微博输出并限制为来源素材', () => {
  const xiaohongshu = parseAdaptationOutput(JSON.stringify({
    title: '真实体验',
    body: '先说结论，再给过程。',
    imageSuggestions: [{ sourceAssetId: ASSET_ID, purpose: '展示真实使用场景', preferredRatio: '3:4', needsNewImage: false }],
  }), 'XIAOHONGSHU', [ASSET_ID]);
  assert.equal(xiaohongshu.imageSuggestions[0].sourceAssetId, ASSET_ID);

  const weibo = parseAdaptationOutput(JSON.stringify({
    title: '',
    body: '一条完整微博正文。',
    imageSuggestions: [{ sourceAssetId: ASSET_ID, purpose: '保留母稿封面', preferredRatio: 'original', needsNewImage: false }],
  }), 'WEIBO', [ASSET_ID]);
  assert.equal(weibo.body, '一条完整微博正文。');
});

test('适配输出拒绝包装、空正文、未知字段、未知素材和超过九张图', () => {
  const valid = { title: '标题', body: '正文', imageSuggestions: [] };
  assert.throws(() => parseAdaptationOutput(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, 'XIAOHONGSHU', []), /JSON/);
  assert.throws(() => parseAdaptationOutput(JSON.stringify({ ...valid, body: '  ' }), 'XIAOHONGSHU', []), /正文/);
  assert.throws(() => parseAdaptationOutput(JSON.stringify({ ...valid, extra: true }), 'XIAOHONGSHU', []), /字段|格式/);
  assert.throws(() => parseAdaptationOutput(JSON.stringify({ ...valid, imageSuggestions: [{ sourceAssetId: ASSET_ID, purpose: '未知图', preferredRatio: '3:4', needsNewImage: false }] }), 'XIAOHONGSHU', []), /来源素材/);
  assert.throws(() => parseAdaptationOutput(JSON.stringify({ ...valid, imageSuggestions: Array.from({ length: 10 }, () => ({ sourceAssetId: null, purpose: '新图', preferredRatio: '3:4', needsNewImage: true })) }), 'XIAOHONGSHU', []), /9/);
  assert.throws(() => parseAdaptationOutput(JSON.stringify({ ...valid, imageSuggestions: [{ sourceAssetId: null, purpose: '新图', preferredRatio: 'original', needsNewImage: false }] }), 'WEIBO', []), /素材/);
});

test('prepare 先校验显式策略并只创建等待确认的冻结任务', async () => {
  const inserts = [];
  let derivedWrites = 0;
  const service = createDraftAdaptationService({
    query: async (sql, values) => {
      inserts.push({ sql, values });
      return { rowCount: 1, rows: [{ ...runRow('XIAOHONGSHU'), status: 'DRAFT' }] };
    },
    transaction: async (callback) => callback({ query: async () => ({ rowCount: 0, rows: [] }) }),
    draftStore: {
      get: async () => sourceDraft(),
      versions: async () => [sourceVersion()],
      createDerivedWorkingCopy: async () => { derivedWrites += 1; },
    },
    resolveTaskRoute: async (_workspaceId, scope) => {
      assert.equal(scope, 'XIAOHONGSHU_ADAPTATION');
      return { provider: 'OPENAI_COMPATIBLE', connectionId: 'connection-1', model: 'model-1' };
    },
    enqueue: async () => { throw new Error('prepare 不应入队'); },
  });

  const prepared = await service.prepare({ workspaceId: WORKSPACE_ID, sourceDraftId: SOURCE_DRAFT_ID, platform: 'XIAOHONGSHU' });
  assert.equal(prepared.status, 'DRAFT');
  assert.equal(prepared.confirmation.sourceDraftVersionId, SOURCE_VERSION_ID);
  assert.equal(prepared.confirmation.policy.scope, 'XIAOHONGSHU_ADAPTATION');
  assert.equal(derivedWrites, 0);
  const snapshot = JSON.parse(inserts[0].values[1]);
  assert.equal(snapshot.source.title, '公众号母稿');
  assert.equal(snapshot.source.assets[0].assetId, ASSET_ID);
});

test('缺少任务策略时 prepare 不创建 run 或派生草稿', async () => {
  let touched = false;
  const missingPolicy = Object.assign(new Error('请先配置任务策略'), { code: 'TASK_POLICY_REQUIRED' });
  const service = createDraftAdaptationService({
    query: async () => { touched = true; throw new Error('不应写数据库'); },
    transaction: async () => { touched = true; },
    draftStore: { get: async () => sourceDraft(), versions: async () => [sourceVersion()] },
    resolveTaskRoute: async () => { throw missingPolicy; },
    enqueue: async () => { touched = true; },
  });
  await assert.rejects(() => service.prepare({ workspaceId: WORKSPACE_ID, sourceDraftId: SOURCE_DRAFT_ID, platform: 'WEIBO' }), (error) => error.code === 'TASK_POLICY_REQUIRED');
  assert.equal(touched, false);
});

test('confirm 才创建 DRAFT_ADAPTATION Job，cancel 同时取消等待任务', async () => {
  const jobs = [];
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes("SET status = 'QUEUED'")) return { rowCount: 1, rows: [runRow('WEIBO')] };
    if (sql.includes('INSERT INTO jobs')) return { rowCount: 1, rows: [{ id: JOB_ID, workspace_id: WORKSPACE_ID, job_type: 'DRAFT_ADAPTATION', payload_json: { runId: RUN_ID, draftId: SOURCE_DRAFT_ID, sourceDraftVersionId: SOURCE_VERSION_ID, platform: 'WEIBO' } }] };
    if (sql.includes("SET status = 'CANCELLED'")) return { rowCount: 1, rows: [{ id: RUN_ID, status: 'CANCELLED' }] };
    if (sql.includes('UPDATE jobs')) return { rowCount: 1, rows: [] };
    throw new Error(`未处理 SQL：${sql}`);
  } };
  const service = createDraftAdaptationService({
    query: client.query.bind(client),
    transaction: async (callback) => callback(client),
    draftStore: {},
    resolveTaskRoute: async () => ({}),
    enqueue: async (job) => { jobs.push(job); },
  });

  const confirmed = await service.confirm({ workspaceId: WORKSPACE_ID, runId: RUN_ID });
  assert.deepEqual(confirmed, { id: RUN_ID, status: 'QUEUED', jobId: JOB_ID });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].job_type, 'DRAFT_ADAPTATION');
  const cancelled = await service.cancel({ workspaceId: WORKSPACE_ID, runId: RUN_ID });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.ok(statements.some((sql) => sql.includes('UPDATE jobs')));
});

test('Worker 成功解析后才写派生工作副本，且不改写已有不可变版本', async () => {
  const target = { id: 'target-draft', revision: 3, title: '用户旧标题', body: '用户旧正文', visualPlan: {}, assets: [] };
  let immutableVersionWrites = 0;
  const run = runRow('XIAOHONGSHU');
  const rootQueries = [];
  const transactionQueries = [];
  const draftStore = {
    async get() { return sourceDraft(); },
    async createDerivedWorkingCopy() { return { ...target }; },
    async patchWorkingCopy(_workspaceId, _draftId, input) {
      Object.assign(target, { title: input.title, body: input.body, visualPlan: input.visualPlan, revision: target.revision + 1 });
      return { ...target };
    },
    async replaceWorkingAssets(_workspaceId, _draftId, input) {
      target.assets = input.assets;
      target.revision += 1;
      return { ...target };
    },
    async complete() { immutableVersionWrites += 1; },
  };
  const client = { async query(sql) {
    transactionQueries.push(sql);
    if (sql.includes("status = 'RUNNING'") && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{ id: RUN_ID }] };
    return { rowCount: 1, rows: [] };
  } };
  const service = createDraftAdaptationService({
    query: async (sql) => {
      rootQueries.push(sql);
      if (sql.includes('FROM generation_runs')) return { rowCount: 1, rows: [run] };
      return { rowCount: 1, rows: [] };
    },
    transaction: async (callback) => callback(client),
    draftStore,
    resolveTaskRoute: async () => ({}),
    enqueue: async () => {},
    runTextTask: async () => ({ content: JSON.stringify({ title: '小红书标题', body: '小红书正文', imageSuggestions: [{ sourceAssetId: ASSET_ID, purpose: '沿用母稿封面', preferredRatio: '3:4', needsNewImage: false }] }), inputTokens: 120, outputTokens: 80 }),
  });

  const result = await service.execute({ workspaceId: WORKSPACE_ID, jobId: JOB_ID, runId: RUN_ID });
  assert.equal(result.draftId, target.id);
  assert.equal(target.title, '小红书标题');
  assert.equal(target.body, '小红书正文');
  assert.deepEqual(target.assets, [{ assetId: ASSET_ID, role: 'COVER' }]);
  assert.equal(immutableVersionWrites, 0);
  assert.ok(rootQueries.some((sql) => sql.includes("status = 'RUNNING'")));
  assert.ok(transactionQueries.some((sql) => sql.includes("status = 'SUCCEEDED'")));
});

test('Worker 遇到非法模型输出时保留已有派生草稿', async () => {
  let writes = 0;
  const run = runRow('WEIBO');
  const service = createDraftAdaptationService({
    query: async (sql) => sql.includes('FROM generation_runs') ? { rowCount: 1, rows: [run] } : { rowCount: 1, rows: [] },
    transaction: async (callback) => callback({ query: async () => ({ rowCount: 1, rows: [] }) }),
    draftStore: {
      get: async () => sourceDraft(),
      createDerivedWorkingCopy: async () => { writes += 1; },
      patchWorkingCopy: async () => { writes += 1; },
      replaceWorkingAssets: async () => { writes += 1; },
    },
    resolveTaskRoute: async () => ({}),
    enqueue: async () => {},
    runTextTask: async () => ({ content: '{"title":"坏输出","body":"","imageSuggestions":[]}', inputTokens: 1, outputTokens: 1 }),
  });
  await assert.rejects(() => service.execute({ workspaceId: WORKSPACE_ID, jobId: JOB_ID, runId: RUN_ID }), /正文/);
  assert.equal(writes, 0);
});

test('Worker 在模型调用前拒绝已经过期的公众号来源版本', async () => {
  let modelCalls = 0;
  let writes = 0;
  const run = runRow('XIAOHONGSHU');
  const service = createDraftAdaptationService({
    query: async (sql) => sql.includes('FROM generation_runs') ? { rowCount: 1, rows: [run] } : { rowCount: 1, rows: [] },
    transaction: async (callback) => callback({ query: async () => ({ rowCount: 1, rows: [] }) }),
    draftStore: {
      get: async () => sourceDraft({ currentVersionId: '11111111-1111-4111-8111-111111111111' }),
      createDerivedWorkingCopy: async () => { writes += 1; },
      patchWorkingCopy: async () => { writes += 1; },
      replaceWorkingAssets: async () => { writes += 1; },
    },
    resolveTaskRoute: async () => ({}),
    enqueue: async () => {},
    runTextTask: async () => { modelCalls += 1; return { content: '{}' }; },
  });

  await assert.rejects(
    () => service.execute({ workspaceId: WORKSPACE_ID, jobId: JOB_ID, runId: RUN_ID }),
    (error) => error.code === 'DRAFT_SOURCE_VERSION_STALE',
  );
  assert.equal(modelCalls, 0);
  assert.equal(writes, 0);
});

test('内容草稿路由把 derive、confirm、cancel 交给适配服务', async () => {
  const routes = new Map();
  const app = {
    get(path, _options, handler) { routes.set(path, handler); },
    patch() {},
    put() {},
    post(path, _options, handler) { routes.set(path, handler); },
  };
  const calls = [];
  const adaptationService = {
    async prepare(input) { calls.push(['prepare', input]); return { id: RUN_ID, status: 'DRAFT' }; },
    async get(input) { calls.push(['get', input]); return { id: RUN_ID, status: 'SUCCEEDED', result: { draftId: 'target-draft', platform: 'XIAOHONGSHU' } }; },
    async confirm(input) { calls.push(['confirm', input]); return { id: RUN_ID, status: 'QUEUED', jobId: JOB_ID }; },
    async cancel(input) { calls.push(['cancel', input]); return { id: RUN_ID, status: 'CANCELLED' }; },
  };
  registerContentDraftRoutes(app, { workspaceAccess: { forRole: () => async () => {} }, draftStore: {}, adaptationService });

  const reply = { statusCode: 200, code(value) { this.statusCode = value; return this; }, send(value) { return value; } };
  await routes.get('/api/v1/content-draft-adaptation-runs/:runId')({ workspace: { id: WORKSPACE_ID }, params: { runId: RUN_ID } }, reply);
  await routes.get('/api/v1/content-drafts/:draftId/derive')({ workspace: { id: WORKSPACE_ID }, params: { draftId: SOURCE_DRAFT_ID }, body: { platform: 'XIAOHONGSHU' } }, reply);
  await routes.get('/api/v1/content-draft-adaptation-runs/:runId/confirm')({ workspace: { id: WORKSPACE_ID }, params: { runId: RUN_ID } }, reply);
  await routes.get('/api/v1/content-draft-adaptation-runs/:runId/cancel')({ workspace: { id: WORKSPACE_ID }, params: { runId: RUN_ID } }, reply);

  assert.deepEqual(calls, [
    ['get', { workspaceId: WORKSPACE_ID, runId: RUN_ID }],
    ['prepare', { workspaceId: WORKSPACE_ID, sourceDraftId: SOURCE_DRAFT_ID, platform: 'XIAOHONGSHU' }],
    ['confirm', { workspaceId: WORKSPACE_ID, runId: RUN_ID }],
    ['cancel', { workspaceId: WORKSPACE_ID, runId: RUN_ID }],
  ]);
});

test('派生草稿可复用 Worker 当前事务，不开启嵌套事务', async () => {
  const source = sourceVersion();
  const target = {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: WORKSPACE_ID,
    project_id: 'project-1',
    platform: 'XIAOHONGSHU',
    status: 'EDITING',
    revision: 1,
    title: '',
    body: '',
    visual_plan_json: {},
    layout_template_version_id: null,
    source_draft_version_id: SOURCE_VERSION_ID,
    source_stale: false,
    current_version_id: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const client = { async query(sql) {
    if (sql.includes('FROM content_draft_versions')) return { rowCount: 1, rows: [{ id: source.id }] };
    if (sql.includes('INSERT INTO content_drafts')) return { rowCount: 1, rows: [target] };
    throw new Error(`未处理 SQL：${sql}`);
  } };
  const store = createContentDraftStore({
    query: async () => { throw new Error('传入事务 client 后不应调用根连接'); },
    transaction: async () => { throw new Error('传入事务 client 后不应开启嵌套事务'); },
  });

  const created = await store.createDerivedWorkingCopy(WORKSPACE_ID, 'project-1', 'XIAOHONGSHU', SOURCE_VERSION_ID, client);
  assert.equal(created.id, target.id);
  assert.equal(created.sourceDraftVersionId, SOURCE_VERSION_ID);
});
