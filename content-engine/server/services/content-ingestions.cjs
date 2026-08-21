const { createHash, randomUUID } = require('node:crypto');
const { z } = require('zod');
const { businessError } = require('./business-errors.cjs');

const INGESTION_STAGES = Object.freeze(['PENDING', 'FETCHING', 'PARSING', 'DOWNLOADING_MEDIA', 'ANALYZING', 'READY', 'PARTIAL', 'NEEDS_USER_INPUT', 'FAILED', 'CANCELLED']);
const intents = new Set(['REFERENCE', 'AUTHOR_CONTENT', 'DISCOVERY', 'VOICE_SAMPLE']);
const usages = new Set(['TOPIC', 'ANGLE', 'STRUCTURE', 'STYLE', 'FACT_LEADS', 'VISUAL', 'COMPREHENSIVE']);

function processingKindForAssetKind(kind, mimeType = '') {
  if (kind === 'DOCUMENT') return 'DOCUMENT';
  if (['IMAGE', 'AUDIO', 'VIDEO'].includes(kind)) return 'MULTIMODAL';
  return 'TEXT';
}

function isInternalIdentifierTitle(value) {
  const stem = String(value ?? '').trim().replace(/\.(?:mp4|webm|mov|avi|mkv|png|jpe?g|gif|webp)$/i, '');
  return /^[a-f0-9]{32,64}$/i.test(stem) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(stem);
}

function readableContentTitle(candidate, content = '') {
  const raw = String(candidate ?? '').trim();
  const withoutExtension = raw.replace(/\.(?:mp4|webm|mov|avi|mkv|png|jpe?g|gif|webp)$/i, '').trim();
  if (withoutExtension && !isInternalIdentifierTitle(withoutExtension)) return withoutExtension.slice(0, 240);
  const firstLine = String(content ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 4 && !isInternalIdentifierTitle(line));
  return firstLine ? firstLine.slice(0, 80) : '未命名内容';
}

function contentUnderstandingTimeoutMs(media = []) {
  if (media.some((item) => String(item?.kind).toUpperCase() === 'VIDEO')) return 600_000;
  if (media.length) return 240_000;
  return 180_000;
}

function projectMaterialForIngestion({ intent, sourceUrl, title, plainText }) {
  if (intent !== 'REFERENCE' || !sourceUrl || !String(plainText ?? '').trim()) return null;
  return {
    kind: 'REFERENCE',
    title: String(title || '公开来源').trim().slice(0, 160),
    body: String(plainText).trim().slice(0, 50_000),
    scope: 'RESEARCH',
    platforms: [],
  };
}

function sourceTypeForUrl(rawUrl) {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (hostname === 'mp.weixin.qq.com') return 'WECHAT';
  if (hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com')) return 'ZHIHU';
  if (hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com' || hostname.endsWith('.twitter.com')) return 'X';
  return 'GENERIC_WEB';
}

function createIngestionInput(value) {
  const schema = z.object({
    projectId: z.string().trim().min(1).max(200).nullable().optional(),
    input: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('URL'), url: z.string().url().max(2_000) }),
      z.object({ kind: z.literal('TEXT'), text: z.string().trim().min(1).max(100_000), maturity: z.enum(['IDEA', 'OUTLINE', 'FRAGMENTS', 'PARTIAL_DRAFT', 'FULL_DRAFT']).optional() }),
      z.object({ kind: z.literal('ASSET'), assetId: z.string().uuid() }),
      z.object({
        kind: z.literal('COMPOSITE'),
        text: z.string().trim().max(100_000).default(''),
        maturity: z.enum(['IDEA', 'OUTLINE', 'FRAGMENTS', 'PARTIAL_DRAFT', 'FULL_DRAFT']).optional(),
        assetIds: z.array(z.string().uuid()).max(9).default([]),
      }).superRefine((input, context) => {
        if (!input.text && input.assetIds.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: '正文和素材不能同时为空。' });
        if (new Set(input.assetIds).size !== input.assetIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '素材不能重复选择。' });
      }),
    ]),
    intent: z.enum([...intents]),
    usage: z.array(z.enum([...usages])).max(7).default([]),
  });
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw businessError(400, 'INGESTION_INPUT_INVALID', '导入内容不完整，请检查来源和用途。');
  if (parsed.data.input.kind === 'COMPOSITE' && parsed.data.intent !== 'AUTHOR_CONTENT') throw businessError(400, 'INGESTION_INPUT_INVALID', '组合内容只用于继续已有内容。');
  if (parsed.data.input.kind === 'URL') {
    try { new URL(parsed.data.input.url); } catch { throw businessError(400, 'INGESTION_URL_INVALID', '请输入有效的公开网页链接。'); }
  }
  return parsed.data;
}

