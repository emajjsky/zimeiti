const { z } = require('zod');
const { businessError } = require('../services/business-errors.cjs');
const { VIDEO_ANALYSIS_SCOPE, supportsVideoAnalysisModel, parseVideoAnalysis } = require('../services/video-analysis.cjs');

const uuid = z.string().uuid();

function videoAnalysisProgress(row) {
  const progress = row.progress_json ?? { phase: 'PROBING', completedSegments: 0, totalSegments: 0 };
  if (row.status === 'SUCCEEDED') return { ...progress, phase: 'SUCCEEDED' };
  if (row.status === 'FAILED') return { ...progress, phase: 'FAILED' };
  return progress;
}

function publicVideoAnalysisResult(row) {
  if (!['EXTRACTING_FRAMES', 'SUCCEEDED'].includes(row.status)) return null;
  const result = row.result_json;
  if (!result) return null;
  try {
    parseVideoAnalysis(JSON.stringify(result));
  } catch {
    return null;
  }
  return result;
}

function videoAnalysisView(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceAssetId: row.source_asset_id,
    status: row.status,
    targetPlatform: row.target_platform,
    model: row.model,
    progress: videoAnalysisProgress(row),
    result: publicVideoAnalysisResult(row),
    keyframeAssetIds: row.keyframe_asset_ids ?? [],
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function registerVideoAnalysisRoutes(app, { workspaceAccess, query, transaction, enqueue, resolveTaskRoute }) {
  app.post('/api/v1/creative/projects/:projectId/video-analyses', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const projectId = z.string().trim().min(1).max(200).parse(request.params.projectId);
    const input = z.object({ assetId: uuid, targetPlatform: z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']).default('WECHAT') }).parse(request.body ?? {});
    const workspaceId = request.workspace.id;
    const route = await resolveTaskRoute(workspaceId, VIDEO_ANALYSIS_SCOPE, '视频拉片');
    if (route.provider !== 'BAILIAN_CLI') throw businessError(400, 'RICH_CONTENT_PROVIDER_REQUIRED', '视频拉片需要使用支持视频理解的百炼 CLI 模型。');
    if (!supportsVideoAnalysisModel(route.model)) throw businessError(400, 'VIDEO_ANALYSIS_MODEL_UNSUPPORTED', '视频拉片请选择 Qwen 3.6 至 3.8 系列模型，Omni 模型不适用于该任务。');
    const prepared = await transaction(async (client) => {
      const project = await client.query('SELECT project_id FROM content_projects WHERE workspace_id = $1 AND project_id = $2', [workspaceId, projectId]);
      if (!project.rowCount) throw businessError(404, 'PROJECT_NOT_FOUND', '没有找到这个内容项目。');
      const asset = await client.query(`SELECT id, kind, status FROM workspace_assets WHERE workspace_id = $1 AND id = $2 FOR SHARE`, [workspaceId, input.assetId]);
      if (!asset.rowCount) throw businessError(404, 'ASSET_NOT_FOUND', '没有找到上传的视频素材。');
      if (asset.rows[0].kind !== 'VIDEO' || asset.rows[0].status !== 'ACTIVE') throw businessError(400, 'VIDEO_ASSET_REQUIRED', '视频拉片只接受状态正常的视频素材。');
      await client.query(`INSERT INTO project_asset_links (workspace_id, project_id, asset_id, role, scope, title, notes, platforms_json)
        SELECT $1, $2, asset.id, 'VISUAL', 'PROJECT', asset.title, '视频拉片源文件', $4
        FROM workspace_assets asset WHERE asset.workspace_id = $1 AND asset.id = $3
        ON CONFLICT (workspace_id, project_id, asset_id) DO NOTHING`, [workspaceId, projectId, input.assetId, JSON.stringify([input.targetPlatform])]);
      const job = await client.query(`INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'VIDEO_ANALYSIS', '{}'::jsonb) RETURNING *`, [workspaceId]);
      const analysis = await client.query(`INSERT INTO video_analyses (workspace_id, project_id, source_asset_id, job_id, target_platform, model, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [workspaceId, projectId, input.assetId, job.rows[0].id, input.targetPlatform, route.model, request.user.sub]);
      const payload = { analysisId: analysis.rows[0].id };
      await client.query('UPDATE jobs SET payload_json = $1 WHERE id = $2 AND workspace_id = $3', [JSON.stringify(payload), job.rows[0].id, workspaceId]);
      return { analysis: analysis.rows[0], job: { ...job.rows[0], payload_json: payload } };
    });
    try { await enqueue(prepared.job); } catch (error) {
      const message = error instanceof Error ? error.message : '视频拉片任务入队失败';
      await transaction(async (client) => {
        await client.query("UPDATE video_analyses SET status = 'FAILED', error = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, prepared.analysis.id, message]);
        await client.query("UPDATE jobs SET status = 'FAILED', error = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, prepared.job.id, message]);
      });
      throw businessError(503, 'VIDEO_ANALYSIS_QUEUE_UNAVAILABLE', '视频拉片任务暂时无法启动，请稍后再试。');
    }
    reply.code(202).send(videoAnalysisView(prepared.analysis));
  });

  app.get('/api/v1/creative/projects/:projectId/video-analyses', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    const projectId = z.string().trim().min(1).max(200).parse(request.params.projectId);
    const result = await query('SELECT * FROM video_analyses WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC', [request.workspace.id, projectId]);
    return { analyses: result.rows.map(videoAnalysisView) };
  });

  app.get('/api/v1/video-analyses/:analysisId', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    const result = await query('SELECT * FROM video_analyses WHERE workspace_id = $1 AND id = $2', [request.workspace.id, uuid.parse(request.params.analysisId)]);
    if (!result.rowCount) throw businessError(404, 'VIDEO_ANALYSIS_NOT_FOUND', '没有找到这次视频拉片任务。');
    return videoAnalysisView(result.rows[0]);
  });
}

module.exports = { registerVideoAnalysisRoutes, videoAnalysisView };
