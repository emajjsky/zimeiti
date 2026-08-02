import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WECHAT_LAYOUT_RULES,
  normalizeWechatLayoutRules,
  renderWechatDraft,
} from '../server/services/wechat-layout-renderer.cjs';
import {
  analyzeWechatTemplateSource,
  createWechatLayoutTemplateStore,
} from '../server/services/wechat-layout-templates.cjs';
import { registerWechatLayoutTemplateRoutes } from '../server/routes/wechat-layout-templates.cjs';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-02T00:00:00.000Z';

function asset(index) {
  return {
    assetId: `${String(index + 1).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    role: index === 0 ? 'COVER' : 'BODY',
    sortOrder: index,
  };
}

function templateRow(overrides = {}) {
  return {
    id: TEMPLATE_ID,
    workspace_id: WORKSPACE_ID,
    name: '清爽阅读',
    kind: 'CUSTOM',
    status: 'ACTIVE',
    current_version_id: VERSION_ID,
    created_by: USER_ID,
    created_at: NOW,
    updated_at: NOW,
    version_id: VERSION_ID,
    version_number: 1,
    rules_json: DEFAULT_WECHAT_LAYOUT_RULES,
    source_type: 'MANUAL',
    source_url: null,
    source_fingerprint: null,
    prompt_version: null,
    generation_run_id: null,
    version_created_at: NOW,
    ...overrides,
  };
}

test('公众号渲染器转义内容、自行生成标签且输出确定', () => {
  const input = {
    title: '<script>alert(1)</script>标题',
    body: '## 第一节\n\n正文 <img src=x onerror=alert(1)>\n\n> 引用\n\n---',
    assets: [asset(0)],
    templateRules: DEFAULT_WECHAT_LAYOUT_RULES,
  };
  const first = renderWechatDraft(input);
  const second = renderWechatDraft(input);

  assert.equal(first.html, second.html);
  assert.doesNotMatch(first.html, /<script|<img src=x/i);
  assert.match(first.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;标题/);
  assert.match(first.html, /<h2[^>]*>第一节<\/h2>/);
  assert.match(first.html, /<blockquote[^>]*>引用<\/blockquote>/);
  assert.match(first.html, /<hr[^>]*>/);
  assert.match(first.html, new RegExp(`/api/v1/assets/${asset(0).assetId}/content`));
});

test('公众号渲染器允许最多 12 张图并报告缺图或非法素材', () => {
  assert.equal(renderWechatDraft({ title: '标题', body: '正文', assets: Array.from({ length: 12 }, (_, index) => asset(index)), templateRules: DEFAULT_WECHAT_LAYOUT_RULES }).checks.length, 0);
  assert.throws(
    () => renderWechatDraft({ title: '标题', body: '正文', assets: Array.from({ length: 13 }, (_, index) => asset(index)), templateRules: DEFAULT_WECHAT_LAYOUT_RULES }),
    (error) => error.code === 'DRAFT_IMAGE_LIMIT_EXCEEDED' && error.details.limit === 12,
  );
  const withoutImage = renderWechatDraft({ title: '标题', body: '正文', assets: [], templateRules: DEFAULT_WECHAT_LAYOUT_RULES });
  assert.deepEqual(withoutImage.checks, [{ level: 'WARNING', code: 'DRAFT_IMAGE_MISSING', message: '公众号草稿还没有配置图片。' }]);
  assert.throws(
    () => renderWechatDraft({ title: '标题', body: '正文', assets: [{ assetId: '', role: 'BODY', sortOrder: 0 }], templateRules: DEFAULT_WECHAT_LAYOUT_RULES }),
    (error) => error.code === 'DRAFT_ASSET_INVALID',
  );
});

test('模板规则拒绝任意 CSS 与未知字段，并把数值限制到安全范围', () => {
  assert.throws(
    () => normalizeWechatLayoutRules({ ...DEFAULT_WECHAT_LAYOUT_RULES, arbitraryCss: 'position:fixed' }),
    (error) => error.code === 'LAYOUT_TEMPLATE_RULES_INVALID',
  );
  assert.throws(
    () => normalizeWechatLayoutRules({ ...DEFAULT_WECHAT_LAYOUT_RULES, canvas: { ...DEFAULT_WECHAT_LAYOUT_RULES.canvas, background: 'red' } }),
    (error) => error.code === 'LAYOUT_TEMPLATE_RULES_INVALID',
  );
  const normalized = normalizeWechatLayoutRules({
    ...DEFAULT_WECHAT_LAYOUT_RULES,
    title: { ...DEFAULT_WECHAT_LAYOUT_RULES.title, fontSize: 500 },
    image: { ...DEFAULT_WECHAT_LAYOUT_RULES.image, borderRadius: -30 },
  });
  assert.equal(normalized.title.fontSize, 48);
  assert.equal(normalized.image.borderRadius, 0);
});

test('链接分析必须确认授权且只接受公众号文章 URL', async () => {
  let fetched = false;
  const fetchPublicPage = async () => {
    fetched = true;
    return { url: new URL('https://mp.weixin.qq.com/s/example'), html: '<div id="js_content"></div>' };
  };
  await assert.rejects(
    () => analyzeWechatTemplateSource({ url: 'https://mp.weixin.qq.com/s/example', confirmedRights: false, route: { provider: 'BAILIAN_CLI', model: 'qwen' }, runTextTask: async () => ({}), fetchPublicPage }),
    (error) => error.code === 'LAYOUT_TEMPLATE_RIGHTS_REQUIRED',
  );
  await assert.rejects(
    () => analyzeWechatTemplateSource({ url: 'https://example.com/article', confirmedRights: true, route: { provider: 'BAILIAN_CLI', model: 'qwen' }, runTextTask: async () => ({}), fetchPublicPage }),
    (error) => error.code === 'LAYOUT_TEMPLATE_SOURCE_UNSUPPORTED',
  );
  assert.equal(fetched, false);
});

test('链接分析接受公众号常见的 s 查询参数文章地址', async () => {
  const result = await analyzeWechatTemplateSource({
    url: 'https://mp.weixin.qq.com/s?__biz=example&mid=1',
    confirmedRights: true,
    route: { provider: 'BAILIAN_CLI', model: 'qwen-max' },
    fetchPublicPage: async () => ({ url: new URL('https://mp.weixin.qq.com/s?__biz=example&mid=1'), html: '<div id="js_content"><p>正文</p></div>' }),
    runTextTask: async () => ({ content: JSON.stringify(DEFAULT_WECHAT_LAYOUT_RULES) }),
  });
  assert.equal(result.sourceUrl, 'https://mp.weixin.qq.com/s?__biz=example&mid=1');
});

test('链接分析只向模型发送结构信号，不复制原文、原图或任意样式', async () => {
  const secretText = '不应发送给模型的原文内容';
  const secretImage = 'https://example.com/private-image.jpg';
  const html = `<html><body><div id="js_content" style="color:#223344;font-size:16px;line-height:1.8"><h2 style="color:#112233">${secretText}</h2><p style="margin-bottom:20px">另一段原文</p><blockquote>引用</blockquote><img src="${secretImage}"><hr></div></body></html>`;
  let modelInput;
  const result = await analyzeWechatTemplateSource({
    url: 'https://mp.weixin.qq.com/s/example',
    confirmedRights: true,
    route: { provider: 'BAILIAN_CLI', model: 'qwen-max' },
    fetchPublicPage: async () => ({ url: new URL('https://mp.weixin.qq.com/s/example'), html }),
    runTextTask: async (input) => {
      modelInput = input;
      return { content: JSON.stringify(DEFAULT_WECHAT_LAYOUT_RULES), inputTokens: 10, outputTokens: 20 };
    },
  });

  assert.doesNotMatch(modelInput.message, new RegExp(secretText));
  assert.doesNotMatch(modelInput.message, /private-image\.jpg/);
  assert.match(modelInput.message, /headingCount/);
  assert.equal(result.sourceUrl, 'https://mp.weixin.qq.com/s/example');
  assert.match(result.sourceFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.rules, DEFAULT_WECHAT_LAYOUT_RULES);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 });
  assert.equal('html' in result, false);
  assert.equal('text' in result, false);
});

test('模型返回不合规规则时分析失败，Store 不会产生空模板', async () => {
  let writes = 0;
  const store = createWechatLayoutTemplateStore({
    query: async () => { writes += 1; throw new Error('不应写入'); },
    transaction: async (callback) => { writes += 1; return callback({ query: async () => ({ rows: [] }) }); },
  });
  await assert.rejects(
    () => analyzeWechatTemplateSource({
      url: 'https://mp.weixin.qq.com/s/example',
      confirmedRights: true,
      route: { provider: 'BAILIAN_CLI', model: 'qwen-max' },
      fetchPublicPage: async () => ({ url: new URL('https://mp.weixin.qq.com/s/example'), html: '<div id="js_content"><p>正文</p></div>' }),
      runTextTask: async () => ({ content: '{"schemaVersion":1,"css":"position:fixed"}' }),
    }),
    (error) => error.code === 'LAYOUT_TEMPLATE_RULES_INVALID',
  );
  assert.equal(writes, 0);
  assert.equal(typeof store.create, 'function');
});

test('自定义模板更新会创建递增的不可变版本并切换当前版本', async () => {
  const statements = [];
  const client = { async query(sql, values) {
    statements.push({ sql, values });
    if (sql.includes('FOR UPDATE')) return { rows: [templateRow()], rowCount: 1 };
    if (sql.includes('max(version_number)')) return { rows: [{ next_version: 2 }], rowCount: 1 };
    if (sql.includes('INSERT INTO wechat_layout_template_versions')) return { rows: [templateRow({ version_id: '33333333-3333-4333-8333-333333333333', version_number: 2, rules_json: JSON.parse(values[4]) })], rowCount: 1 };
    if (sql.includes('UPDATE wechat_layout_templates')) return { rows: [templateRow({ name: values[2], current_version_id: values[3], version_id: values[3], version_number: 2, rules_json: DEFAULT_WECHAT_LAYOUT_RULES })], rowCount: 1 };
    throw new Error(`未处理 SQL: ${sql}`);
  } };
  const store = createWechatLayoutTemplateStore({ query: async () => { throw new Error('更新必须处于事务内'); }, transaction: (callback) => callback(client) });
  const updated = await store.update(WORKSPACE_ID, TEMPLATE_ID, { name: '新版模板', rules: DEFAULT_WECHAT_LAYOUT_RULES, userId: USER_ID });

  assert.equal(updated.name, '新版模板');
  assert.equal(updated.version.versionNumber, 2);
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO wechat_layout_template_versions')));
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE wechat_layout_templates')));
});

test('被草稿或历史版本引用的模板不能删除', async () => {
  const client = { async query(sql) {
    if (sql.includes('FOR UPDATE')) return { rows: [templateRow()], rowCount: 1 };
    if (sql.includes('content_drafts')) return { rows: [{ count: 1 }], rowCount: 1 };
    throw new Error(`引用检查后不应继续: ${sql}`);
  } };
  const store = createWechatLayoutTemplateStore({ query: async () => {}, transaction: (callback) => callback(client) });
  await assert.rejects(
    () => store.remove(WORKSPACE_ID, TEMPLATE_ID),
    (error) => error.code === 'LAYOUT_TEMPLATE_IN_USE' && error.statusCode === 409,
  );
});

test('模板路由导入成功后才创建模板并记录模型用量', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    put(path, options, handler) { routes.set(`PUT ${path}`, { options, handler }); },
    delete(path, options, handler) { routes.set(`DELETE ${path}`, { options, handler }); },
  };
  const created = [];
  const usages = [];
  registerWechatLayoutTemplateRoutes(app, {
    workspaceAccess: { forRole: (role) => role },
    templateStore: {
      list: async () => [],
      create: async (...args) => { created.push(args); return { id: TEMPLATE_ID }; },
      update: async () => ({}),
      remove: async () => {},
    },
    resolveTaskRoute: async () => ({ scope: 'WECHAT_TEMPLATE_ANALYSIS', provider: 'BAILIAN_CLI', model: 'qwen-max', promptVersion: 'wechat-layout-analysis:1' }),
    analyzeTemplateSource: async () => ({ rules: DEFAULT_WECHAT_LAYOUT_RULES, sourceUrl: 'https://mp.weixin.qq.com/s/example', sourceFingerprint: 'a'.repeat(64), promptVersion: 'wechat-layout-analysis:1', usage: { inputTokens: 10, outputTokens: 20 } }),
    runTextTask: async () => { throw new Error('分析器已注入，不应直接运行'); },
    recordUsage: async (entry) => { usages.push(entry); },
    transaction: (callback) => callback({}),
  });
  const route = routes.get('POST /api/v1/wechat-layout-templates/import');
  const reply = { statusCode: 200, code(value) { this.statusCode = value; return this; }, send(value) { this.payload = value; return value; } };
  await route.handler({ workspace: { id: WORKSPACE_ID }, user: { sub: USER_ID }, body: { name: '授权模板', url: 'https://mp.weixin.qq.com/s/example', confirmedRights: true } }, reply);

  assert.equal(route.options.preHandler, 'EDITOR');
  assert.equal(reply.statusCode, 201);
  assert.equal(created.length, 1);
  assert.equal(created[0][2].sourceType, 'WECHAT_URL');
  assert.equal(usages[0].status, 'SUCCESS');
  assert.equal(usages[0].operation, 'WECHAT_TEMPLATE_ANALYSIS');
});

test('模板创建与成功用量日志属于同一事务，日志失败不会留下模板', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    put(path, options, handler) { routes.set(`PUT ${path}`, { options, handler }); },
    delete(path, options, handler) { routes.set(`DELETE ${path}`, { options, handler }); },
  };
  const committed = [];
  registerWechatLayoutTemplateRoutes(app, {
    workspaceAccess: { forRole: (role) => role },
    transaction: async (callback) => {
      const client = { staged: [] };
      const result = await callback(client);
      committed.push(...client.staged);
      return result;
    },
    templateStore: {
      list: async () => [],
      create: async (workspaceId, templateName, input, client) => {
        if (client) client.staged.push({ workspaceId, templateName, input });
        else committed.push({ workspaceId, templateName, input });
        return { id: TEMPLATE_ID };
      },
      update: async () => ({}),
      remove: async () => {},
    },
    resolveTaskRoute: async () => ({ provider: 'BAILIAN_CLI', model: 'qwen-max' }),
    analyzeTemplateSource: async () => ({ rules: DEFAULT_WECHAT_LAYOUT_RULES, sourceUrl: 'https://mp.weixin.qq.com/s/example', sourceFingerprint: 'a'.repeat(64), promptVersion: 'wechat-layout-analysis:1', usage: {} }),
    runTextTask: async () => { throw new Error('分析器已注入，不应直接运行'); },
    recordUsage: async () => { throw new Error('usage write failed'); },
  });
  const route = routes.get('POST /api/v1/wechat-layout-templates/import');
  await assert.rejects(
    () => route.handler({ workspace: { id: WORKSPACE_ID }, user: { sub: USER_ID }, body: { name: '授权模板', url: 'https://mp.weixin.qq.com/s/example', confirmedRights: true } }, { code() { return this; }, send() {} }),
    /usage write failed/,
  );
  assert.deepEqual(committed, []);
});
