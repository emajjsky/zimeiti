const { z } = require('zod');
const { WECHAT_TEMPLATE_ANALYSIS_SCOPE } = require('../services/wechat-layout-templates.cjs');
const {
  WECHAT_LAYOUT_DESIGN_SCOPE,
  buildWechatLayoutDesignPrompt,
  parseWechatLayoutDesignContent,
  paragraphCount,
} = require('../services/wechat-layout-design.cjs');

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(80);
const rules = z.record(z.string(), z.unknown());

function layoutDesignForTemplate(visualPlan, template, draft = {}) {
  const layoutDesign = visualPlan?.layoutDesign;
  if (!layoutDesign || typeof layoutDesign !== 'object' || Array.isArray(layoutDesign)) return undefined;
  if (layoutDesign.templateVersionId) return layoutDesign.templateVersionId === template.currentVersionId ? layoutDesign : undefined;
  if (layoutDesign.templateId) return layoutDesign.templateId === template.id ? layoutDesign : undefined;
  return draft.layoutTemplateVersionId === template.currentVersionId ? layoutDesign : undefined;
}

function registerWechatLayoutTemplateRoutes(app, {
  workspaceAccess,
  templateStore,
  resolveTaskRoute,
  analyzeTemplateSource,
  runOmniTask,
  runTextTask,
  recordUsage,
  transaction,
  draftStore,
  renderWechatDraft,
}) {
  if ([resolveTaskRoute, analyzeTemplateSource, runTextTask, recordUsage, transaction, renderWechatDraft].some((dependency) => typeof dependency !== 'function') || typeof draftStore?.get !== 'function') {
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

  app.patch('/api/v1/wechat-layout-templates/:templateId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const input = z.object({ name, rules }).parse(request.body);
    return templateStore.update(request.workspace.id, uuid.parse(request.params.templateId), { ...input, sourceType: 'MANUAL', userId: request.user.sub });
  });

  app.post('/api/v1/wechat-layout-templates/:templateId/duplicate', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const input = z.object({ name }).parse(request.body);
    const duplicated = await templateStore.duplicate(request.workspace.id, uuid.parse(request.params.templateId), input.name, request.user.sub);
    reply.code(201).send(duplicated);
  });

  app.post('/api/v1/wechat-layout-templates/:templateId/archive', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    await templateStore.archive(request.workspace.id, uuid.parse(request.params.templateId));
    reply.code(204).send();
  });

  app.post('/api/v1/wechat-layout-templates/:templateId/preview', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    const templateId = uuid.parse(request.params.templateId);
    const input = z.object({ draftId: uuid }).parse(request.body);
    const [template, draft] = await Promise.all([
      templateStore.get(request.workspace.id, templateId),
      draftStore.get(request.workspace.id, input.draftId),
    ]);
    if (draft.platform !== 'WECHAT') {
      const error = new Error('只有公众号母稿需要排版预览。');
      error.statusCode = 400;
      error.code = 'DRAFT_PLATFORM_UNSUPPORTED';
      throw error;
    }
    const rendered = renderWechatDraft({
      title: draft.title,
      body: draft.body,
      assets: draft.assets,
      templateRules: template.rules,
      layoutAddons: draft.visualPlan?.layoutAddons,
      layoutDesign: layoutDesignForTemplate(draft.visualPlan, template, draft),
      visualPlan: draft.visualPlan,
    });
    return { templateId, templateVersionId: template.currentVersionId, draftId: draft.id, html: rendered.html, checks: rendered.checks };
  });

  app.post('/api/v1/creative/drafts/:draftId/layout/design', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const input = z.object({
      templateId: uuid.optional(),
      templateVersionId: uuid.optional(),
      instruction: z.string().trim().max(1_000).optional(),
    }).parse(request.body);
    const workspaceId = request.workspace.id;
    const draft = await draftStore.get(workspaceId, uuid.parse(request.params.draftId));
    if (draft.platform !== 'WECHAT') {
      const error = new Error('只有公众号母稿支持智能精排。');
      error.statusCode = 400;
      error.code = 'DRAFT_PLATFORM_UNSUPPORTED';
      throw error;
    }
    const template = input.templateId
      ? await templateStore.get(workspaceId, input.templateId)
      : (await templateStore.list(workspaceId))[0];
    if (!template) {
      const error = new Error('请先创建或导入一个公众号排版模板。');
      error.statusCode = 409;
      error.code = 'LAYOUT_TEMPLATE_REQUIRED';
      throw error;
    }
    const route = await resolveTaskRoute(workspaceId, WECHAT_LAYOUT_DESIGN_SCOPE, '公众号智能精排');
    const prompt = buildWechatLayoutDesignPrompt({
      title: draft.title,
      body: draft.body,
      assets: draft.assets,
      templateRules: template.rules,
      instruction: input.instruction ?? '',
    });
    const startedAt = Date.now();
    let result;
    let layoutDesign;
    try {
      result = await runTextTask({ workspaceId, route, system: prompt.system, message: prompt.user, maxTokens: 2_000, temperature: 0.2 });
      layoutDesign = {
        ...parseWechatLayoutDesignContent(result.content, { paragraphCount: paragraphCount(draft.body) }),
        templateId: template.id,
        templateVersionId: template.currentVersionId,
      };
    } catch (error) {
      try {
        await recordUsage({ workspaceId, provider: route.provider, model: route.model, operation: WECHAT_LAYOUT_DESIGN_SCOPE, status: 'ERROR', durationMs: Date.now() - startedAt, error: (error instanceof Error ? error.message : '智能精排失败').slice(0, 2_000) });
      } catch (usageError) {
        request.log?.warn?.({ err: usageError, originalError: error }, 'wechat layout design failure usage recording failed');
      }
      throw error;
    }
    const saved = await draftStore.patchWorkingCopy(workspaceId, draft.id, {
      revision: draft.revision,
      visualPlan: { ...(draft.visualPlan ?? {}), layoutDesign },
    });
    await recordUsage({ workspaceId, provider: route.provider, model: route.model, operation: WECHAT_LAYOUT_DESIGN_SCOPE, status: 'SUCCESS', durationMs: Date.now() - startedAt, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    const rendered = renderWechatDraft({
      title: saved.title,
      body: saved.body,
      assets: saved.assets,
      templateRules: template.rules,
      layoutAddons: saved.visualPlan?.layoutAddons,
      layoutDesign: layoutDesignForTemplate(saved.visualPlan, template, saved),
      visualPlan: saved.visualPlan,
    });
    return {
      draft: saved,
      templateId: template.id,
      templateVersionId: template.currentVersionId,
      layoutDesign,
      html: rendered.html,
      checks: rendered.checks,
      policy: { scope: WECHAT_LAYOUT_DESIGN_SCOPE, provider: route.provider, connectionId: route.connectionId ?? null, model: route.model, promptVersion: prompt.promptVersion },
    };
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
        runOmniTask: (task) => (runOmniTask ?? runTextTask)({ ...task, workspaceId }),
      });
    } catch (error) {
      try {
        await recordUsage({ workspaceId, provider: route.provider, model: route.model, operation: WECHAT_TEMPLATE_ANALYSIS_SCOPE, status: 'ERROR', durationMs: Date.now() - startedAt, error: (error instanceof Error ? error.message : '公众号模板分析失败').slice(0, 2_000) });
      } catch (usageError) {
        request.log?.warn?.({ err: usageError, originalError: error }, 'wechat template import failure usage recording failed');
      }
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