function hashText(text) { return createHash('sha256').update(String(text), 'utf8').digest('hex'); }

function splitTextBlocks(text) {
  return String(text).split(/\n{2,}|\r\n|\n/).map((value) => value.trim()).filter(Boolean).map((value, index) => ({ id: `paragraph-${index + 1}`, type: 'paragraph', text: value, sourcePosition: index }));
}

function normalizedTextDocument({ title = '', text, adapter = 'TEXT', canonicalUrl = null, publishedAt = null, warnings = [] }) {
  const plainText = String(text ?? '').trim();
  if (!plainText) throw businessError(422, 'INGESTION_EMPTY_CONTENT', '没有读取到可用于创作的正文内容。');
  const now = new Date().toISOString();
  const blocks = splitTextBlocks(plainText);
  return { schemaVersion: 1, title: readableContentTitle(title, plainText), author: undefined, publishedAt, canonicalUrl, language: 'unknown', blocks, plainText, mediaCandidateIds: [], extraction: { adapter, adapterVersion: '1.0.0', fetchedAt: now, contentHash: hashText(plainText), completeness: 'FULL', warnings } };
}

function normalizedMediaDocument(title = '多模态素材') {
  const now = new Date().toISOString();
  return { schemaVersion: 1, title: readableContentTitle(title), canonicalUrl: null, language: 'unknown', blocks: [], plainText: '', mediaCandidateIds: [], extraction: { adapter: 'MULTIMODAL', adapterVersion: '1.0.0', fetchedAt: now, contentHash: hashText(''), completeness: 'FULL', warnings: [] } };
}

function normalizedArticleDocument(page, sourceType) {
  const plainText = String(page.text ?? '').trim();
  if (!plainText) throw businessError(422, 'INGESTION_EMPTY_CONTENT', '没有读取到可用于创作的正文内容。');
  const sourceMedia = Array.isArray(page.media) ? page.media : [];
  const media = [];
  const mediaIds = new Map();
  const mediaBySourceUrl = new Map();
  for (const item of sourceMedia) {
    const sourceUrl = String(item?.sourceUrl ?? '').trim();
    if (!sourceUrl) continue;
    const existingId = mediaBySourceUrl.get(sourceUrl);
    if (existingId) {
      mediaIds.set(item.id, existingId);
      continue;
    }
    const id = randomUUID();
    mediaBySourceUrl.set(sourceUrl, id);
    mediaIds.set(item.id, id);
    media.push({ ...item, id, sourceUrl });
  }
  const blocks = (Array.isArray(page.blocks) && page.blocks.length ? page.blocks : splitTextBlocks(plainText)).map((block) => block.mediaCandidateId ? { ...block, mediaCandidateId: mediaIds.get(block.mediaCandidateId) } : block);
  const document = { schemaVersion: 1, title: readableContentTitle(page.title, blocks.find((block) => block.text)?.text || plainText), author: page.author || undefined, publishedAt: page.publishedAt || null, canonicalUrl: page.url || null, language: 'unknown', blocks, plainText, mediaCandidateIds: media.map((item) => item.id), extraction: { adapter: `${sourceType}_ARTICLE`, adapterVersion: '2.0.0', fetchedAt: new Date().toISOString(), contentHash: hashText(plainText), completeness: 'FULL', warnings: [] } };
  return { document, media };
}

function mergeNormalizedDocuments(documents) {
  const usable = (Array.isArray(documents) ? documents : []).filter((document) => String(document?.plainText ?? '').trim());
  if (!usable.length) throw businessError(422, 'INGESTION_EMPTY_CONTENT', '没有从正文或素材中读取到可用于创作的内容。');
  if (usable.length === 1) return usable[0];
  const plainText = usable.map((document) => document.plainText.trim()).join('\n\n');
  return {
    schemaVersion: 1,
    title: usable.find((document) => document.title)?.title ?? '组合内容',
    canonicalUrl: usable.find((document) => document.canonicalUrl)?.canonicalUrl ?? null,
    language: usable.find((document) => document.language)?.language ?? 'unknown',
    blocks: usable.flatMap((document, sourceIndex) => document.blocks.map((block, blockIndex) => ({
      ...block,
      id: `source-${sourceIndex + 1}:${block.id || `block-${blockIndex + 1}`}`,
      sourcePosition: blockIndex,
    }))),
    plainText,
    mediaCandidateIds: usable.flatMap((document) => document.mediaCandidateIds ?? []),
    extraction: {
      adapter: 'COMPOSITE',
      adapterVersion: '1.0.0',
      fetchedAt: new Date().toISOString(),
      contentHash: hashText(plainText),
      completeness: usable.some((document) => document.extraction?.completeness === 'PARTIAL') ? 'PARTIAL' : 'FULL',
      warnings: usable.flatMap((document) => document.extraction?.warnings ?? []),
    },
  };
}

