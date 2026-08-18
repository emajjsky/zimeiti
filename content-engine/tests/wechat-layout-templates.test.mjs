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

test('公众号模板分析把 DOM 信号和页面截图放进同一次 Omni 调用', async () => {
  let omniInput;
  const result = await analyzeWechatTemplateSource({
    url: 'https://mp.weixin.qq.com/s/example',
    confirmedRights: true,
    route: { scope: 'WECHAT_TEMPLATE_ANALYSIS', provider: 'BAILIAN_CLI', model: 'qwen3.8-max' },
    capturePage: async (_url, screenshotPath) => ({
      url: new URL('https://mp.weixin.qq.com/s/example'),
      html: '<div id="js_content"><h2 style="color:#3366ff">标题</h2><p>正文</p></div>',
      screenshotPath,
    }),
    runOmniTask: async (input) => {
      omniInput = input;
      return { content: JSON.stringify({ rules: DEFAULT_WECHAT_LAYOUT_RULES }) };
    },
  });

  assert.match(omniInput.message, /headingCount/);
  assert.deepEqual(omniInput.richContent.media.map(({ kind, label }) => [kind, label]), [
    ['IMAGE', '公众号文章完整页面截图'],
  ]);
  assert.match(omniInput.richContent.media[0].source, /page\.png$/);
  assert.equal(result.rules.schemaVersion, 1);
});

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

