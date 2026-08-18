import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createPublishingStore } from '../server/services/publishing.cjs';

test('发布数据底座包含文章、指标快照和复盘记录', async () => {
  const migration = await readFile(new URL('../server/migrations/035_publishing_metrics.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE publications/);
  assert.match(migration, /CREATE TABLE metric_snapshots/);
  assert.match(migration, /CREATE TABLE retrospectives/);
  assert.match(migration, /publication_id uuid NOT NULL/);
});

test('发布路由提供账号、发布包、手动确认和数据复盘接口', async () => {
  const routes = await readFile(new URL('../server/routes/publishing.cjs', import.meta.url), 'utf8');
  assert.match(routes, /GET'?,? '\/api\/v1\/channel-accounts|\/api\/v1\/channel-accounts/);
  assert.match(routes, /\/api\/v1\/publishing\/ready-drafts/);
  assert.match(routes, /\/api\/v1\/publishing\/packages/);
  assert.match(routes, /manual-confirm/);
  assert.match(routes, /\/metrics/);
  assert.match(routes, /metrics\/sync-all/);
  assert.match(routes, /retrospective/);
});

test('发布页不再使用模拟日历和外部封面图', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /webPublishing\.readyDrafts/);
  assert.match(main, /生成发布包|鐢熸垚鍙戝竷鍖?/);
  assert.match(main, /数据跟进|鏁版嵁璺熻繘/);
  assert.doesNotMatch(main, /images\.unsplash\.com/);
  assert.doesNotMatch(main, /calendar-grid/);
});

test('发布页空状态直接给添加账号和回创作入口', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /onOpenAccountSettings/);
  assert.match(main, /publish-guide/);
  assert.match(main, /去添加账号/);
  assert.match(main, /还没有完成版本/);
  assert.match(main, /回到创作/);
});

test('发布包给公众号后台粘贴所需的复制按钮和步骤', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /新的创作 > 文章/);
  assert.match(main, /复制标题/);
  assert.match(main, /复制富文本正文/);
  assert.match(main, /复制图片清单/);
  assert.match(main, /HTML 备份/);
});

test('发布页提供公众号后台快捷入口和自动草稿箱接入提示', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /https:\/\/mp\.weixin\.qq\.com\/cgi-bin\/appmsg/);
  assert.match(main, /打开公众号后台/);
  assert.match(main, /查看公众号草稿箱/);
  assert.match(main, /latestOfficialDraftTask/);
  assert.match(main, /自动导入草稿箱/);
  assert.match(main, /官方接口账号/);
});

test('发布包复制正文时不再直接插入私有图片 src', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /packageClipboardHtml/);
  assert.match(main, /data-image-placeholder/);
  assert.match(main, /请在此处粘贴/);
  assert.match(main, /复制图片/);
  assert.match(main, /下载图片/);
  assert.doesNotMatch(main, /copyRichHtml\(packageResult\)/);
});

