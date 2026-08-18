const { z } = require('zod');
const { businessError } = require('../services/business-errors.cjs');
const { createIngestionInput, processingKindForAssetKind } = require('../services/content-ingestions.cjs');

function registerContentIngestionRoutes(app, dependencies) {
  const { workspaceAccess, store, query, transaction, enqueue, applyIngestion } = dependencies;
  app.post('/api/v1/content-ingestions', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const input = createIngestionInput(request.body ?? {});
    const assetIds = input.input.kind === 'ASSET' ? [input.input.assetId] : input.input.kind === 'COMPOSITE' ? input.input.assetIds : [];
    if (input.input.kind === 'URL' || input.input.kind === 'COMPOSITE') input.processingKind = 'MULTIMODAL';
    if (assetIds.length) {
      const assets = await query('SELECT id, kind, mime_type, status FROM workspace_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [request.workspace.id, assetIds]);
      if (assets.rowCount !== assetIds.length) throw businessError(404, 'INGESTION_ASSET_NOT_FOUND', '部分导入素材不存在或不属于当前工作空间。');
      if (assets.rows.some((asset) => asset.status !== 'ACTIVE')) throw businessError(409, 'INGESTION_ASSET_INACTIVE', '归档素材不能作为新的导入来源。');
      input.processingKind = input.input.kind === 'COMPOSITE' ? 'MULTIMODAL' : processingKindForAssetKind(assets.rows[0].kind, assets.rows[0].mime_type);
    }
    const prepared = await transaction(async (client) => {
      const created = await client.query('INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, $2, $3) RETURNING *', [request.workspace.id, 'CONTENT_INGESTION', JSON.stringify({})]);
      const ingestion = await store.create(request.workspace.id, request.user.sub, input, created.rows[0].id, client);
      const payload = { ingestionId: ingestion.id };
      await client.query('UPDATE jobs SET payload_json = $1 WHERE id = $2 AND workspace_id = $3', [JSON.stringify(payload), created.rows[0].id, request.workspace.id]);
      if (input.input.kind === 'TEXT' || input.input.kind === 'COMPOSITE') await client.query('INSERT INTO content_ingestion_inputs (ingestion_id, workspace_id, input_text) VALUES ($1, $2, $3)', [ingestion.id, request.workspace.id, input.input.text]);
      for (const [position, assetId] of assetIds.entries()) {
        await client.query('INSERT INTO content_ingestion_assets (ingestion_id, workspace_id, asset_id, position) VALUES ($1, $2, $3, $4)', [ingestion.id, request.workspace.id, assetId, position]);
      }
      return { ingestion, job: { ...created.rows[0], payload_json: payload } };
    });
    try { await enqueue(prepared.job); } catch (error) {
      await transaction(async (client) => {
        await client.query('UPDATE jobs SET status = $1, error = $2, completed_at = now() WHERE id = $3', ['FAILED', error instanceof Error ? error.message : '任务入队失败。', prepared.job.id]);
        await client.query("UPDATE content_ingestions SET stage = 'FAILED', error_code = 'INGESTION_QUEUE_UNAVAILABLE', error_message = $2, updated_at = now() WHERE id = $1", [prepared.ingestion.id, '内容导入任务暂时无法启动，请稍后再试。']);
      });
      throw businessError(503, 'INGESTION_QUEUE_UNAVAILABLE', '内容导入任务暂时无法启动，请稍后再试。');
    }
    reply.code(202).send({ ingestion: prepared.ingestion, jobId: prepared.job.id });
  });

  app.get('/api/v1/content-ingestions/:id', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    const id = z.string().uuid().parse(request.params.id);
    const ingestion = await store.get(request.workspace.id, id);
    return { ...ingestion, media: await store.listMedia(request.workspace.id, id) };
  });
  app.post('/api/v1/content-ingestions/:id/apply', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const ingestionId = z.string().uuid().parse(request.params.id);
    const input = z.object({
      originType: z.enum(['DRAFT', 'IMPORT']).optional(),
      title: z.string().trim().max(160).default(''),
      category: z.string().trim().max(120).default(''),
      targetPlatforms: z.array(z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'])).min(1).max(5).default(['WECHAT']),
      maturity: z.enum(['IDEA', 'OUTLINE', 'FRAGMENTS', 'PARTIAL_DRAFT', 'FULL_DRAFT']).optional(),
    }).parse(request.body ?? {});
    if (typeof applyIngestion !== 'function') throw businessError(500, 'INGESTION_APPLY_UNAVAILABLE', '内容导入应用服务未接入。');
    reply.code(201).send(await applyIngestion({ workspaceId: request.workspace.id, userId: request.user.sub, ingestionId, input }));
  });
  app.post('/api/v1/content-ingestions/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const id = z.string().uuid().parse(request.params.id);
    const result = await query("UPDATE content_ingestions SET stage = 'CANCELLED', updated_at = now() WHERE workspace_id = $1 AND id = $2 AND stage IN ('PENDING','FETCHING','PARSING','DOWNLOADING_MEDIA','ANALYZING') RETURNING *", [request.workspace.id, id]);
    if (!result.rowCount) throw businessError(409, 'INGESTION_NOT_ACTIVE', '当前导入已结束，不能取消。');
    await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND id = (SELECT job_id FROM content_ingestions WHERE workspace_id = $1 AND id = $2) AND status IN ('PENDING','RUNNING')", [request.workspace.id, id]);
    return store.get(request.workspace.id, id);
  });
}

module.exports = { registerContentIngestionRoutes };
