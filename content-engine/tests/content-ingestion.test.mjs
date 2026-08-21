import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createIngestionInput, normalizedTextDocument, normalizedArticleDocument, sourceTypeForUrl, processingKindForAssetKind, createContentIngestionStore, executeContentIngestion, ingestionFailure, projectMaterialForIngestion, readableContentTitle, contentUnderstandingTimeoutMs } from '../server/services/content-ingestions.cjs';
import publicWeb from '../server/services/public-web.cjs';
import contentUnderstanding from '../server/services/content-understanding.cjs';

const { buildContentUnderstandingOmniArgs, parseContentUnderstanding } = contentUnderstanding;

test('内容理解提示词声明唯一输出契约并要求联合分析媒体', () => {
  const prompt = contentUnderstanding.buildContentUnderstandingPrompt({
    title: '示例文章',
    canonicalUrl: 'https://example.com/article',
    plainText: '正文',
  }, [{ kind: 'IMAGE', label: '正文配图' }]);
  assert.match(prompt.system, /只返回一个 JSON 对象/);
  assert.match(prompt.system, /summary.*coreViewpoints.*structureOutline.*reusableElements.*visualClues/s);
  assert.match(prompt.system, /所有数组字段必须是字符串数组/);
  assert.match(prompt.system, /图片和视频中的信息写入 visualClues/);
});

test('内容理解规范化语义等价结构并保留图片与视频理解结果', () => {
  const result = parseContentUnderstanding(JSON.stringify({
    analysis: {
      contentSummary: '文章围绕产品策略和案例展开。',
      viewpoints: [
        { title: '核心判断', explanation: '先验证用户需求，再扩大投入。' },
        '案例比抽象结论更有说服力。',
      ],
      outline: [
        { heading: '问题背景', description: '说明行业变化。' },
        { title: '实践案例', content: '拆解实施过程。' },
      ],
      reusableMaterials: [{ type: '案例', content: '团队用两周完成首轮验证。' }],
      imageAnalysis: [{ description: '流程图展示从需求到验证的四个步骤。' }],
      videoAnalysis: [{ scene: '产品演示', insight: '界面重点展示批量处理能力。' }],
    },
  }));

  assert.equal(result.summary, '文章围绕产品策略和案例展开。');
  assert.deepEqual(result.coreViewpoints, [
    '核心判断：先验证用户需求，再扩大投入。',
    '案例比抽象结论更有说服力。',
  ]);
  assert.deepEqual(result.structureOutline, [
    '问题背景：说明行业变化。',
    '实践案例：拆解实施过程。',
  ]);
  assert.deepEqual(result.reusableElements, ['案例：团队用两周完成首轮验证。']);
  assert.deepEqual(result.visualClues, [
    '图片：流程图展示从需求到验证的四个步骤。',
    '视频：产品演示：界面重点展示批量处理能力。',
  ]);
});

test('内容理解从模型说明文字中提取唯一 JSON 对象', () => {
  const result = parseContentUnderstanding(`分析结果如下：
\`\`\`json
{"summary":"有效摘要","coreViewpoints":[],"structureOutline":[],"reusableElements":[],"visualClues":[]}
\`\`\`
以上为结构化结果。`);
  assert.equal(result.summary, '有效摘要');
});

test('内容理解缺少必要摘要时返回稳定错误码和字段路径', () => {
  assert.throws(
    () => parseContentUnderstanding(JSON.stringify({ coreViewpoints: ['观点'], structureOutline: [] })),
    (error) => error instanceof Error
      && error.code === 'MODEL_OUTPUT_INVALID'
      && error.message === '内容理解结果缺少有效摘要，请重新读取内容。'
      && error.fieldPaths?.includes('summary'),
  );
});

test('内容理解适配模型返回的丰富观点，不因超过提示数量而整单失败', () => {
  const result = parseContentUnderstanding(JSON.stringify({
    summary: '完整摘要',
    coreViewpoints: Array.from({ length: 9 }, (_, index) => `观点 ${index + 1}`),
    structureOutline: Array.from({ length: 15 }, (_, index) => ({ title: `章节 ${index + 1}`, summary: `内容 ${index + 1}` })),
    reusableElements: Array.from({ length: 14 }, (_, index) => `素材 ${index + 1}`),
    visualClues: Array.from({ length: 13 }, (_, index) => `画面 ${index + 1}`),
  }));
  assert.equal(result.coreViewpoints.length, 9);
  assert.equal(result.structureOutline.length, 15);
  assert.equal(result.structureOutline[0], '章节 1：内容 1');
  assert.equal(result.reusableElements.length, 14);
  assert.equal(result.visualClues.length, 13);
});

