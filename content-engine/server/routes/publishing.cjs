const { z } = require('zod');

const uuid = z.string().uuid();
const accountInput = z.object({
  platform: z.enum(['WECHAT', 'XIAOHONGSHU', 'WEIBO']).default('WECHAT'),
  name: z.string().trim().min(1).max(120),
  externalAccountLabel: z.string().trim().max(200).default(''),
  mode: z.enum(['MANUAL', 'OFFICIAL']).default('MANUAL'),
}).strict();
const packageInput = z.object({
  accountId: uuid,
  draftVersionId: uuid,
}).strict();
const officialCredentialInput = z.object({
  appId: z.string().trim().min(6).max(120),
  appSecret: z.string().trim().min(8).max(200),
}).strict();
const manualConfirmInput = z.object({
  url: z.string().trim().url().max(2000),
  note: z.string().trim().max(1000).default(''),
  publishedAt: z.string().trim().max(80).optional(),
}).strict();
const publicationRegistrationInput = z.object({
  url: z.string().trim().url().max(2000),
}).strict();
const standalonePublicationInput = z.object({
  url: z.string().trim().url().max(2000),
  accountId: uuid.optional(),
}).strict();
const metricInput = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  capturedAt: z.string().trim().max(80).optional(),
  checkpoint: z.enum(['D1', 'D3', 'D7', 'CUSTOM']).default('CUSTOM'),
  exposureCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  readCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  playCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  likeCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  shareCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  favoriteCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  commentCount: z.number().int().min(0).max(999999999).nullable().optional().default(null),
  followerDelta: z.number().int().min(-999999999).max(999999999).nullable().optional().default(null),
  raw: z.record(z.string(), z.unknown()).optional(),
}).strict();
const metricSyncInput = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkpoint: z.enum(['D1', 'D3', 'D7', 'CUSTOM']).optional(),
  capturedAt: z.string().trim().max(80).optional(),
}).strict();
const retrospectiveInput = z.object({
  summary: z.string().trim().max(8000).default(''),
  highlights: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  issues: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  nextActions: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
}).strict();

function registerPublishingRoutes(app, { workspaceAccess, publishingStore, detectPublicIpv4 }) {
  app.get('/api/v1/channel-accounts', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { accounts: await publishingStore.listAccounts(request.workspace.id) };
  });

  app.post('/api/v1/channel-accounts', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const account = await publishingStore.createAccount(request.workspace.id, request.user.sub, accountInput.parse(request.body ?? {}));
    reply.code(201);
    return { account };
  });

  app.delete('/api/v1/channel-accounts/:accountId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return { account: await publishingStore.archiveAccount(request.workspace.id, uuid.parse(request.params.accountId)) };
  });

  app.put('/api/v1/channel-accounts/:accountId/official-credential', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
    const account = await publishingStore.saveOfficialCredential(request.workspace.id, uuid.parse(request.params.accountId), officialCredentialInput.parse(request.body ?? {}));
    return { account };
  });

  app.post('/api/v1/channel-accounts/:accountId/official-credential/test', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
    const account = await publishingStore.testOfficialCredential(request.workspace.id, uuid.parse(request.params.accountId));
    return { account };
  });

  app.get('/api/v1/channel-accounts/official-network', { preHandler: workspaceAccess.forRole('OWNER') }, async () => {
    return { network: await detectPublicIpv4() };
  });

  app.get('/api/v1/publishing/ready-drafts', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { drafts: await publishingStore.readyDrafts(request.workspace.id) };
  });

  app.post('/api/v1/publishing/packages', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const result = await publishingStore.createManualPackage(request.workspace.id, request.user.sub, packageInput.parse(request.body ?? {}));
    reply.code(201);
    return result;
  });

  app.post('/api/v1/publishing/official-drafts', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const result = await publishingStore.createOfficialDraft(request.workspace.id, request.user.sub, packageInput.parse(request.body ?? {}));
    reply.code(201);
    return result;
  });

  app.get('/api/v1/publishing/tasks', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { tasks: await publishingStore.listTasks(request.workspace.id) };
  });

  app.post('/api/v1/publishing/tasks/:taskId/manual-confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return publishingStore.registerPublication(request.workspace.id, request.user.sub, uuid.parse(request.params.taskId), manualConfirmInput.parse(request.body ?? {}));
  });

  app.post('/api/v1/publishing/tasks/:taskId/register-publication', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return publishingStore.registerPublication(request.workspace.id, request.user.sub, uuid.parse(request.params.taskId), publicationRegistrationInput.parse(request.body ?? {}));
  });

  app.post('/api/v1/publishing/articles/register', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const result = await publishingStore.registerStandalonePublication(request.workspace.id, request.user.sub, standalonePublicationInput.parse(request.body ?? {}));
    reply.code(201);
    return result;
  });

  app.get('/api/v1/publishing/articles', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { articles: await publishingStore.listPublications(request.workspace.id) };
  });

  app.delete('/api/v1/publishing/articles/:articleId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    return publishingStore.deletePublication(request.workspace.id, uuid.parse(request.params.articleId));
  });

  app.post('/api/v1/publishing/articles/:articleId/metrics', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
    const metric = await publishingStore.addMetricSnapshot(request.workspace.id, request.user.sub, uuid.parse(request.params.articleId), metricInput.parse(request.body ?? {}));
    reply.code(201);
    return { metric };
  });

  app.get('/api/v1/publishing/articles/:articleId/metrics', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
    return { metrics: await publishingStore.listMetricSnapshots(request.workspace.id, uuid.parse(request.params.articleId)) };
  });

  app.post('/api/v1/publishing/articles/:articleId/metrics/sync', { preHandler: workspaceAccess.forRole('OWNER') }, async (request, reply) => {
    const metric = await publishingStore.syncMetrics(request.workspace.id, request.user.sub, uuid.parse(request.params.articleId), metricSyncInput.parse(request.body ?? {}));
    reply.code(201);
    return { metric };
  });

  app.post('/api/v1/publishing/articles/metrics/sync-all', { preHandler: workspaceAccess.forRole('OWNER') }, async (request, reply) => {
    const result = await publishingStore.syncMetricsForAll(request.workspace.id, request.user.sub, metricSyncInput.parse(request.body ?? {}));
    reply.code(200);
    return result;
  });

  app.put('/api/v1/publishing/articles/:articleId/retrospective', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
    const retrospective = await publishingStore.saveRetrospective(request.workspace.id, request.user.sub, uuid.parse(request.params.articleId), retrospectiveInput.parse(request.body ?? {}));
    return { retrospective };
  });
}

module.exports = { registerPublishingRoutes };