function ingestionMediaView(row) {
  return { id: row.id, mediaType: row.media_type ?? 'IMAGE', blockId: row.block_id ?? null, sourceUrl: row.source_url, resolvedUrl: row.resolved_url ?? row.source_url, altText: row.alt_text ?? '', caption: row.caption ?? '', width: row.width ?? null, height: row.height ?? null, position: row.position ?? null, classification: row.classification, copyrightStatus: row.copyright_status, selected: Boolean(row.selected), assetId: row.asset_id ?? null };
}

function ingestionFailure(error) {
  if (error?.code) return { code: error.code, stage: ['HUMAN_VERIFICATION_REQUIRED', 'INGESTION_ASSET_MULTIMODAL_PENDING'].includes(error.code) ? 'NEEDS_USER_INPUT' : 'FAILED' };
  const message = error instanceof Error ? error.message : '内容导入失败。';
  if (/人机验证|验证码/.test(message)) return { code: 'HUMAN_VERIFICATION_REQUIRED', stage: 'NEEDS_USER_INPUT' };
  if (/登录|付费|权限/.test(message)) return { code: 'LOGIN_REQUIRED', stage: 'NEEDS_USER_INPUT' };
  if (/超时|timeout/i.test(message)) return { code: 'FETCH_TIMEOUT', stage: 'FAILED' };
  if (/超过.*MB|内容超过|过大/.test(message)) return { code: 'FETCH_TOO_LARGE', stage: 'FAILED' };
  if (/局域网|本机/.test(message)) return { code: 'URL_NOT_PUBLIC', stage: 'FAILED' };
  return { code: 'INGESTION_FAILED', stage: 'FAILED' };
}