test('内容理解解析失败时返回可读业务错误而不是 Zod 内部数组', () => {
  assert.throws(
    () => parseContentUnderstanding(JSON.stringify({ summary: '摘要', coreViewpoints: '错误类型', structureOutline: [], reusableElements: [], visualClues: [] })),
    (error) => error instanceof Error
      && error.code === 'MODEL_OUTPUT_INVALID'
      && error.message === '内容理解结果中的 coreViewpoints 不是有效列表，请重新读取内容。'
      && error.fieldPaths?.includes('coreViewpoints'),
  );
});

test('内容摄取迁移使用现有 jobs、项目和空间素材边界', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/043_content_ingestions.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE content_ingestions/);
  assert.match(migration, /job_id uuid REFERENCES jobs\(id\)/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, project_id\) REFERENCES content_projects\(workspace_id, project_id\)/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, source_asset_id\) REFERENCES workspace_assets\(workspace_id, id\)/);
  assert.doesNotMatch(migration, /CREATE TABLE content_projects/);
  assert.doesNotMatch(migration, /CREATE TABLE workspace_assets/);
  const processingMigration = fs.readFileSync(new URL('../server/migrations/044_content_ingestion_processing_kind.sql', import.meta.url), 'utf8');
  assert.match(processingMigration, /processing_kind/);
});

test('公开来源按域名归一为来源类型', () => {
  assert.equal(sourceTypeForUrl('https://mp.weixin.qq.com/s/abc'), 'WECHAT');
  assert.equal(sourceTypeForUrl('https://zhuanlan.zhihu.com/p/1'), 'ZHIHU');
  assert.equal(sourceTypeForUrl('https://x.com/example/status/1'), 'X');
  assert.equal(sourceTypeForUrl('https://news.example.com/a'), 'GENERIC_WEB');
});

test('摄取输入区分作者内容和外部参考，不接受空文本', () => {
  const input = createIngestionInput({ input: { kind: 'TEXT', text: '我的大纲\n\n第一部分', maturity: 'OUTLINE' }, intent: 'AUTHOR_CONTENT', usage: [] });
  assert.equal(input.input.kind, 'TEXT');
  assert.equal(input.input.maturity, 'OUTLINE');
  assert.equal(input.intent, 'AUTHOR_CONTENT');
  assert.throws(() => createIngestionInput({ input: { kind: 'TEXT', text: ' ' }, intent: 'REFERENCE' }), (error) => error.code === 'INGESTION_INPUT_INVALID');
});

test('规范化文本保留可重建的 block、哈希和来源元数据', () => {
  const document = normalizedTextDocument({ title: '标题', text: '第一段\n\n第二段', adapter: 'GENERIC_ARTICLE', canonicalUrl: 'https://example.com/a' });
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0].type, 'paragraph');
  assert.equal(document.canonicalUrl, 'https://example.com/a');
  assert.equal(document.extraction.contentHash.length, 64);
});

test('内部哈希和 UUID 文件名永远不会成为业务标题', () => {
  assert.equal(readableContentTitle('4542fa45a68c50d9b76ef2b8198ff778.mp4', 'GoHome 家庭看护应用演示与隐私模式介绍'), 'GoHome 家庭看护应用演示与隐私模式介绍');
  assert.equal(readableContentTitle('4542fa45a68c50d9b76ef2b8198ff778', ''), '未命名内容');
  assert.equal(readableContentTitle('我的视频.mp4', ''), '我的视频');
});

test('内容理解超时按媒体类型扩展，视频任务不会沿用纯文本超时', () => {
  assert.equal(contentUnderstandingTimeoutMs([]), 180_000);
  assert.equal(contentUnderstandingTimeoutMs([{ kind: 'IMAGE' }]), 240_000);
  assert.equal(contentUnderstandingTimeoutMs([{ kind: 'VIDEO' }]), 600_000);
});