test('renderer outputs structural layout variants for titles, toc, tags, lists and links', () => {
  const rules = normalizeWechatLayoutRules({
    ...DEFAULT_WECHAT_LAYOUT_RULES,
    layout: {
      ...DEFAULT_WECHAT_LAYOUT_RULES.layout,
      titleVariant: 'news',
      headingVariant: 'shadow-card',
      tocVariant: 'card',
      listVariant: 'check',
      linkVariant: 'pill',
      tagVariant: 'mono',
      paragraphVariant: 'rail',
      inlineVariant: 'dual',
    },
  });
  const result = renderWechatDraft({
    title: 'AI Tool Evaluation',
    body: '## Setup\n\nIntro paragraph with [source](https://example.com/a), `claude-opus-5` and ==red flag==.\n\n## Metrics\n\n- **Output length:** 1200 words\n- **Latency:** 3 minutes\n\n## Decision\n\nhttps://example.com/b',
    assets: [],
    templateRules: rules,
  });

  assert.match(result.html, /<header[^>]*><h1/);
  assert.match(result.html, /<nav aria-label=/);
  assert.match(result.html, /#Setup/);
  assert.match(result.html, /box-shadow:0 8px 18px/);
  assert.match(result.html, /grid-template-columns:18px minmax\(0,1fr\)/);
  assert.match(result.html, /<strong style=/);
  assert.match(result.html, /<code style=/);
  assert.match(result.html, /<mark style=/);
  assert.match(result.html, /#4f68a8/);
  assert.match(result.html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(result.html, /border-radius:999px;color:/);
  assert.match(result.html, /border-left:2px solid/);
});

test('renderer applies branded intro and outro addons across preview and final HTML', () => {
  const rules = normalizeWechatLayoutRules({
    ...DEFAULT_WECHAT_LAYOUT_RULES,
    canvas: { ...DEFAULT_WECHAT_LAYOUT_RULES.canvas, background: '#fff8ed', textColor: '#2d241f' },
    title: { ...DEFAULT_WECHAT_LAYOUT_RULES.title, color: '#4a2411' },
    heading: { ...DEFAULT_WECHAT_LAYOUT_RULES.heading, borderColor: '#c87533' },
    quote: { ...DEFAULT_WECHAT_LAYOUT_RULES.quote, background: '#fff1dc' },
  });
  const result = renderWechatDraft({
    title: 'Brand Voice',
    body: '## Main Point\n\nBody copy with ==accent==.',
    assets: [],
    templateRules: rules,
    layoutAddons: {
      intro: { enabled: true, label: '二师兄说', title: '<开场>', body: '一句带 `code` 的开头' },
      outro: { enabled: true, label: '收个尾', title: '下期见', body: '关注后续 ==重点==。' },
    },
  });

  assert.match(result.html, /data-layout-addon="intro"/);
  assert.match(result.html, /data-layout-addon="outro"/);
  assert.match(result.html, /二师兄说/);
  assert.match(result.html, /&lt;开场&gt;/);
  assert.match(result.html, /一句带 <code style=/);
  assert.match(result.html, /收个尾/);
  assert.match(result.html, /下期见/);
  assert.match(result.html, /#c87533/);
  assert.match(result.html, /#fff1dc/);
  assert.match(result.html, /<mark style=/);
});

test('renderer reproduces numbered case card paragraph layout', () => {
  const rules = normalizeWechatLayoutRules({
    ...DEFAULT_WECHAT_LAYOUT_RULES,
    heading: { ...DEFAULT_WECHAT_LAYOUT_RULES.heading, color: '#5b7ee5', borderColor: '#5b7ee5' },
    divider: { ...DEFAULT_WECHAT_LAYOUT_RULES.divider, color: '#5b7ee5' },
    layout: { ...DEFAULT_WECHAT_LAYOUT_RULES.layout, paragraphVariant: 'case-card' },
  });
  const result = renderWechatDraft({
    title: '案例公布',
    body: '导语段落。\n\n第一个案例正文。\n\n第二个案例正文。',
    assets: [],
    templateRules: rules,
  });

  assert.match(result.html, /data-layout-case-card="1"/);
  assert.match(result.html, /data-layout-case-card="2"/);
  assert.match(result.html, /border:1px solid #5b7ee5/);
  assert.match(result.html, /background:#f6c23e/);
  assert.match(result.html, />1<\/span>/);
  assert.match(result.html, />2<\/span>/);
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
    layout: undefined,
    title: { ...DEFAULT_WECHAT_LAYOUT_RULES.title, fontSize: 500 },
    image: { ...DEFAULT_WECHAT_LAYOUT_RULES.image, borderRadius: -30 },
  });
  assert.equal(normalized.title.fontSize, 48);
  assert.equal(normalized.image.borderRadius, 0);
  assert.equal(normalized.layout.titleVariant, 'plain');
  assert.throws(
    () => normalizeWechatLayoutRules({ ...DEFAULT_WECHAT_LAYOUT_RULES, layout: { ...DEFAULT_WECHAT_LAYOUT_RULES.layout, titleVariant: 'free-css' } }),
    (error) => error.code === 'LAYOUT_TEMPLATE_RULES_INVALID',
  );
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

test('模板分析将页面读取失败转换为稳定业务错误', async () => {
  await assert.rejects(
    () => analyzeWechatTemplateSource({
      url: 'https://mp.weixin.qq.com/s/example',
      confirmedRights: true,
      route: { scope: 'WECHAT_TEMPLATE_ANALYSIS', provider: 'BAILIAN_CLI', model: 'qwen' },
      runTextTask: async () => { throw new Error('model must not run after page read failure'); },
      fetchPublicPage: async () => { throw new Error('HTTP 403'); },
    }),
    (error) => error.code === 'LAYOUT_TEMPLATE_SOURCE_UNREADABLE'
      && error.statusCode === 422,
  );
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

test('链接导入会安全修正模型输出里的额外字段和布局别名', async () => {
  const result = await analyzeWechatTemplateSource({
    url: 'https://mp.weixin.qq.com/s/example',
    confirmedRights: true,
    route: { provider: 'BAILIAN_CLI', model: 'qwen-max' },
    fetchPublicPage: async () => ({ url: new URL('https://mp.weixin.qq.com/s/example'), html: '<div id="js_content"><section style="color:#0f172a;background:#f8fafc"><p>正文</p></section></div>' }),
    runTextTask: async () => ({
      content: JSON.stringify({
        rules: {
          schemaVersion: 1,
          canvas: { background: '#fff', textColor: '#0F172A', maxWidth: 900, css: 'display:none' },
          title: { ...DEFAULT_WECHAT_LAYOUT_RULES.title, color: '#111827', customCss: 'position:fixed' },
          layout: {
            titleVariant: 'minimal',
            headingVariant: 'number',
            imageVariant: 'dropShadow',
            quoteVariant: 'callout',
            dividerVariant: 'dotted',
            leadVariant: 'dropcap',
            tocVariant: 'catalog',
            listVariant: 'emphasis',
            linkVariant: 'blue',
            tagVariant: 'hashtags',
            metaVariant: 'badges',
            paragraphVariant: 'report',
            inlineVariant: 'twoTone',
            css: 'bad',
          },
          customCss: '.x{display:none}',
        },
      }),
    }),
  });
  assert.equal(result.rules.canvas.background, DEFAULT_WECHAT_LAYOUT_RULES.canvas.background);
  assert.equal(result.rules.canvas.textColor, '#0f172a');
  assert.equal(result.rules.canvas.maxWidth, 677);
  assert.equal(result.rules.layout.titleVariant, 'plain');
  assert.equal(result.rules.layout.headingVariant, 'numbered');
  assert.equal(result.rules.layout.imageVariant, 'shadow');
  assert.equal(result.rules.layout.quoteVariant, 'card');
  assert.equal(result.rules.layout.dividerVariant, 'dots');
  assert.equal(result.rules.layout.leadVariant, 'kicker');
  assert.equal(result.rules.layout.tocVariant, 'card');
  assert.equal(result.rules.layout.listVariant, 'bold');
  assert.equal(result.rules.layout.linkVariant, 'accent');
  assert.equal(result.rules.layout.tagVariant, 'mono');
  assert.equal(result.rules.layout.metaVariant, 'chips');
  assert.equal(result.rules.layout.paragraphVariant, 'report');
  assert.equal(result.rules.layout.inlineVariant, 'dual');
});

test('imported layout refines structural signals into distinct template variants', async () => {
  let modelInput;
  const html = `<div id="js_content">
    <section style="box-shadow:0 8px 18px rgba(0,0,0,.12);border-left:4px solid #ff4d2e"><h2>Opening</h2></section>
    <section style="box-shadow:0 8px 18px rgba(0,0,0,.12);border-left:4px solid #ff4d2e"><h2>Checklist</h2></section>
    <section><h2>Links</h2><p><a href="https://example.com/a">A</a><a href="https://example.com/b">B</a></p></section>
    <ul><li>Output length</li><li>Latency</li><li>Evidence</li><li>Decision</li></ul>
  </div>`;
  const result = await analyzeWechatTemplateSource({
    url: 'https://mp.weixin.qq.com/s/example',
    confirmedRights: true,
    route: { provider: 'BAILIAN_CLI', model: 'qwen-max' },
    fetchPublicPage: async () => ({ url: new URL('https://mp.weixin.qq.com/s/example'), html }),
    runTextTask: async (input) => {
      modelInput = input;
      return { content: JSON.stringify({ rules: DEFAULT_WECHAT_LAYOUT_RULES }) };
    },
  });

  assert.match(modelInput.message, /shadowCount/);
  assert.match(modelInput.message, /listItemCount/);
  assert.match(modelInput.message, /linkCount/);
  assert.equal(result.rules.layout.headingVariant, 'shadow-card');
  assert.equal(result.rules.layout.tocVariant, 'card');
  assert.equal(result.rules.layout.listVariant, 'bold');
  assert.equal(result.rules.layout.linkVariant, 'accent');
  assert.equal(result.rules.layout.tagVariant, 'chips');
  assert.equal(result.rules.layout.paragraphVariant, 'rail');
  assert.equal(result.rules.layout.inlineVariant, 'dual');
  assert.equal(result.rules.heading.borderColor, '#ff4d2e');
});

test('imported layout recognizes repeated numbered case cards', async () => {
  let modelInput;
  const caseSection = (index) => `<section style="position:relative;margin:42px 0 30px;padding:32px 24px 22px;border:1px solid #5b7ee5;border-radius:10px;background:#ffffff">
    <span style="position:absolute;left:36px;top:-32px;color:#5b7ee5;font-size:46px;font-weight:900">${index}</span>
    <span style="position:absolute;left:36px;top:-5px;width:9px;height:9px;border-radius:50%;background:#f6c23e"></span>
    <span style="position:absolute;left:132px;right:14px;top:-1px;height:1px;background:#5b7ee5"></span>
    <p>案例 ${index} 的说明文字。</p>
  </section>`;
  const html = `<div id="js_content">
    <p>导语段落。</p>
    ${[1, 2, 3, 4].map(caseSection).join('')}
  </div>`;
  const result = await analyzeWechatTemplateSource({
    url: 'https://mp.weixin.qq.com/s/example',
    confirmedRights: true,
    route: { provider: 'BAILIAN_CLI', model: 'qwen-max' },
    fetchPublicPage: async () => ({ url: new URL('https://mp.weixin.qq.com/s/example'), html }),
    runTextTask: async (input) => {
      modelInput = input;
      return { content: JSON.stringify({ rules: DEFAULT_WECHAT_LAYOUT_RULES }) };
    },
  });

  assert.match(modelInput.message, /caseCardCount/);
  assert.equal(result.rules.layout.paragraphVariant, 'case-card');
  assert.equal(result.rules.heading.borderColor, '#5b7ee5');
  assert.equal(result.rules.heading.color, '#5b7ee5');
  assert.equal(result.rules.divider.color, '#5b7ee5');
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
  assert.equal(updated.currentVersionNumber, 2);
  assert.deepEqual(updated.rules, DEFAULT_WECHAT_LAYOUT_RULES);
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

test('被草稿引用的模板不能归档', async () => {
  const client = { async query(sql) {
    if (sql.includes('FOR UPDATE')) return { rows: [templateRow()], rowCount: 1 };
    if (sql.includes('content_drafts')) return { rows: [{ count: 1 }], rowCount: 1 };
    throw new Error(`引用检查后不应继续: ${sql}`);
  } };
  const store = createWechatLayoutTemplateStore({ query: async () => {}, transaction: (callback) => callback(client) });
  await assert.rejects(
    () => store.archive(WORKSPACE_ID, TEMPLATE_ID),
    (error) => error.code === 'LAYOUT_TEMPLATE_IN_USE' && error.statusCode === 409,
  );
});

test('模板路由导入成功后才创建模板并记录模型用量', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    patch(path, options, handler) { routes.set(`PATCH ${path}`, { options, handler }); },
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
      duplicate: async () => ({}),
      archive: async () => {},
      get: async () => templateRow(),
      remove: async () => {},
    },
    draftStore: { get: async () => ({}) },
    renderWechatDraft: () => ({ html: '', checks: [] }),
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

test('模板导入失败时用量记录失败不会覆盖原始分析错误', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    patch(path, options, handler) { routes.set(`PATCH ${path}`, { options, handler }); },
    put(path, options, handler) { routes.set(`PUT ${path}`, { options, handler }); },
    delete(path, options, handler) { routes.set(`DELETE ${path}`, { options, handler }); },
  };
  const warnings = [];
  registerWechatLayoutTemplateRoutes(app, {
    workspaceAccess: { forRole: (role) => role },
    templateStore: {
      list: async () => [],
      create: async () => { throw new Error('template must not be created'); },
      update: async () => ({}),
      duplicate: async () => ({}),
      archive: async () => {},
      get: async () => templateRow(),
      remove: async () => {},
    },
    draftStore: { get: async () => ({}) },
    renderWechatDraft: () => ({ html: '', checks: [] }),
    resolveTaskRoute: async () => ({ scope: 'WECHAT_TEMPLATE_ANALYSIS', provider: 'BAILIAN_CLI', model: 'qwen-max' }),
    analyzeTemplateSource: async () => {
      const error = new Error('公众号文章链接暂时无法读取，请确认链接公开且仍然有效。');
      error.statusCode = 422;
      error.code = 'LAYOUT_TEMPLATE_SOURCE_UNREADABLE';
      throw error;
    },
    runTextTask: async () => { throw new Error('analyzer is injected and should not run directly'); },
    recordUsage: async () => { throw new Error('usage write failed'); },
    transaction: (callback) => callback({}),
  });
  const route = routes.get('POST /api/v1/wechat-layout-templates/import');
  await assert.rejects(
    () => route.handler({
      workspace: { id: WORKSPACE_ID },
      user: { sub: USER_ID },
      log: { warn: (...args) => warnings.push(args) },
      body: { name: '授权模板', url: 'https://mp.weixin.qq.com/s/example', confirmedRights: true },
    }, { code() { return this; }, send() {} }),
    (error) => error.code === 'LAYOUT_TEMPLATE_SOURCE_UNREADABLE' && error.statusCode === 422,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][1], /usage recording failed/);
});

test('模板创建与成功用量日志属于同一事务，日志失败不会留下模板', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    patch(path, options, handler) { routes.set(`PATCH ${path}`, { options, handler }); },
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
      duplicate: async () => ({}),
      archive: async () => {},
      get: async () => templateRow(),
      remove: async () => {},
    },
    draftStore: { get: async () => ({}) },
    renderWechatDraft: () => ({ html: '', checks: [] }),
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

test('模板预览读取当前公众号草稿并返回服务端渲染 HTML', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    patch(path, options, handler) { routes.set(`PATCH ${path}`, { options, handler }); },
    put(path, options, handler) { routes.set(`PUT ${path}`, { options, handler }); },
    delete(path, options, handler) { routes.set(`DELETE ${path}`, { options, handler }); },
  };
  const template = { id: TEMPLATE_ID, currentVersionId: VERSION_ID, rules: DEFAULT_WECHAT_LAYOUT_RULES };
  const layoutAddons = { intro: { enabled: true, label: '栏目', title: '开头', body: '固定开场' } };
  const draft = {
    id: '44444444-4444-4444-8444-444444444444',
    platform: 'WECHAT',
    title: '母稿标题',
    body: '母稿正文',
    assets: [asset(0)],
    visualPlan: {
      layoutAddons,
      layoutDesign: { schemaVersion: 1, templateId: '55555555-5555-4555-8555-555555555555', templateVersionId: '55555555-5555-4555-8555-555555555556', blocks: [{ paragraphIndex: 1, role: 'lead', variant: 'callout' }], inlineMarks: [] },
    },
  };
  registerWechatLayoutTemplateRoutes(app, {
    workspaceAccess: { forRole: (role) => role },
    transaction: (callback) => callback({}),
    templateStore: { list: async () => [], create: async () => ({}), update: async () => ({}), duplicate: async () => ({}), archive: async () => {}, remove: async () => {}, get: async () => template },
    draftStore: { get: async () => draft },
    renderWechatDraft: (input) => {
      assert.equal(input.title, draft.title);
      assert.equal(input.templateRules, template.rules);
      assert.deepEqual(input.layoutAddons, layoutAddons);
      assert.equal(input.layoutDesign, undefined);
      return { html: '<article>真实预览</article>', checks: [] };
    },
    resolveTaskRoute: async () => ({}),
    analyzeTemplateSource: async () => ({}),
    runTextTask: async () => ({}),
    recordUsage: async () => {},
  });
  const preview = await routes.get('POST /api/v1/wechat-layout-templates/:templateId/preview').handler({ workspace: { id: WORKSPACE_ID }, params: { templateId: TEMPLATE_ID }, body: { draftId: draft.id } });
  assert.deepEqual(preview, { templateId: TEMPLATE_ID, templateVersionId: VERSION_ID, draftId: draft.id, html: '<article>真实预览</article>', checks: [] });
});

test('智能精排接口调用 WECHAT_LAYOUT_DESIGN 并把结构化标注保存到草稿', async () => {
  const routes = new Map();
  const app = {
    get(path, options, handler) { routes.set(`GET ${path}`, { options, handler }); },
    post(path, options, handler) { routes.set(`POST ${path}`, { options, handler }); },
    patch(path, options, handler) { routes.set(`PATCH ${path}`, { options, handler }); },
    put(path, options, handler) { routes.set(`PUT ${path}`, { options, handler }); },
    delete(path, options, handler) { routes.set(`DELETE ${path}`, { options, handler }); },
  };
  const template = { id: TEMPLATE_ID, currentVersionId: VERSION_ID, rules: DEFAULT_WECHAT_LAYOUT_RULES };
  const draft = {
    id: '44444444-4444-4444-8444-444444444444',
    revision: 7,
    platform: 'WECHAT',
    title: '母稿标题',
    body: '市场越热的时候，越要回到真实价值。\n\n真正值得长期投入的公司，不只要站在技术变化的起点。',
    assets: [asset(0)],
    visualPlan: { layoutAddons: { intro: { enabled: false } } },
  };
  const calls = [];
  registerWechatLayoutTemplateRoutes(app, {
    workspaceAccess: { forRole: (role) => role },
    transaction: (callback) => callback({ staged: [] }),
    templateStore: { list: async () => [template], create: async () => ({}), update: async () => ({}), duplicate: async () => ({}), archive: async () => {}, remove: async () => {}, get: async () => template },
    draftStore: {
      get: async () => draft,
      patchWorkingCopy: async (workspaceId, draftId, input) => {
        calls.push({ workspaceId, draftId, input });
        return { ...draft, revision: 8, visualPlan: input.visualPlan };
      },
    },
    renderWechatDraft: (input) => {
      assert.deepEqual(input.layoutDesign.inlineMarks, [{ text: '真实价值', type: 'strong-accent' }]);
      assert.equal(input.layoutDesign.templateId, TEMPLATE_ID);
      assert.equal(input.layoutDesign.templateVersionId, VERSION_ID);
      return { html: '<article>智能精排预览</article>', checks: [] };
    },
    resolveTaskRoute: async (workspaceId, scope, label) => {
      calls.push({ workspaceId, scope, label });
      return { scope, provider: 'BAILIAN_CLI', connectionId: null, model: 'qwen-max' };
    },
    analyzeTemplateSource: async () => ({}),
    runTextTask: async ({ route, system, message }) => {
      calls.push({ route, system, message });
      return { content: JSON.stringify({ schemaVersion: 1, blocks: [{ paragraphIndex: 1, role: 'lead', variant: 'accent-line' }], inlineMarks: [{ text: '真实价值', type: 'strong-accent' }] }), inputTokens: 12, outputTokens: 24 };
    },
    recordUsage: async (usage) => calls.push({ usage }),
  });
  const result = await routes.get('POST /api/v1/creative/drafts/:draftId/layout/design').handler({
    workspace: { id: WORKSPACE_ID },
    params: { draftId: draft.id },
    body: { templateId: TEMPLATE_ID, instruction: '突出重点判断' },
  });
  assert.equal(calls[0].scope, 'WECHAT_LAYOUT_DESIGN');
  assert.equal(calls[1].route.scope, 'WECHAT_LAYOUT_DESIGN');
  assert.equal(calls[2].input.visualPlan.layoutDesign.inlineMarks[0].text, '真实价值');
  assert.equal(calls[2].input.visualPlan.layoutDesign.templateId, TEMPLATE_ID);
  assert.equal(calls[2].input.visualPlan.layoutDesign.templateVersionId, VERSION_ID);
  assert.equal(result.templateId, TEMPLATE_ID);
  assert.equal(result.templateVersionId, VERSION_ID);
  assert.equal(result.html, '<article>智能精排预览</article>');
  assert.equal(result.policy.scope, 'WECHAT_LAYOUT_DESIGN');
});
