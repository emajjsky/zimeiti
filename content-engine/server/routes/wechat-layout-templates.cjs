const { z } = require('zod');
const { WECHAT_TEMPLATE_ANALYSIS_SCOPE } = require('../services/wechat-layout-templates.cjs');

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(80);
const rules = z.record(z.string(), z.unknown());

function registerWechatLayoutTemplateRoutes(app, {
  workspaceAccess,
  templateStore,
  resolveTaskRoute,
  analyzeTemplateSource,
  runTextTask,
  recordUsage,
  transaction,
}) {
  if ([resolveTaskRoute, analyzeTemplateSource, runTextTask, recordUsage, transaction].some((dependency) => typeof dependency !== 'function')) {
    throw new TypeError('公众号模板路由依赖未完整配置。');
  }
  app.get('/api/v1/wechat-layout-templates', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => ({
    templates: await templateStore.list(request.workspace.id),
  }));

  app.post('/api/v1/wechat-layout-templates', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const input = z.object({ name, rules }).parse(request.body);
    const created = await templateStore.create(request.workspace.id, input.name, { rules: input.rules, sourceType: 'MANUAL', userId: request.user.sub });
    reply.code(201).send(created);
  });

  app.put('/api/v1/wechat-layout-templates/:templateId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const input = z.object({ name, rules }).parse(request.body);
    return templateStore.update(request.workspace.id, uuid.parse(request.params.templateId), { ...input, sourceType: 'MANUAL', userId: request.user.sub });
  });

  app.delete('/api/v1/wechat-layout-templates/:templateId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    await templateStore.remove(request.workspace.id, uuid.parse(request.params.templateId));
    reply.code(204).send();
  });

  app.post('/api/v1/wechat-layout-templates/import', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const input = z.object({ name, url: z.string().url().max(2_000), confirmedRights: z.boolean() }).parse(request.body);
    const workspaceId = request.workspace.id;
    const route = await resolveTaskRoute(workspaceId, WECHAT_TEMPLATE_ANALYSIS_SCOPE, '公众号模板分析');
    const startedAt = Date.now();
    let analyzed;
    try {
      analyzed = await analyzeTemplateSource({
        url: input.url,
        confirmedRights: input.confirmedRights,
        route,
        runTextTask: (task) => runTextTask({ ...task, workspaceId }),
      });
    } catch (error) {
      await recordUsage({ workspaceId, provider: route.provider, model: route.model, operation: WECHAT_TEMPLATE_ANALYSIS_SCOPE, status: 'ERROR', durationMs: Date.now() - startedAt, error: (error instanceof Error ? error.message : '公众号模板分析失败').slice(0, 2_000) });
      throw error;
    }
    const created = await transaction(async (client) => {
      const saved = await templateStore.create(workspaceId, input.name, {
        rules: analyzed.rules,
        sourceType: 'WECHAT_URL',
        sourceUrl: analyzed.sourceUrl,
        sourceFingerprint: analyzed.sourceFingerprint,
        promptVersion: analyzed.promptVersion,
        userId: request.user.sub,
      }, client);
      await recordUsage({ workspaceId, provider: route.provider, model: route.model, operation: WECHAT_TEMPLATE_ANALYSIS_SCOPE, status: 'SUCCESS', durationMs: Date.now() - startedAt, ...analyzed.usage }, client);
      return saved;
    });
    reply.code(201).send(created);
  });
}

module.exports = { registerWechatLayoutTemplateRoutes };