test('公开网页保留标题层级、引用、列表和正文图片候选', () => {
  const pageUrl = new URL('https://example.com/article');
  const extracted = publicWeb.extractPublicArticleContent(pageUrl, `<main><h2>标题</h2><p>第一段正文，包含足够的文字用于验证结构化提取。</p><blockquote>这是引用内容。</blockquote><ul><li>要点一</li><li>要点二</li></ul><figure><img data-src="/images/cover.jpg" alt="封面图" width="640" height="360"><figcaption>配图说明</figcaption></figure><p>第二段正文，继续验证正文图片不会混进纯文本。</p></main>`);
  assert.deepEqual(extracted.blocks.map((block) => block.type), ['heading', 'paragraph', 'quote', 'list', 'image', 'paragraph']);
  assert.equal(extracted.media.length, 1);
  assert.equal(extracted.media[0].resolvedUrl, 'https://example.com/images/cover.jpg');
  assert.equal(extracted.media[0].classification, 'CONTENT');
  const normalized = normalizedArticleDocument({ ...extracted, title: '标题', text: extracted.plainText, url: pageUrl.toString() }, 'GENERIC_WEB');
  assert.equal(normalized.document.blocks[4].mediaCandidateId, normalized.media[0].id);
  assert.equal(normalized.document.mediaCandidateIds[0], normalized.media[0].id);
});

test('normalizes duplicate media URLs to one record and preserves block references', () => {
  const duplicateMedia = [
    { id: 'media-1', mediaType: 'IMAGE', sourceUrl: 'https://example.com/image.jpg', resolvedUrl: 'https://example.com/image.jpg', classification: 'CONTENT' },
    { id: 'media-2', mediaType: 'IMAGE', sourceUrl: 'https://example.com/image.jpg', resolvedUrl: 'https://example.com/image.jpg', classification: 'CONTENT' },
  ];
  const normalized = normalizedArticleDocument({
    title: 'Duplicate media',
    text: 'Body',
    url: 'https://example.com/article',
    media: duplicateMedia,
    blocks: duplicateMedia.map((item, index) => ({ id: `image-${index + 1}`, type: 'image', mediaCandidateId: item.id, sourcePosition: index })),
  }, 'GENERIC_WEB');
  assert.equal(normalized.media.length, 1);
  assert.deepEqual(normalized.document.blocks.map((block) => block.mediaCandidateId), [normalized.media[0].id, normalized.media[0].id]);
});

test('公开网页把正文视频作为内容理解媒体，而不是丢弃', () => {
  const pageUrl = new URL('https://example.com/article');
  const extracted = publicWeb.extractPublicArticleContent(pageUrl, '<main><p>正文内容足够用于解析。</p><video controls src="/media/demo.mp4"></video></main>');
  assert.equal(extracted.media.length, 1);
  assert.equal(extracted.media[0].mediaType, 'VIDEO');
  assert.equal(extracted.media[0].resolvedUrl, 'https://example.com/media/demo.mp4');
});

test('受限来源返回用户可执行状态，网络超时不会伪装成成功', () => {
  assert.deepEqual(ingestionFailure(new Error('这是微信的人机验证页，请完成验证。')), { code: 'HUMAN_VERIFICATION_REQUIRED', stage: 'NEEDS_USER_INPUT' });
  assert.deepEqual(ingestionFailure(new Error('读取链接超时')), { code: 'FETCH_TIMEOUT', stage: 'FAILED' });
});

test('模型输出结构错误保留明确错误码并进入失败状态', () => {
  const error = Object.assign(new Error('内容理解结果缺少有效摘要，请重新读取内容。'), {
    code: 'MODEL_OUTPUT_INVALID',
    fieldPaths: ['summary'],
  });
  assert.deepEqual(ingestionFailure(error), { code: 'MODEL_OUTPUT_INVALID', stage: 'FAILED' });
});

test('摄取 Store 的读取和更新始终带工作空间条件', async () => {
  const calls = [];
  const store = createContentIngestionStore({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return { rowCount: 1, rows: [{ id: 'i', input_kind: 'TEXT', source_type: 'UPLOAD', intent: 'AUTHOR_CONTENT', stage: 'READY', warnings_json: [], normalized_document_json: null, created_at: 'created', updated_at: 'updated' }] };
    return { rowCount: 1, rows: [{ id: 'i', input_kind: 'TEXT', source_type: 'UPLOAD', intent: 'AUTHOR_CONTENT', stage: 'READY', warnings_json: [], normalized_document_json: null, created_at: 'created', updated_at: 'updated' }] };
  } });
  await store.get('workspace-a', 'i');
  await store.update('workspace-a', 'i', { stage: 'READY' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql, params }) => /workspace_id/.test(sql) && params[0] === 'workspace-a'));
});

