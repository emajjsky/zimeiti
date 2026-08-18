const { z } = require('zod');

const uuid = z.string().uuid();
const projectId = z.string().trim().min(1).max(200);
const draftPatch = z.object({
  revision: z.number().int().positive(),
  title: z.string().max(300).optional(),
  body: z.string().max(200_000).optional(),
  visualPlan: z.record(z.string(), z.unknown()).optional(),
  layoutTemplateVersionId: uuid.nullable().optional(),
}).refine((input) => Object.keys(input).some((key) => key !== 'revision'), { message: '没有可保存的草稿字段。' });
const assetInput = z.object({
  revision: z.number().int().positive(),
  assets: z.array(z.object({ assetId: uuid, role: z.enum(['COVER', 'BODY', 'CARD', 'MAIN']) })).max(12),
});
const completeInput = z.object({ revision: z.number().int().positive() });
const titleRecommendationInput = z.object({ revision: z.number().int().positive() });

function registerContentDraftRoutes(app, { workspaceAccess, draftStore, adaptationService, recommendTitles }) {
  app.get('/api/v1/creative/projects/:projectId/drafts', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    const id = projectId.parse(request.params.projectId);
    return { drafts: await draftStore.listProject(request.workspace.id, id) };
  });

  app.post('/api/v1/creative/projects/:projectId/wechat-draft', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const id = projectId.parse(request.params.projectId);
    const input = z.object({ title: z.string().max(300).default(''), body: z.string().max(200_000).default('') }).parse(request.body ?? {});
    return draftStore.upsertWechat(request.workspace.id, id, input);
  });

  app.patch('/api/v1/content-drafts/:draftId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return draftStore.patchWorkingCopy(request.workspace.id, uuid.parse(request.params.draftId), draftPatch.parse(request.body));
  });

  app.post('/api/v1/content-drafts/:draftId/title-recommendations', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    if (typeof recommendTitles !== 'function') throw new TypeError('标题建议服务未配置。');
    const draftId = uuid.parse(request.params.draftId);
    const input = titleRecommendationInput.parse(request.body);
    const draft = await draftStore.get(request.workspace.id, draftId);
    if (Number(draft.revision) !== input.revision) {
      const error = new Error('正文已更新，请基于最新内容重新生成标题建议。');
      error.statusCode = 409;
      error.code = 'DRAFT_REVISION_CONFLICT';
      throw error;
    }
    if (!String(draft.body ?? '').trim()) {
      const error = new Error('请先完成正文，再生成标题建议。');
      error.statusCode = 409;
      error.code = 'DRAFT_BODY_REQUIRED';
      throw error;
    }
    return recommendTitles({ workspaceId: request.workspace.id, draft });
  });

  app.put('/api/v1/content-drafts/:draftId/assets', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return draftStore.replaceWorkingAssets(request.workspace.id, uuid.parse(request.params.draftId), assetInput.parse(request.body));
  });

  app.post('/api/v1/content-drafts/:draftId/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const input = completeInput.parse(request.body);
    const draftId = uuid.parse(request.params.draftId);
    return draftStore.complete(request.workspace.id, draftId, input.revision);
  });

  app.post('/api/v1/content-drafts/:draftId/derive', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const sourceDraftId = uuid.parse(request.params.draftId);
    const input = z.object({ platform: z.enum(['XIAOHONGSHU', 'WEIBO']) }).strict().parse(request.body);
    return adaptationService.prepare({ workspaceId: request.workspace.id, sourceDraftId, platform: input.platform });
  });

  app.get('/api/v1/content-draft-adaptation-runs/:runId', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return adaptationService.get({ workspaceId: request.workspace.id, runId: uuid.parse(request.params.runId) });
  });

  app.post('/api/v1/content-draft-adaptation-runs/:runId/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const result = await adaptationService.confirm({ workspaceId: request.workspace.id, runId: uuid.parse(request.params.runId) });
    reply.code(202);
    return result;
  });

  app.post('/api/v1/content-draft-adaptation-runs/:runId/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return adaptationService.cancel({ workspaceId: request.workspace.id, runId: uuid.parse(request.params.runId) });
  });

  app.get('/api/v1/content-drafts/:draftId/versions', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { versions: await draftStore.versions(request.workspace.id, uuid.parse(request.params.draftId)) };
  });

  app.get('/api/v1/content-drafts/:draftId/preview', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return draftStore.preview(request.workspace.id, uuid.parse(request.params.draftId));
  });
}

module.exports = { registerContentDraftRoutes };
