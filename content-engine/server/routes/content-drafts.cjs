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

function registerContentDraftRoutes(app, { workspaceAccess, draftStore }) {
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

  app.put('/api/v1/content-drafts/:draftId/assets', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return draftStore.replaceWorkingAssets(request.workspace.id, uuid.parse(request.params.draftId), assetInput.parse(request.body));
  });

  app.post('/api/v1/content-drafts/:draftId/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return draftStore.complete(request.workspace.id, uuid.parse(request.params.draftId));
  });

  app.post('/api/v1/content-drafts/:draftId/derive', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const sourceDraftId = uuid.parse(request.params.draftId);
    const source = await draftStore.get(request.workspace.id, sourceDraftId);
    const input = z.object({ platform: z.enum(['XIAOHONGSHU', 'WEIBO']), sourceDraftVersionId: uuid }).parse(request.body);
    return draftStore.createDerivedWorkingCopy(request.workspace.id, source.projectId, input.platform, input.sourceDraftVersionId);
  });

  app.get('/api/v1/content-drafts/:draftId/versions', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { versions: await draftStore.versions(request.workspace.id, uuid.parse(request.params.draftId)) };
  });

  app.get('/api/v1/content-drafts/:draftId/preview', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return draftStore.preview(request.workspace.id, uuid.parse(request.params.draftId));
  });
}

module.exports = { registerContentDraftRoutes };