test('用户停止读取后迟到的模型结果不能覆盖取消状态', async () => {
  const updates = [];
  const store = {
    get: async () => ({ id: 'ingestion-1', inputKind: 'TEXT', intent: 'AUTHOR_CONTENT', stage: 'PENDING' }),
    update: async (_workspaceId, _ingestionId, patch) => {
      updates.push(patch);
      if (patch.stage === 'READY') return { id: 'ingestion-1', stage: 'CANCELLED' };
      return { id: 'ingestion-1', ...patch };
    },
  };
  const result = await executeContentIngestion({
    query: async () => ({ rows: [{ input_text: '已有正文' }] }),
    store,
    workspaceId: 'workspace-1',
    ingestionId: 'ingestion-1',
    runContentUnderstanding: async ({ document }) => ({ ...document, understanding: { summary: '摘要' } }),
  });
  assert.equal(result.stage, 'CANCELLED');
  assert.deepEqual(updates.at(-1).expectedStages, ['FETCHING', 'PARSING', 'DOWNLOADING_MEDIA', 'ANALYZING']);
});

test('服务端注册内容摄取接口和 Worker 任务', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../server/routes/content-ingestions.cjs', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const queue = fs.readFileSync(new URL('../server/queue.cjs', import.meta.url), 'utf8');
  assert.match(server, /registerContentIngestionRoutes/);
  assert.match(routes, /app\.post\('\/api\/v1\/content-ingestions'/);
  assert.match(worker, /queueJob\.name === 'CONTENT_INGESTION'/);
  assert.doesNotMatch(queue, /RETRYABLE_JOB_TYPES[\s\S]*'CONTENT_INGESTION'/);
  assert.match(worker, /CONTENT_UNDERSTANDING/);
  assert.doesNotMatch(worker, /TOPIC_RECOMMENDATION|runTopicRecommendation/);
  assert.doesNotMatch(worker, /PUBLIC_CONTENT_INGESTION|AUTHOR_CONTENT_INGESTION/);
});

