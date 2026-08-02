import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createContentDraftStore, draftView } from '../server/services/content-drafts.cjs';

const NOW = '2026-08-02T00:00:00.000Z';

function draftRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    project_id: 'project-1',
    platform: 'WECHAT',
    status: 'EDITING',
    revision: 3,
    title: '标题',
    body: '正文',
    visual_plan_json: {},
    layout_template_version_id: '22222222-2222-4222-8222-222222222222',
    source_draft_version_id: null,
    source_stale: false,
    current_version_id: null,
    assets_json: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

test('草稿 DTO 是账号无关资源且保持有序素材', () => {
  const draft = draftView(draftRow({
    account_id: '不应暴露',
    assets_json: [{
      id: 'asset-link-1', workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', draft_id: '11111111-1111-4111-8111-111111111111',
      draft_version_id: null, asset_id: 'asset-1', role: 'COVER', sort_order: 0, created_at: NOW,
    }],
  }));
  assert.equal('accountId' in draft, false);
  assert.equal('account_id' in draft, false);
  assert.deepEqual(draft.assets.map(({ assetId, sortOrder }) => [assetId, sortOrder]), [['asset-1', 0]]);
});

test('旧 revision 不能覆盖新页面内容', async () => {
  const calls = [];
  const store = createContentDraftStore({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('UPDATE content_drafts')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT id FROM content_drafts')) return { rows: [{ id: values[1] }], rowCount: 1 };
      throw new Error(`未处理 SQL：${sql}`);
    },
    transaction: async () => { throw new Error('文本修订不应开启额外事务'); },
  });
  await assert.rejects(
    () => store.patchWorkingCopy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', { revision: 2, title: '旧页面', body: '旧正文' }),
    (error) => error.code === 'DRAFT_REVISION_CONFLICT',
  );
  assert.deepEqual(calls[0].values.slice(0, 3), ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 2]);
});

test('派生草稿必须固定引用公众号当前不可变版本', async () => {
  const store = createContentDraftStore({ query: async () => { throw new Error('空来源不应访问数据库'); }, transaction: async () => {} });
  await assert.rejects(
    () => store.createDerivedWorkingCopy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'project-1', 'XIAOHONGSHU', null),
    (error) => error.code === 'DRAFT_SOURCE_VERSION_STALE',
  );
  await assert.rejects(
    () => store.createDerivedWorkingCopy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'project-1', 'WECHAT', 'version-1'),
    (error) => error.code === 'DRAFT_PLATFORM_UNSUPPORTED',
  );
});

test('有序素材替换执行平台图片上限并拒绝重复素材', async () => {
  const draft = draftRow({ platform: 'XIAOHONGSHU' });
  const client = { async query(sql) {
    if (sql.includes('FOR UPDATE')) return { rows: [draft], rowCount: 1 };
    throw new Error(`图片校验失败后不应继续：${sql}`);
  } };
  const store = createContentDraftStore({ query: async () => {}, transaction: (callback) => callback(client) });
  await assert.rejects(
    () => store.replaceWorkingAssets(draft.workspace_id, draft.id, { revision: 3, assets: Array.from({ length: 10 }, (_, index) => ({ assetId: `asset-${index}`, role: 'BODY' })) }),
    (error) => error.code === 'DRAFT_IMAGE_LIMIT_EXCEEDED',
  );
  await assert.rejects(
    () => store.replaceWorkingAssets(draft.workspace_id, draft.id, { revision: 3, assets: [{ assetId: 'asset-1', role: 'BODY' }, { assetId: 'asset-1', role: 'COVER' }] }),
    (error) => error.code === 'DRAFT_ASSET_INVALID',
  );
});

test('完成公众号草稿原子创建不可变版本、冻结素材并标记派生稿过期', async () => {
  const statements = [];
  const draft = draftRow();
  const client = { async query(sql, values) {
    statements.push({ sql, values });
    if (sql.includes('FROM content_drafts draft') && sql.includes('FOR UPDATE')) return { rows: [draft], rowCount: 1 };
    if (sql.includes('FROM content_draft_assets item')) return { rows: [{ asset_id: 'asset-1', role: 'COVER', sort_order: 0 }], rowCount: 1 };
    if (sql.includes('FROM wechat_layout_template_versions')) return { rows: [{ rules_json: { schemaVersion: 1 } }], rowCount: 1 };
    if (sql.includes('max(version_number)')) return { rows: [{ next_version: 1 }], rowCount: 1 };
    if (sql.includes('INSERT INTO content_draft_versions')) return { rows: [{ id: 'version-1', workspace_id: draft.workspace_id, draft_id: draft.id, platform: 'WECHAT', version_number: 1, title: draft.title, body: draft.body, visual_plan_json: {}, rendered_html: '<article>正文</article>', layout_template_version_id: draft.layout_template_version_id, source_draft_version_id: null, generation_run_id: null, created_at: NOW }], rowCount: 1 };
    if (sql.includes('INSERT INTO content_draft_assets')) return { rows: [], rowCount: 1 };
    if (sql.includes("UPDATE content_drafts SET status = 'READY'")) return { rows: [draftRow({ status: 'READY', revision: 4, current_version_id: 'version-1' })], rowCount: 1 };
    if (sql.includes('SET source_stale = true')) return { rows: [], rowCount: 2 };
    throw new Error(`未处理 SQL：${sql}`);
  } };
  const store = createContentDraftStore({
    query: async () => { throw new Error('完成草稿必须留在事务内'); },
    transaction: (callback) => callback(client),
    renderWechatDraft: ({ title, body, assets, templateRules }) => {
      assert.equal(title, draft.title);
      assert.equal(body, draft.body);
      assert.equal(assets.length, 1);
      assert.equal(templateRules.schemaVersion, 1);
      return { html: '<article>正文</article>', checks: [] };
    },
  });
  const completed = await store.complete(draft.workspace_id, draft.id);
  assert.equal(completed.version.id, 'version-1');
  assert.equal(completed.draft.currentVersionId, 'version-1');
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO content_draft_assets')));
  assert.ok(statements.some(({ sql }) => sql.includes('SET source_stale = true')));
});

test('草稿路由使用显式工作空间角色并注册规格中的资源接口', async () => {
  const source = await readFile(new URL('../server/routes/content-drafts.cjs', import.meta.url), 'utf8');
  assert.match(source, /creative\/projects\/:projectId\/drafts[\s\S]*forRole\('VIEWER'\)/);
  assert.match(source, /creative\/projects\/:projectId\/wechat-draft[\s\S]*forRole\('EDITOR'\)/);
  assert.match(source, /content-drafts\/:draftId[\s\S]*forRole\('EDITOR'\)/);
  assert.match(source, /content-drafts\/:draftId\/complete/);
  assert.match(source, /content-drafts\/:draftId\/derive/);
  assert.match(source, /content-drafts\/:draftId\/versions/);
  assert.match(source, /content-drafts\/:draftId\/preview/);
});