function ingestionView(row) {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    jobId: row.job_id ?? null,
    inputKind: row.input_kind,
    sourceType: row.source_type,
    intent: row.intent,
    sourceUrl: row.source_url ?? null,
    processingKind: row.processing_kind ?? 'TEXT',
    canonicalUrl: row.canonical_url ?? null,
    title: row.title ?? '',
    author: row.author ?? null,
    publishedAt: row.published_at ?? null,
    stage: row.stage,
    completeness: row.completeness ?? null,
    document: row.normalized_document_json ?? null,
    warnings: Array.isArray(row.warnings_json) ? row.warnings_json : [],
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createContentIngestionStore({ query, transaction = async (callback) => callback({ query }) }) {
  async function create(workspaceId, userId, input, jobId, executor = { query }) {
    const sourceType = input.input.kind === 'URL' ? sourceTypeForUrl(input.input.url) : 'UPLOAD';
    const sourceUrl = input.input.kind === 'URL' ? input.input.url.trim() : null;
    const result = await executor.query(`INSERT INTO content_ingestions (workspace_id, project_id, job_id, input_kind, source_type, intent, usage_json, source_url, processing_kind, title, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10)
      RETURNING *`, [workspaceId, input.projectId ?? null, jobId, input.input.kind, sourceType, input.intent, JSON.stringify(input.usage), sourceUrl, input.processingKind ?? 'TEXT', userId]);
    return ingestionView(result.rows[0]);
  }
  async function get(workspaceId, id) {
    const result = await query('SELECT * FROM content_ingestions WHERE workspace_id = $1 AND id = $2', [workspaceId, id]);
    if (!result.rowCount) throw businessError(404, 'INGESTION_NOT_FOUND', '未找到这次内容导入。');
    return ingestionView(result.rows[0]);
  }
  async function update(workspaceId, id, patch) {
    const fields = ['stage = $3', 'updated_at = now()']; const values = [workspaceId, id, patch.stage]; let next = 4;
    for (const [column, value] of [['title', patch.title], ['author', patch.author], ['published_at', patch.publishedAt], ['canonical_url', patch.canonicalUrl], ['completeness', patch.completeness], ['error_code', patch.errorCode], ['error_message', patch.errorMessage]]) {
      if (value !== undefined) { fields.push(`${column} = $${next}`); values.push(value); next += 1; }
    }
    for (const [column, value] of [['normalized_document_json', patch.document], ['warnings_json', patch.warnings]]) {
      if (value !== undefined) { fields.push(`${column} = $${next}`); values.push(JSON.stringify(value)); next += 1; }
    }
    let condition = 'workspace_id = $1 AND id = $2';
    if (Array.isArray(patch.expectedStages) && patch.expectedStages.length) { condition += ` AND stage = ANY($${next}::text[])`; values.push(patch.expectedStages); }
    const result = await query(`UPDATE content_ingestions SET ${fields.join(', ')} WHERE ${condition} RETURNING *`, values);
    if (!result.rowCount && Array.isArray(patch.expectedStages)) return get(workspaceId, id);
    if (!result.rowCount) throw businessError(404, 'INGESTION_NOT_FOUND', '未找到这次内容导入。');
    return ingestionView(result.rows[0]);
  }
  async function listMedia(workspaceId, ingestionId) {
    const result = await query('SELECT * FROM content_ingestion_media WHERE workspace_id = $1 AND ingestion_id = $2 ORDER BY position NULLS LAST, id', [workspaceId, ingestionId]);
    return result.rows.map(ingestionMediaView);
  }
  async function listSourceAssets(workspaceId, ingestionId) {
    const result = await query(`SELECT asset.storage_key, asset.kind, asset.mime_type, asset.title, source.position
      FROM content_ingestion_assets source
      JOIN workspace_assets asset ON asset.workspace_id = source.workspace_id AND asset.id = source.asset_id
      WHERE source.workspace_id = $1 AND source.ingestion_id = $2
      ORDER BY source.position`, [workspaceId, ingestionId]);
    return result.rows;
  }
  async function getCreator(workspaceId, ingestionId) {
    const result = await query('SELECT created_by FROM content_ingestions WHERE workspace_id = $1 AND id = $2', [workspaceId, ingestionId]);
    return result.rows[0]?.created_by ?? null;
  }
  async function replaceMedia(workspaceId, ingestionId, media) {
    return transaction(async (client) => {
      const active = await client.query("SELECT id FROM content_ingestions WHERE workspace_id = $1 AND id = $2 AND stage IN ('PENDING','FETCHING','PARSING','DOWNLOADING_MEDIA','ANALYZING') FOR UPDATE", [workspaceId, ingestionId]);
      if (!active.rowCount) return false;
      await client.query('DELETE FROM content_ingestion_media WHERE workspace_id = $1 AND ingestion_id = $2', [workspaceId, ingestionId]);
      for (const item of media) await client.query('INSERT INTO content_ingestion_media (id, workspace_id, ingestion_id, media_type, block_id, source_url, resolved_url, alt_text, caption, width, height, position, classification, copyright_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,\'PENDING\')', [item.id, workspaceId, ingestionId, item.mediaType ?? 'IMAGE', item.blockId ?? null, item.sourceUrl, item.resolvedUrl, item.altText ?? '', item.caption ?? '', item.width ?? null, item.height ?? null, item.position ?? null, item.classification ?? 'UNKNOWN']);
      return true;
    });
  }
  async function assignMediaAsset(workspaceId, ingestionId, mediaId, assetId) {
    const result = await query(`UPDATE content_ingestion_media
      SET asset_id = $4
      WHERE workspace_id = $1 AND ingestion_id = $2 AND id = $3
      RETURNING id`, [workspaceId, ingestionId, mediaId, assetId]);
    if (!result.rowCount) throw businessError(404, 'INGESTION_MEDIA_NOT_FOUND', '未找到需要关联的链接图片。');
  }
  return { create, get, update, listMedia, listSourceAssets, getCreator, replaceMedia, assignMediaAsset };
}

async function executeContentIngestion({ query, store, workspaceId, ingestionId, readPublicArticle, readAssetText, uploadRoot, runContentUnderstanding, importRemoteMedia }) {
  const current = await store.get(workspaceId, ingestionId);
  try {
    await store.update(workspaceId, ingestionId, { stage: current.stage === 'PENDING' ? 'FETCHING' : current.stage, errorCode: null, errorMessage: null });
    let document;
    if (current.inputKind === 'URL') {
      const page = await readPublicArticle(current.sourceUrl);
      await store.update(workspaceId, ingestionId, { stage: 'PARSING', expectedStages: ['FETCHING'] });
      const normalized = normalizedArticleDocument(page, current.sourceType);
      document = normalized.document;
      await store.replaceMedia(workspaceId, ingestionId, normalized.media.map((item) => ({ ...item, blockId: document.blocks.find((block) => block.mediaCandidateId === item.id)?.id ?? null })));
      const reusableMedia = normalized.media.filter((item) => item.classification === 'CONTENT').slice(0, 9);
      const media = reusableMedia.map((item) => ({ kind: item.mediaType ?? 'IMAGE', source: item.resolvedUrl, label: item.caption || item.altText || '' }));
      await store.update(workspaceId, ingestionId, { stage: 'ANALYZING', expectedStages: ['PARSING'] });
      if (typeof runContentUnderstanding === 'function') document = await runContentUnderstanding({ workspaceId, intent: current.intent, document, media });
      if (typeof importRemoteMedia === 'function') {
        await store.update(workspaceId, ingestionId, { stage: 'DOWNLOADING_MEDIA', expectedStages: ['ANALYZING'] });
        const warnings = [...(document.extraction?.warnings ?? [])];
        for (const item of reusableMedia.filter((candidate) => (candidate.mediaType ?? 'IMAGE') === 'IMAGE')) {
          try {
            const imported = await importRemoteMedia({ workspaceId, ingestionId, media: item, document });
            if (imported?.assetId) await store.assignMediaAsset(workspaceId, ingestionId, item.id, imported.assetId);
          } catch (error) {
            const label = item.caption || item.altText || item.resolvedUrl || item.sourceUrl;
            warnings.push(`图片素材导入失败：${String(label).slice(0, 160)}（${error instanceof Error ? error.message : '未知错误'}）`);
          }
        }
        document = { ...document, extraction: { ...document.extraction, warnings } };
      }
    } else if (current.inputKind === 'TEXT') {
      const row = await query('SELECT input_text FROM content_ingestion_inputs WHERE ingestion_id = $1 AND workspace_id = $2', [ingestionId, workspaceId]);
      document = normalizedTextDocument({ text: row.rows[0]?.input_text, adapter: 'TEXT' });
      await store.update(workspaceId, ingestionId, { stage: 'ANALYZING', expectedStages: ['FETCHING'] });
      if (typeof runContentUnderstanding === 'function') document = await runContentUnderstanding({ workspaceId, intent: current.intent, document, media: [] });
    } else {
      const documents = [];
      const media = [];
      if (current.inputKind === 'COMPOSITE') {
        const textRow = await query('SELECT input_text FROM content_ingestion_inputs WHERE ingestion_id = $1 AND workspace_id = $2', [ingestionId, workspaceId]);
        if (String(textRow.rows[0]?.input_text ?? '').trim()) documents.push(normalizedTextDocument({ text: textRow.rows[0].input_text, adapter: 'AUTHOR_TEXT' }));
      }
      const assets = await store.listSourceAssets(workspaceId, ingestionId);
      for (const asset of assets) {
        const processingKind = processingKindForAssetKind(asset.kind, asset.mime_type);
        if (asset.kind === 'DOCUMENT') {
          documents.push(normalizedTextDocument({ title: asset.title, text: await readAssetText(uploadRoot, asset.storage_key), adapter: 'UPLOAD_DOCUMENT' }));
          continue;
        }
        if (processingKind === 'MULTIMODAL') media.push({ kind: asset.kind, storageKey: asset.storage_key, label: asset.title || '' });
      }
      document = documents.length ? mergeNormalizedDocuments(documents) : normalizedMediaDocument(assets[0]?.title || '多模态素材');
      await store.update(workspaceId, ingestionId, { stage: 'ANALYZING', expectedStages: ['FETCHING'] });
      if (typeof runContentUnderstanding === 'function') document = await runContentUnderstanding({ workspaceId, intent: current.intent, document, media });
    }
    return store.update(workspaceId, ingestionId, { stage: 'READY', completeness: document.extraction.completeness, title: document.title, canonicalUrl: document.canonicalUrl, publishedAt: document.publishedAt, document, warnings: document.extraction.warnings, expectedStages: ['FETCHING', 'PARSING', 'DOWNLOADING_MEDIA', 'ANALYZING'] });
  } catch (error) {
    const failure = ingestionFailure(error);
    await store.update(workspaceId, ingestionId, { stage: failure.stage, errorCode: failure.code, errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : '内容导入失败。', expectedStages: ['PENDING', 'FETCHING', 'PARSING', 'DOWNLOADING_MEDIA', 'ANALYZING'] });
    throw error;
  }
}

module.exports = { INGESTION_STAGES, createIngestionInput, sourceTypeForUrl, processingKindForAssetKind, projectMaterialForIngestion, readableContentTitle, contentUnderstandingTimeoutMs, normalizedTextDocument, normalizedMediaDocument, normalizedArticleDocument, mergeNormalizedDocuments, ingestionFailure, ingestionView, ingestionMediaView, createContentIngestionStore, executeContentIngestion };