test('账号授权页支持添加手动账号并提示官方接口占位', async () => {
  const settings = await readFile(new URL('../src/workspaces/settings/AccountAuthorizationSettings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /webChannelAccounts\.create/);
  assert.match(settings, /MANUAL/);
  assert.match(settings, /OFFICIAL/);
  assert.match(settings, /官方接口|瀹樻柟鎺ュ彛/);
});

test('手动发布账号表单说明无需微信授权或 AppID', async () => {
  const settings = await readFile(new URL('../src/workspaces/settings/AccountAuthorizationSettings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /不需要微信扫码/);
  assert.match(settings, /不知道就留空/);
  assert.match(settings, /保存手动账号/);
  assert.match(settings, /这不是微信官方绑定/);
});

test('账号设置页说明官方接口自动草稿箱所需配置', async () => {
  const settings = await readFile(new URL('../src/workspaces/settings/AccountAuthorizationSettings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /官方接口（自动草稿箱）/);
  assert.match(settings, /AppID\/AppSecret/);
  assert.match(settings, /IP 白名单/);
  assert.match(settings, /新增草稿/);
});

test('官方接口支持保存凭据、测试连接和一键导入草稿箱', async () => {
  const [routes, api, main, settings, service] = await Promise.all([
    readFile(new URL('../server/routes/publishing.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/data/webApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/workspaces/settings/AccountAuthorizationSettings.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../server/services/publishing.cjs', import.meta.url), 'utf8'),
  ]);
  assert.match(routes, /official-credential/);
  assert.match(routes, /official-drafts/);
  assert.match(routes, /metrics\/sync-all/);
  assert.match(api, /saveOfficialCredential/);
  assert.match(api, /createOfficialDraft/);
  assert.match(api, /syncAllMetrics/);
  assert.match(main, /一键导入公众号草稿箱/);
  assert.match(settings, /AppSecret/);
  assert.match(settings, /测试连接/);
  assert.match(service, /createOfficialDraft/);
  assert.match(service, /saveOfficialCredential/);
});

test('发布数据管理可按文章读取历史指标快照', async () => {
  const calls = [];
  const store = createPublishingStore({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [
        {
          id: 'metric-2',
          workspace_id: 'workspace-1',
          publication_id: 'publication-1',
          captured_at: '2026-08-05T10:00:00.000Z',
          source: 'MANUAL',
          read_count: 1300,
          like_count: 88,
          share_count: 19,
          favorite_count: 34,
          comment_count: 7,
          follower_delta: 11,
          created_at: '2026-08-05T10:01:00.000Z',
        },
        {
          id: 'metric-1',
          workspace_id: 'workspace-1',
          publication_id: 'publication-1',
          captured_at: '2026-08-04T10:00:00.000Z',
          source: 'MANUAL',
          read_count: 900,
          like_count: 53,
          share_count: 12,
          favorite_count: 20,
          comment_count: 3,
          follower_delta: 6,
          created_at: '2026-08-04T10:01:00.000Z',
        },
      ] };
    },
    transaction: async () => { throw new Error('读取指标历史不应开启事务'); },
  });

  const metrics = await store.listMetricSnapshots('workspace-1', 'publication-1');

  assert.deepEqual(metrics.map((metric) => [metric.id, metric.readCount, metric.followerDelta]), [
    ['metric-2', 1300, 11],
    ['metric-1', 900, 6],
  ]);
  assert.deepEqual(calls[0].values, ['workspace-1', 'publication-1']);
  assert.match(calls[0].sql, /ORDER BY captured_at DESC/);
});

test('瀹樻柟鏁版嵁鍚屾鎸夋枃绔犳爣棰樺敮涓€鍖归厤锛屽苟淇濆瓨 D 鑺傜偣鍘嗗彶蹇収', async () => {
  const calls = [];
  const store = createPublishingStore({
    decryptSecret: () => JSON.stringify({ appId: 'wx123456', appSecret: 'secret123456' }),
    officialDraftClient: {
      articleSummary: async () => [{ title: '娴嬭瘯鏂囩珷', int_page_read_count: 240, int_page_read_user: 180, like_count: 12, share_count: 4, add_to_fav_count: 3 }],
    },
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT encrypted_secret')) return { rows: [{ encrypted_secret: 'encrypted' }] };
      if (sql.includes('SELECT publication.*, account.mode')) return { rows: [{ id: 'publication-1', title: '娴嬭瘯鏂囩珷', account_id: 'account-1', platform: 'WECHAT', mode: 'OFFICIAL' }] };
      if (sql.includes('INSERT INTO metric_snapshots')) return { rows: [{ id: 'metric-1', workspace_id: 'workspace-1', publication_id: 'publication-1', captured_at: '2026-08-08T10:00:00.000Z', source: 'OFFICIAL_API', checkpoint: 'D1', exposure_count: null, read_count: 240, play_count: null, like_count: 12, share_count: 4, favorite_count: 3, comment_count: null, follower_delta: null, created_at: '2026-08-08T10:00:01.000Z' }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    transaction: async () => undefined,
  });

  const metric = await store.syncOfficialMetrics('workspace-1', 'user-1', 'publication-1', { dataDate: '2026-08-07', checkpoint: 'D1' });
  assert.equal(metric.checkpoint, 'D1');
  assert.equal(metric.exposureCount, null);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO metric_snapshots'));
  assert.equal(insert.values[5], 'D1');
  assert.equal(insert.values[6], null);
  assert.equal(insert.values[7], 240);
});

test('瀹樻柟鏁版嵁鍚屾鎷掔粷鍚屽悕鏂囩珷鐨勬ā绯婂啓鍏?', async () => {
  const store = createPublishingStore({
    decryptSecret: () => JSON.stringify({ appId: 'wx123456', appSecret: 'secret123456' }),
    officialDraftClient: { articleSummary: async () => [{ title: '娴嬭瘯鏂囩珷' }, { title: '娴嬭瘯鏂囩珷' }] },
    query: async (sql) => {
      if (sql.includes('SELECT encrypted_secret')) return { rows: [{ encrypted_secret: 'encrypted' }] };
      if (sql.includes('SELECT publication.*, account.mode')) return { rows: [{ id: 'publication-1', title: '娴嬭瘯鏂囩珷', account_id: 'account-1', platform: 'WECHAT', mode: 'OFFICIAL' }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    transaction: async () => undefined,
  });

  await assert.rejects(
    () => store.syncOfficialMetrics('workspace-1', 'user-1', 'publication-1', { dataDate: '2026-08-07', checkpoint: 'D3' }),
    (error) => error.code === 'WECHAT_METRICS_ARTICLE_AMBIGUOUS' && error.statusCode === 409,
  );
});

test('metric ledger keeps business data date separate from capture timestamp', async () => {
  const migration = await readFile(new URL('../server/migrations/038_metric_snapshot_data_date.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN data_date date/);
  assert.match(migration, /captured_at::date/);
  assert.match(migration, /data_date DESC/);
});

test('独立登记以真实公开链接创建文章台账，不要求本地发布任务或草稿版本', async () => {
  const store = createPublishingStore({
    clipPublicLink: async () => ({ title: '真实发布标题', publishedAt: '2026-08-08T10:00:00.000Z' }),
    query: async () => ({ rows: [] }),
    transaction: async (run) => run({ query: async (sql) => {
      if (sql.includes('SELECT * FROM channel_accounts')) return { rows: [{ id: 'account-1', platform: 'WECHAT', name: '公众号', status: 'CONNECTED' }] };
      if (sql.includes('INSERT INTO publications')) return { rows: [{ id: 'publication-1', workspace_id: 'workspace-1', task_id: null, account_id: 'account-1', draft_version_id: null, platform: 'WECHAT', title: '真实发布标题', url: 'https://mp.weixin.qq.com/s/example', status: 'PUBLISHED', published_at: '2026-08-08T10:00:00.000Z', created_at: '2026-08-08T10:00:00.000Z', updated_at: '2026-08-08T10:00:00.000Z' }] };
      throw new Error(`unexpected query: ${sql}`);
    } }),
  });
  const result = await store.registerStandalonePublication('workspace-1', 'user-1', { url: 'https://mp.weixin.qq.com/s/example', accountId: 'account-1' });
  assert.equal(result.publication.taskId, null);
  assert.equal(result.publication.draftVersionId, null);
  assert.equal(result.publication.title, '真实发布标题');
});

test('发布和复盘页面不因旧接口缺少采集节点而白屏', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /selectedPublicationSchedule = selectedPublication\?\.metricSchedule \?\? \[\]/);
  assert.match(main, /\(article\.metricSchedule \?\? \[\]\)\.map/);
});