test('公开链接和已有内容共用一个内容理解任务策略', () => {
  const integrations = fs.readFileSync(new URL('../src/domain/integrations.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  assert.match(integrations, /CONTENT_UNDERSTANDING/);
  assert.doesNotMatch(integrations, /PUBLIC_CONTENT_INGESTION|AUTHOR_CONTENT_INGESTION|IMAGE_VISION|VIDEO_UNDERSTANDING/);
  assert.match(main, /内容理解/);
  assert.match(main, /链接正文 \+ 图片\/视频 \+ 上传素材 → 联合分析/);
  assert.doesNotMatch(main, /公开链接内容理解|已有内容理解|图片视觉理解|视频内容理解/);
  assert.match(server, /qwen3\\\.\[6-8\]/);
  assert.match(server, /richContentTasks[\s\S]*'CONTENT_UNDERSTANDING'[\s\S]*item\?\.provider === 'BAILIAN_CLI'/);
  assert.match(main, /richContentModelTasks[\s\S]*'CONTENT_UNDERSTANDING'[\s\S]*richContentModelTasks\.has\(task\)/);
  assert.doesNotMatch(worker, /MULTIMODAL_POLICY_SCOPES|runMultimodalIngestion/);
});

test('已有内容可以同时提交正文和最多九个素材', () => {
  const assetIds = Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const input = createIngestionInput({ input: { kind: 'COMPOSITE', text: '我的正文', maturity: 'PARTIAL_DRAFT', assetIds }, intent: 'AUTHOR_CONTENT', usage: [] });
  assert.equal(input.input.kind, 'COMPOSITE');
  assert.equal(input.input.assetIds.length, 9);
  assert.equal(input.input.text, '我的正文');
  assert.throws(() => createIngestionInput({ input: { kind: 'COMPOSITE', text: '', assetIds: [] }, intent: 'AUTHOR_CONTENT' }), (error) => error.code === 'INGESTION_INPUT_INVALID');
  assert.throws(() => createIngestionInput({ input: { kind: 'COMPOSITE', assetIds: [...assetIds, '00000000-0000-4000-8000-000000000010'] }, intent: 'AUTHOR_CONTENT' }), (error) => error.code === 'INGESTION_INPUT_INVALID');
});

test('组合素材通过关联表保存并由 Worker 聚合处理', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/046_content_understanding_and_composite_assets.sql', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../server/routes/content-ingestions.cjs', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../server/services/content-ingestions.cjs', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE content_ingestion_assets/);
  assert.match(routes, /content_ingestion_assets/);
  assert.match(service, /mergeNormalizedDocuments/);
});

test('继续已有内容素材瀑布墙支持多选并限制九项', () => {
  const panel = fs.readFileSync(new URL('../src/workspaces/create/ContentIngestionPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /selectedAssets/);
  assert.match(panel, /MAX_SELECTED_ASSETS\s*=\s*9/);
  assert.match(panel, /kind:\s*'COMPOSITE'/);
  assert.doesNotMatch(panel, /setText\(''\)/);
});

test('素材处理类型只区分文档与统一多模态内容，不映射独立模型策略', () => {
  assert.equal(processingKindForAssetKind('DOCUMENT'), 'DOCUMENT');
  assert.equal(processingKindForAssetKind('DOCUMENT', 'text/plain'), 'DOCUMENT');
  assert.equal(processingKindForAssetKind('IMAGE'), 'MULTIMODAL');
  assert.equal(processingKindForAssetKind('AUDIO'), 'MULTIMODAL');
  assert.equal(processingKindForAssetKind('VIDEO'), 'MULTIMODAL');
});

test('内容理解使用同一个 Qwen Omni 调用同时携带文本、图片和视频', () => {
  const args = buildContentUnderstandingOmniArgs({
    model: 'qwen3.8-max',
    system: '联合理解全部材料',
    message: '正文内容',
    media: [
      { kind: 'IMAGE', source: 'C:/uploads/a.png' },
      { kind: 'IMAGE', source: 'https://example.com/b.jpg' },
      { kind: 'VIDEO', source: 'C:/uploads/c.mp4' },
    ],
  });
  assert.deepEqual(args.slice(0, 4), ['omni', '--model', 'qwen3.8-max', '--system']);
  assert.equal(args.filter((item) => item === '--image').length, 2);
  assert.equal(args.filter((item) => item === '--video').length, 1);
  assert.ok(args.includes('--text-only'));
  assert.deepEqual(args.slice(-2), ['--output', 'json']);
});

test('链接正文和正文媒体组成同一个内容包进入联合理解', async () => {
  let received;
  const updates = [];
  const store = {
    get: async () => ({ id: 'ingestion-1', inputKind: 'URL', sourceUrl: 'https://example.com/article', sourceType: 'GENERIC_WEB', intent: 'REFERENCE', stage: 'PENDING' }),
    update: async (_workspaceId, _ingestionId, patch) => { updates.push(patch); return patch; },
    replaceMedia: async () => true,
  };
  await executeContentIngestion({
    query: async () => ({ rows: [] }),
    store,
    workspaceId: 'workspace-1',
    ingestionId: 'ingestion-1',
    readPublicArticle: async () => ({
      title: '示例文章', url: 'https://example.com/article', text: '正文内容',
      blocks: [{ id: 'p1', type: 'paragraph', text: '正文内容', sourcePosition: 0 }],
      media: [
        { id: 'image-1', mediaType: 'IMAGE', sourceUrl: '/a.jpg', resolvedUrl: 'https://example.com/a.jpg', classification: 'CONTENT', position: 1 },
        { id: 'video-1', mediaType: 'VIDEO', sourceUrl: '/b.mp4', resolvedUrl: 'https://example.com/b.mp4', classification: 'CONTENT', position: 2 },
      ],
    }),
    runContentUnderstanding: async (contentPackage) => { received = contentPackage; return { ...contentPackage.document, understanding: { result: {} } }; },
  });
  assert.equal(received.document.plainText, '正文内容');
  assert.deepEqual(received.media.map(({ kind, source }) => [kind, source]), [
    ['IMAGE', 'https://example.com/a.jpg'],
    ['VIDEO', 'https://example.com/b.mp4'],
  ]);
  assert.equal(updates.at(-1).stage, 'READY');
});

test('链接正文图片导入空间素材并回写媒体资产标识', async () => {
  const imported = [];
  const assigned = [];
  const store = {
    get: async () => ({ id: 'ingestion-1', inputKind: 'URL', sourceUrl: 'https://example.com/article', sourceType: 'GENERIC_WEB', intent: 'REFERENCE', stage: 'PENDING' }),
    update: async (_workspaceId, _ingestionId, patch) => patch,
    replaceMedia: async () => true,
    assignMediaAsset: async (_workspaceId, ingestionId, mediaId, assetId) => assigned.push({ ingestionId, mediaId, assetId }),
  };
  await executeContentIngestion({
    query: async () => ({ rows: [] }),
    store,
    workspaceId: 'workspace-1',
    ingestionId: 'ingestion-1',
    readPublicArticle: async () => ({
      title: '示例文章', url: 'https://example.com/article', text: '正文内容', blocks: [],
      media: [
        { id: 'image-1', mediaType: 'IMAGE', sourceUrl: '/a.jpg', resolvedUrl: 'https://example.com/a.jpg', classification: 'CONTENT', position: 1, altText: '流程图' },
        { id: 'video-1', mediaType: 'VIDEO', sourceUrl: '/b.mp4', resolvedUrl: 'https://example.com/b.mp4', classification: 'CONTENT', position: 2 },
      ],
    }),
    importRemoteMedia: async (input) => { imported.push(input); return { assetId: 'asset-1' }; },
    runContentUnderstanding: async ({ document }) => ({ ...document, understanding: { result: {} } }),
  });
  assert.equal(imported.length, 1);
  assert.equal(imported[0].media.mediaType, 'IMAGE');
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].ingestionId, 'ingestion-1');
  assert.equal(assigned[0].mediaId, imported[0].media.id);
  assert.equal(assigned[0].assetId, 'asset-1');
});

test('单张链接图片下载失败只记录警告，不伪造素材或中断正文读取', async () => {
  let finalDocument;
  const store = {
    get: async () => ({ id: 'ingestion-1', inputKind: 'URL', sourceUrl: 'https://example.com/article', sourceType: 'GENERIC_WEB', intent: 'REFERENCE', stage: 'PENDING' }),
    update: async (_workspaceId, _ingestionId, patch) => { if (patch.stage === 'READY') finalDocument = patch.document; return patch; },
    replaceMedia: async () => true,
    assignMediaAsset: async () => assert.fail('下载失败时不应写入素材标识'),
  };
  await executeContentIngestion({
    query: async () => ({ rows: [] }), store, workspaceId: 'workspace-1', ingestionId: 'ingestion-1',
    readPublicArticle: async () => ({ title: '示例文章', url: 'https://example.com/article', text: '正文内容', blocks: [], media: [{ id: 'image-1', mediaType: 'IMAGE', sourceUrl: '/a.jpg', resolvedUrl: 'https://example.com/a.jpg', classification: 'CONTENT', position: 1 }] }),
    importRemoteMedia: async () => { throw new Error('远程图片不可访问'); },
    runContentUnderstanding: async ({ document }) => ({ ...document, understanding: { result: {} } }),
  });
  assert.match(finalDocument.extraction.warnings.join('\n'), /图片素材导入失败/);
});

test('新迁移把旧的图片和视频理解策略收束到内容理解', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/047_unified_multimodal_content_understanding.sql', import.meta.url), 'utf8');
  assert.match(migration, /CONTENT_UNDERSTANDING/);
  assert.match(migration, /IMAGE_VISION/);
  assert.match(migration, /VIDEO_UNDERSTANDING/);
  assert.match(migration, /DELETE FROM agent_model_policies/);
  assert.match(migration, /provider <> 'BAILIAN_CLI'/);
  assert.match(migration, /MULTIMODAL/);
});

test('公开链接应用到项目时保留已读取正文，后续正文生成可以直接使用来源材料', () => {
  const material = projectMaterialForIngestion({
    intent: 'REFERENCE',
    sourceUrl: 'https://example.com/article',
    title: '公开报道',
    plainText: '来源正文中的完整事实描述。',
    usage: ['STRUCTURE', 'ANGLE'],
  });
  assert.deepEqual(material, {
    kind: 'REFERENCE',
    title: '公开报道',
    body: '来源正文中的完整事实描述。',
    scope: 'RESEARCH',
    platforms: [],
  });
});
