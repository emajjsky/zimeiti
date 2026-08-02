const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const multipart = require('@fastify/multipart');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');
const config = require('./config.cjs');
const { query, transaction } = require('./db.cjs');
const { encrypt, decrypt, hashPassword, verifyPassword } = require('./crypto.cjs');
const { clipPublicLink, readPublicArticle, fetchPublicPage } = require('./services/public-web.cjs');
const { searchTavily, searchTavilyImages } = require('./services/tavily.cjs');
const { listSources, createSources, updateSource, removeSource, listItems, saveItem, refreshWorkspaceRss } = require('./services/intelligenceRepository.cjs');
const { enqueue } = require('./queue.cjs');
const { listAvailableSkills } = require('./agent/skillRegistry.cjs');
const { runBailianCli } = require('./runner/bailian.cjs');
const { ANALYSIS_SCOPE, createTemplateStore, prepareAnalysisInput } = require('./services/intelligence-analysis.cjs');
const { createCreativeSkillStore } = require('./services/creativeSkills.cjs');
const { writingBriefInput } = require('./services/writing-brief.cjs');
const { businessError, errorPayload } = require('./services/business-errors.cjs');
const { createWorkspaceStore, workspaceView } = require('./services/workspaces.cjs');
const { createWorkspaceAccess } = require('./services/workspace-context.cjs');
const { accountVoiceInput, accountVoiceCalibrationInput, createAccountVoiceStore } = require('./services/accountVoices.cjs');
const { accountVoiceCalibrationDraftInput, buildVoiceCalibrationPrompt, buildVoiceCalibrationRepairPrompt, parseVoiceCalibrationDraft, voiceCalibrationErrorMessage } = require('./services/voiceCalibration.cjs');
const { createTextModelRunner } = require('./services/text-model.cjs');
const {
  VISUAL_PLANNING_SCOPE,
  VISUAL_PLANNING_OPERATION,
  VISUAL_PLANNING_PROMPT_VERSION,
  buildVisualPlanningPrompt,
  buildVisualPlanningRepairPrompt,
  parseVisualPlanningContent,
  mergePlannedItems,
  validateVisualPlanImageCount,
} = require('./services/visual-planning.cjs');
const {
  confirmProjectPlanning,
  createBlankProject,
  createProjectFromIntelligence,
  loadCreativeState,
  normalizeProject,
  saveProjectPlanning,
  saveWorkspacePreferences,
  updateCreativeProjects,
  writePlanningVersion,
} = require('./services/project-planning.cjs');
const { createProjectMaterialStore } = require('./services/projectMaterials.cjs');
const { createProjectAgentStore, artifactView, runView } = require('./services/project-agent.cjs');
const { loadContentMasterState } = require('./services/content-master.cjs');
const { createAssetStore } = require('./services/assets.cjs');
const { createContentDraftStore } = require('./services/content-drafts.cjs');
const { createDraftAdaptationService } = require('./services/draft-adaptation.cjs');
const { registerContentDraftRoutes } = require('./routes/content-drafts.cjs');
const { renderWechatDraft } = require('./services/wechat-layout-renderer.cjs');
const { analyzeWechatTemplateSource, createWechatLayoutTemplateStore } = require('./services/wechat-layout-templates.cjs');
const { registerWechatLayoutTemplateRoutes } = require('./routes/wechat-layout-templates.cjs');
const { detectFileType, safePath, saveUploadedAsset, saveRemoteImageAsset, openAsset, readAssetText, removeAssetFile } = require('./services/assetStorage.cjs');
const { PROJECT_RESEARCH_ACTION_VERSION, PROJECT_RESEARCH_SCOPE, researchRunView, researchPlanView } = require('./services/project-research.cjs');
const { PROJECT_RESEARCH_SOURCES_VERSION, researchSourceActions } = require('./services/project-research-sources.cjs');
const { SOURCE_VERIFICATION_SCOPE, SOURCE_VERIFICATION_VERSION, defaultSourceVerificationTemplate, validateSourceVerificationTemplate } = require('./services/source-verification.cjs');
const { SIMPLIFIED_RESEARCH_WORKFLOW_VERSION } = require('./services/simplified-research.cjs');
const { OUTLINE_ACTION_VERSION, OUTLINE_SCOPE, OUTLINE_TEMPLATE_SCOPES, outlineTemplateScope, validateOutlineTemplate, defaultOutlineTemplate, outlineCandidateView } = require('./services/creative-outline.cjs');
const { DRAFT_ACTION_VERSION, DRAFT_SCOPE, DRAFT_TEMPLATE_SCOPES, draftTemplateScope, validateDraftTemplate, defaultDraftTemplate, draftCandidateView } = require('./services/creative-draft.cjs');
const {
  COPY_ACTIONS,
  WECHAT_COPY_GENERATION_SCOPE,
  REVISION_TEMPLATE_SCOPES,
  applyAcceptedCopyToState,
  copyActionScope,
  copyActionVersion,
  copyPromptTemplateScope,
  mergeFactsToVerify,
  resolveCopyAction,
  validateRevisionTemplate,
  defaultRevisionTemplate,
} = require('./services/project-copy-action.cjs');

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
const credentials = new Set(['TAVILY', 'BAILIAN']);
const modelTasks = [
  'INTELLIGENCE_ANALYSIS', 'SOURCE_VERIFICATION', 'TOPIC_RECOMMENDATION', 'VOICE_CALIBRATION',
  'WECHAT_COPY_GENERATION', 'WECHAT_VISUAL_PLANNING', 'WECHAT_TEMPLATE_ANALYSIS',
  'XIAOHONGSHU_ADAPTATION', 'WEIBO_ADAPTATION', 'CONTENT_PREFLIGHT_REVIEW',
  'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'SPEECH_SYNTHESIS', 'SPEECH_RECOGNITION',
  'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO', 'FIRST_LAST_FRAME_TO_VIDEO', 'REFERENCE_TO_VIDEO', 'VIDEO_EDIT',
];
const externalProviders = new Set(['DASHSCOPE', 'SILICONFLOW', 'VOLCENGINE_ARK', 'KIMI', 'ZHIPU', 'OPENAI', 'OPENAI_COMPATIBLE']);
const creativePlatform = z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']);
const analysisPlatform = z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL']);
const creativePlatformNames = { WECHAT: '公众号', XIAOHONGSHU: '小红书', ZHIHU: '知乎', WEIBO: '微博' };
const sourceInput = z.object({ name: z.string().max(160), type: z.literal('RSS'), url: z.string().url().max(2_000), category: z.string().max(120), includeKeywords: z.array(z.string().max(120)).optional(), excludeKeywords: z.array(z.string().max(120)).optional(), language: z.enum(['ALL', 'ZH', 'EN']).optional(), enabled: z.boolean(), refreshMinutes: z.number().min(5).max(10_080), trust: z.string().max(80) });
const projectPlanningInput = z.object({
  title: z.string().trim().max(160),
  category: z.string().trim().max(120),
  angle: z.string().trim().max(2_000),
  objective: z.string().trim().max(2_000),
  targetAudience: z.string().trim().max(1_000),
  coreMessage: z.string().trim().max(4_000),
  targetPlatforms: z.array(analysisPlatform).min(1).max(5),
  timing: z.enum(['TODAY', 'THREE_DAYS', 'ONE_WEEK', 'EVERGREEN']),
  plannedPublishAt: z.string().trim().max(80).optional(),
  sourceRequirements: z.string().max(8_000),
  constraints: z.string().max(8_000),
});
const visualGenerationInput = z.object({
  platform: z.literal('WECHAT'),
  prompt: z.string().trim().min(4).max(8_000),
  size: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).default('3:4'),
  assetIds: z.array(z.string().uuid()).max(3).default([]),
});
const visualStylePreset = z.enum([
  'FRESH_EDITORIAL', 'BUSINESS_EDITORIAL', 'SWISS_GRID', 'DOCUMENTARY', 'CINEMATIC_DOCUMENTARY', 'MONO_EDITORIAL', 'NEWSPAPER_EDITORIAL', 'LIFESTYLE_PHOTO',
  'MINIMAL_KNOWLEDGE', 'DATA_VISUAL', 'BLUEPRINT_DIAGRAM', 'HAND_DRAWN_NOTES', 'CONSULTING_REPORT', 'SCIENCE_ATLAS',
  'RETRO_POP', 'MACARON_CARTOON', 'PAPER_COLLAGE', 'FLAT_GEOMETRIC', 'SOFT_3D', 'PENCIL_SKETCH', 'PIXEL_RETRO',
  'NEW_CHINESE', 'INK_WASH', 'GUOCHAO_POSTER', 'WOODCUT_PRINT', 'TECH_MEDIA', 'CYBER_TECH', 'INDUSTRIAL_MEDIA',
]);
const visualReferenceUse = z.enum(['COLOR', 'COMPOSITION', 'LAYOUT', 'TEXTURE', 'SUBJECT']);
const visualPlanItemInput = z.object({
  id: z.string().trim().min(1).max(100),
  role: z.enum(['COVER', 'BODY', 'CARD', 'MAIN']),
  title: z.string().trim().min(1).max(120),
  placement: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(500),
  visualType: z.enum(['NEWS_PHOTO', 'HERO_VISUAL', 'CONCEPT_DIAGRAM', 'SCENE', 'MIND_MAP', 'FLOWCHART', 'TIMELINE', 'COMPARISON', 'DATA_CHART', 'QUOTE_CARD', 'INFO_CARD', 'CHECKLIST_CARD']),
  focus: z.string().trim().min(1).max(500),
  avoidConcepts: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  searchQueries: z.array(z.string().trim().min(2).max(120)).min(1).max(5),
  generationMode: z.enum(['ILLUSTRATION', 'INFOGRAPHIC']),
  informationPoints: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
  stylePreset: z.union([z.literal('INHERIT'), visualStylePreset]),
  templatePreset: z.string().trim().min(1).max(80),
  sourceExcerpt: z.string().trim().max(4_000).default(''),
  contentBlocks: z.array(z.object({ label: z.string().trim().min(1).max(80), detail: z.string().trim().min(1).max(300) })).min(1).max(8),
  references: z.array(z.object({ assetId: z.string().uuid(), uses: z.array(visualReferenceUse).min(1).max(5) })).max(3).default([]),
  prompt: z.string().trim().min(4).max(8_000),
  size: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']),
  assetId: z.string().uuid().nullable(),
});
const visualPlanningInput = z.object({
  platform: z.literal('WECHAT'),
  bodyItemCount: z.number().int().min(0).max(11),
  styleProfile: z.object({
    preset: visualStylePreset,
    customPrompt: z.string().trim().max(1_200).default(''),
  }),
  request: z.string().trim().max(2_000).default(''),
  currentItemId: z.string().trim().min(1).max(100).optional(),
  currentPlan: z.array(z.record(z.string(), z.unknown())).max(12).default([]),
  keepAssignedAssets: z.boolean().default(true),
});
const createProjectInput = z.object({
  originType: z.enum(['MANUAL', 'DRAFT', 'IMPORT']).default('MANUAL'),
  title: z.string().trim().max(160).default(''),
  category: z.string().trim().max(120).default(''),
  draftText: z.string().max(50_000).optional(),
  importUrl: z.string().url().max(2_000).optional(),
  targetPlatforms: z.array(analysisPlatform).max(5).default([]),
});
const templateStore = createTemplateStore({ query }, {
  [SOURCE_VERIFICATION_SCOPE]: { defaultTemplate: defaultSourceVerificationTemplate, validateTemplate: validateSourceVerificationTemplate },
  [WECHAT_COPY_GENERATION_SCOPE]: { defaultTemplate: () => defaultDraftTemplate('WECHAT'), validateTemplate: validateDraftTemplate },
  [OUTLINE_TEMPLATE_SCOPES.WECHAT]: { defaultTemplate: () => defaultOutlineTemplate('WECHAT'), validateTemplate: validateOutlineTemplate },
  [OUTLINE_TEMPLATE_SCOPES.XIAOHONGSHU]: { defaultTemplate: () => defaultOutlineTemplate('XIAOHONGSHU'), validateTemplate: validateOutlineTemplate },
  [OUTLINE_TEMPLATE_SCOPES.ZHIHU]: { defaultTemplate: () => defaultOutlineTemplate('ZHIHU'), validateTemplate: validateOutlineTemplate },
  [OUTLINE_TEMPLATE_SCOPES.WEIBO]: { defaultTemplate: () => defaultOutlineTemplate('WEIBO'), validateTemplate: validateOutlineTemplate },
  [DRAFT_TEMPLATE_SCOPES.WECHAT]: { defaultTemplate: () => defaultDraftTemplate('WECHAT'), validateTemplate: validateDraftTemplate },
  [DRAFT_TEMPLATE_SCOPES.XIAOHONGSHU]: { defaultTemplate: () => defaultDraftTemplate('XIAOHONGSHU'), validateTemplate: validateDraftTemplate },
  [DRAFT_TEMPLATE_SCOPES.ZHIHU]: { defaultTemplate: () => defaultDraftTemplate('ZHIHU'), validateTemplate: validateDraftTemplate },
  [DRAFT_TEMPLATE_SCOPES.WEIBO]: { defaultTemplate: () => defaultDraftTemplate('WEIBO'), validateTemplate: validateDraftTemplate },
  [REVISION_TEMPLATE_SCOPES.WECHAT]: { defaultTemplate: () => defaultRevisionTemplate('WECHAT'), validateTemplate: validateRevisionTemplate },
  [REVISION_TEMPLATE_SCOPES.XIAOHONGSHU]: { defaultTemplate: () => defaultRevisionTemplate('XIAOHONGSHU'), validateTemplate: validateRevisionTemplate },
  [REVISION_TEMPLATE_SCOPES.ZHIHU]: { defaultTemplate: () => defaultRevisionTemplate('ZHIHU'), validateTemplate: validateRevisionTemplate },
  [REVISION_TEMPLATE_SCOPES.WEIBO]: { defaultTemplate: () => defaultRevisionTemplate('WEIBO'), validateTemplate: validateRevisionTemplate },
});
const accountVoiceStore = createAccountVoiceStore({ query, transaction });
const textRunner = createTextModelRunner();
const creativeSkillStore = createCreativeSkillStore({ query, transaction, accountVoiceStore });
const projectMaterialStore = createProjectMaterialStore({ query });
const projectAgentStore = createProjectAgentStore({ query, transaction });
const projectScope = z.enum(['PROJECT', 'RESEARCH', 'WRITING', 'IMAGING']);
const projectPlatforms = z.array(creativePlatform).max(4);
const projectInputPayload = z.object({
  kind: z.enum(['IDEA', 'DRAFT', 'NOTE', 'TRANSCRIPT']),
  title: z.string().trim().max(160).default(''),
  body: z.string().trim().min(1).max(50_000),
  scope: projectScope,
  platforms: projectPlatforms.default([]),
});
const projectReferenceRole = z.enum(['FACT', 'OPINION', 'STRUCTURE', 'VOICE', 'HOOK', 'VISUAL', 'NEGATIVE']);
const projectReferenceMetadata = z.object({
  role: projectReferenceRole,
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4_000).default(''),
  scope: projectScope,
  platforms: projectPlatforms.default([]),
});
const projectResearchInput = z.object({
  request: z.string().trim().min(1).max(2_000),
  inputIds: z.array(z.string().uuid()).max(20).default([]),
  referenceIds: z.array(z.string().uuid()).max(20).default([]),
  assetIds: z.array(z.string().uuid()).max(20).default([]),
}).superRefine((value, context) => {
  const materialCount = value.inputIds.length + value.referenceIds.length + value.assetIds.length;
  if (materialCount === 0) context.addIssue({ code: 'custom', path: ['inputIds'], message: '请至少选择一条项目资料。' });
  if (materialCount > 20) context.addIssue({ code: 'custom', path: ['inputIds'], message: '单次最多选择 20 条项目资料。' });
});
const projectAgentQuery = z.object({
  stage: z.enum(['RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW']),
  platform: creativePlatform.optional(),
  history: z.enum(['CURRENT', 'ALL']).default('CURRENT'),
});
const agentPrepareInput = z.object({
  stage: z.enum(['RESEARCH', 'COPY']),
  platform: creativePlatform.optional(),
  request: z.string().trim().min(1).max(2_000),
  selection: z.object({
    text: z.string().trim().min(1).max(12_000),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).refine((value) => value.end > value.start, '选区结束位置必须大于开始位置。').optional(),
  inputIds: z.array(z.string().uuid()).max(20).default([]),
  referenceIds: z.array(z.string().uuid()).max(20).default([]),
  assetIds: z.array(z.string().uuid()).max(20).default([]),
});
const simplifiedResearchStartInput = z.object({
  request: z.string().trim().max(2_000).optional(),
});
app.register(cors, { origin: config.corsOrigin, credentials: false });
app.register(jwt, { secret: config.jwtSecret });
app.register(multipart, { limits: { files: 1, fileSize: 50 * 1024 * 1024, fields: 8 } });

app.setErrorHandler((error, _request, reply) => {
  const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
  reply.code(status).send({ error: errorPayload(error) });
});

async function authenticate(request) { await request.jwtVerify(); }

function defaultState(name) {
  return { workspace: { primaryTopics: [], enabledPlatforms: ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'], setupCompleted: false }, feishuTemplate: { name: `${name}内容库`, topicStorage: 'ONE_TABLE', includeSchedule: true, includeReview: false, status: 'DRAFT' }, sources: [], intelligence: [], projects: [] };
}

const initializeWorkspace = (client, workspaceId) => client.query('SELECT seed_wechat_layout_templates($1)', [workspaceId]);
const workspaceStore = createWorkspaceStore({ query, transaction, defaultState, initializeWorkspace });
const workspaceAccess = createWorkspaceAccess({ query, authenticate });
const assetStore = createAssetStore({ query, transaction, removeStoredFile: (storageKey) => removeAssetFile(config.uploadRoot, storageKey) });
const draftStore = createContentDraftStore({ query, transaction, renderWechatDraft });
const draftAdaptationService = createDraftAdaptationService({ query, transaction, draftStore, resolveTaskRoute: textTaskRoute, enqueue });
const wechatLayoutTemplateStore = createWechatLayoutTemplateStore({ query, transaction });
registerContentDraftRoutes(app, { workspaceAccess, draftStore, assetStore, adaptationService: draftAdaptationService });
registerWechatLayoutTemplateRoutes(app, {
  workspaceAccess,
  templateStore: wechatLayoutTemplateStore,
  transaction,
  draftStore,
  renderWechatDraft,
  resolveTaskRoute: textTaskRoute,
  analyzeTemplateSource: (input) => analyzeWechatTemplateSource({ ...input, fetchPublicPage }),
  runTextTask: async ({ workspaceId, route, system, message, maxTokens, temperature }) => {
    const connectionInput = await textConnectionInput(workspaceId, route);
    return textRunner.runText({
      provider: route.provider === 'BAILIAN_CLI' ? 'BAILIAN_CLI' : 'EXTERNAL_API',
      model: route.model,
      system,
      message,
      maxTokens,
      temperature,
      ...connectionInput,
    });
  },
  recordUsage: ({ workspaceId, provider, model, operation, status, durationMs, inputTokens, outputTokens, error }, client = { query }) => client.query(`INSERT INTO api_usage_logs
    (workspace_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [workspaceId, provider, model, operation, status, durationMs, inputTokens ?? null, outputTokens ?? null, error ?? null]),
});

const authInput = z.object({ email: z.string().email().max(320), password: z.string().min(8).max(200), displayName: z.string().min(1).max(80).optional(), workspaceName: z.string().min(1).max(80).optional() });

app.get('/health', async () => ({ ok: true, service: 'content-engine-api' }));

app.post('/api/v1/auth/register', async (request, reply) => {
  const input = authInput.parse(request.body);
  const email = input.email.trim().toLowerCase();
  const user = await transaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount) { const error = new Error('该邮箱已注册，请直接登录。'); error.statusCode = 409; throw error; }
    const createdUser = await client.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name', [email, hashPassword(input.password), input.displayName?.trim() || email.split('@')[0]]);
    const createdWorkspace = await client.query('INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id, name, status', [input.workspaceName?.trim() || `${createdUser.rows[0].display_name}的内容工作室`, createdUser.rows[0].id]);
    await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [createdWorkspace.rows[0].id, createdUser.rows[0].id, 'OWNER']);
    await client.query('INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2)', [createdWorkspace.rows[0].id, JSON.stringify(defaultState(createdWorkspace.rows[0].name))]);
    await initializeWorkspace(client, createdWorkspace.rows[0].id);
    await client.query('INSERT INTO user_workspace_preferences (user_id, active_workspace_id) VALUES ($1, $2)', [createdUser.rows[0].id, createdWorkspace.rows[0].id]);
    return { user: createdUser.rows[0], workspace: workspaceView({ ...createdWorkspace.rows[0], role: 'OWNER' }) };
  });
  const accessToken = app.jwt.sign({ sub: user.user.id, email: user.user.email });
  reply.code(201).send({ user: user.user, workspaces: [user.workspace], activeWorkspaceId: user.workspace.id, accessToken });
});

app.post('/api/v1/auth/login', async (request) => {
  const input = authInput.pick({ email: true, password: true }).parse(request.body);
  const result = await query('SELECT id, email, display_name, password_hash FROM users WHERE email = $1', [input.email.trim().toLowerCase()]);
  if (!result.rowCount || !verifyPassword(input.password, result.rows[0].password_hash)) { const error = new Error('邮箱或密码错误。'); error.statusCode = 401; throw error; }
  const user = result.rows[0];
  return { user: { id: user.id, email: user.email, display_name: user.display_name }, ...await workspaceStore.sessionForUser(user.id), accessToken: app.jwt.sign({ sub: user.id, email: user.email }) };
});

app.get('/api/v1/auth/me', { preHandler: authenticate }, async (request) => {
  const result = await query('SELECT id, email, display_name FROM users WHERE id = $1', [request.user.sub]);
  if (!result.rows.length) throw businessError(401, 'AUTH_INVALID', '登录状态已失效，请重新登录。');
  const user = result.rows[0];
  return { user, ...await workspaceStore.sessionForUser(user.id), accessToken: app.jwt.sign({ sub: user.id, email: user.email }) };
});

app.get('/api/v1/workspaces', { preHandler: authenticate }, async (request) => workspaceStore.sessionForUser(request.user.sub));

app.post('/api/v1/workspaces', { preHandler: authenticate }, async (request, reply) => {
  const input = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
  await workspaceStore.create(request.user.sub, input.name);
  reply.code(201).send(await workspaceStore.sessionForUser(request.user.sub));
});

app.patch('/api/v1/workspaces/:workspaceId', { preHandler: authenticate }, async (request) => {
  const workspaceId = z.string().uuid().parse(request.params.workspaceId);
  const input = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
  await workspaceStore.rename(request.user.sub, workspaceId, input.name);
  return workspaceStore.sessionForUser(request.user.sub);
});

app.get('/api/v1/workspaces/:workspaceId/deletion-impact', { preHandler: authenticate }, async (request) => {
  const workspaceId = z.string().uuid().parse(request.params.workspaceId);
  return workspaceStore.deletionImpact(request.user.sub, workspaceId);
});

app.delete('/api/v1/workspaces/:workspaceId', { preHandler: authenticate }, async (request, reply) => {
  if (!config.workspaceDeletionEnabled) throw businessError(503, 'WORKSPACE_DELETE_DISABLED', '当前部署未开放工作空间永久删除。');
  const workspaceId = z.string().uuid().parse(request.params.workspaceId);
  const input = z.object({ confirmationName: z.string().max(80) }).parse(request.body);
  const requested = await workspaceStore.requestDeletion(request.user.sub, workspaceId, input.confirmationName);
  let queued = true;
  try { await enqueue(requested.job); } catch { queued = false; }
  reply.code(202).send({ ...(await workspaceStore.sessionForUser(request.user.sub)), deletionJobId: requested.deletionJob.id, queueJobId: requested.job.id, queued });
});

app.put('/api/v1/me/active-workspace', { preHandler: authenticate }, async (request) => {
  const input = z.object({ workspaceId: z.string().uuid() }).parse(request.body);
  return workspaceStore.select(request.user.sub, input.workspaceId);
});

app.get('/api/v1/workspace/state', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const [snapshot, state] = await Promise.all([
    query('SELECT revision, updated_at FROM workspace_snapshots WHERE workspace_id = $1', [workspace.id]),
    loadCreativeState({ query }, workspace.id),
  ]);
  const defaults = defaultState(workspace.name);
  return {
    workspace,
    state: { ...defaults, ...state, workspace: { ...defaults.workspace, ...state.workspace, name: workspace.name } },
    revision: snapshot.rows[0]?.revision ?? 1,
    updatedAt: snapshot.rows[0]?.updated_at ?? new Date().toISOString(),
  };
});

app.patch('/api/v1/workspace/preferences', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const body = z.object({
    workspace: z.object({
      primaryTopics: z.array(z.string().trim().min(1).max(80)).max(30),
      accountPositioning: z.string().max(2_000).optional(),
      targetAudience: z.string().max(2_000).optional(),
      enabledPlatforms: z.array(analysisPlatform).min(1).max(5),
      setupCompleted: z.boolean(),
    }).optional(),
    feishuTemplate: z.object({
      name: z.string().trim().min(1).max(120),
      topicStorage: z.enum(['ONE_TABLE', 'BY_CATEGORY']),
      includeSchedule: z.boolean(),
      includeReview: z.boolean(),
      status: z.enum(['DRAFT', 'READY_TO_CREATE', 'CREATED']),
    }).optional(),
  }).refine((value) => value.workspace || value.feishuTemplate, { message: '请提交要保存的工作空间设置。' }).parse(request.body);
  const workspace = request.workspace;
  const result = await transaction((client) => saveWorkspacePreferences(client, workspace.id, body));
  return { revision: result.revision, updatedAt: result.updated_at };
});

const assetKind = z.enum(['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'OTHER']);
const assetOrigin = z.enum(['UPLOAD', 'AI_GENERATED', 'WEB_IMPORT']);
const assetStatus = z.enum(['ACTIVE', 'ARCHIVED']);
const assetCopyrightStatus = z.enum(['PENDING', 'OWNED', 'LICENSED', 'OPEN_LICENSE', 'PROHIBITED']);
const assetMetadata = z.object({
  title: z.string().trim().min(1).max(200),
  sourceNote: z.string().max(4_000).default(''),
  copyrightStatus: assetCopyrightStatus.default('PENDING'),
});
const assetLinkInput = z.object({
  role: projectReferenceRole,
  scope: projectScope,
  title: z.string().trim().max(200).default(''),
  notes: z.string().max(4_000).default(''),
  platforms: projectPlatforms.default([]),
});

function encodedDispositionFilename(value) {
  return encodeURIComponent(String(value || 'asset')).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function persistStoredAsset(workspace, userId, stored, metadata) {
  try {
    return await assetStore.createFromStoredFile(workspace.id, userId, stored, metadata);
  } catch (error) {
    await removeAssetFile(config.uploadRoot, stored.storageKey).catch(() => {});
    throw error;
  }
}

app.get('/api/v1/assets', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const filters = z.object({
    status: assetStatus.optional(),
    kind: assetKind.optional(),
    origin: assetOrigin.optional(),
    query: z.string().trim().max(200).optional(),
  }).parse(request.query);
  return { assets: await assetStore.list(request.workspace.id, filters) };
});

app.post('/api/v1/assets', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const queryInput = assetMetadata.partial({ title: true }).parse(request.query);
  const part = await request.file();
  if (!part) throw businessError(400, 'ASSET_FILE_REQUIRED', '请选择要上传的文件。');
  const stored = await saveUploadedAsset(config.uploadRoot, request.workspace.id, part);
  const result = await persistStoredAsset(request.workspace, request.user.sub, stored, {
    origin: 'UPLOAD',
    title: queryInput.title || stored.originalFilename,
    sourceNote: queryInput.sourceNote,
    copyrightStatus: queryInput.copyrightStatus,
  });
  reply.code(result.created ? 201 : 200).send(result);
});

app.post('/api/v1/assets/import', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = assetMetadata.extend({
    url: z.string().url().max(2_000).refine((value) => /^https?:\/\//i.test(value), '只支持 HTTP(S) 公开图片。'),
  }).parse(request.body);
  const stored = await saveRemoteImageAsset(config.uploadRoot, request.workspace.id, input.url);
  const result = await persistStoredAsset(request.workspace, request.user.sub, stored, {
    origin: 'WEB_IMPORT',
    title: input.title,
    sourceUrl: stored.sourceUrl,
    sourceNote: input.sourceNote,
    copyrightStatus: input.copyrightStatus,
  });
  reply.code(result.created ? 201 : 200).send(result);
});

app.get('/api/v1/assets/:assetId', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const assetId = z.string().uuid().parse(request.params.assetId);
  return assetStore.get(request.workspace.id, assetId);
});

app.get('/api/v1/assets/:assetId/content', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request, reply) => {
  const assetId = z.string().uuid().parse(request.params.assetId);
  const asset = await assetStore.getStored(request.workspace.id, assetId);
  if (asset.status === 'DELETING') throw businessError(404, 'ASSET_NOT_FOUND', '没有找到可读取的素材。');
  reply
    .type(asset.mime_type)
    .header('Content-Length', asset.size_bytes)
    .header('Cache-Control', 'private, max-age=3600')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', 'sandbox')
    .header('Content-Disposition', `inline; filename*=UTF-8''${encodedDispositionFilename(asset.original_filename)}`);
  return reply.send(openAsset(config.uploadRoot, asset.storage_key));
});

app.patch('/api/v1/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const assetId = z.string().uuid().parse(request.params.assetId);
  const input = assetMetadata.extend({ status: assetStatus }).parse(request.body);
  return assetStore.update(request.workspace.id, assetId, input);
});

app.delete('/api/v1/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const assetId = z.string().uuid().parse(request.params.assetId);
  const requested = await assetStore.requestDeletion(request.workspace.id, assetId, request.user.sub);
  let queued = true;
  try { await enqueue(requested.job); } catch { queued = false; }
  reply.code(202).send({ assetId, deletionJobId: requested.deletionJob.id, queueJobId: requested.job.id, queued });
});

app.post('/api/v1/projects/:projectId/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const assetId = z.string().uuid().parse(request.params.assetId);
  const linked = await assetStore.linkToProject(request.workspace.id, projectId, assetId, assetLinkInput.parse(request.body));
  reply.code(201).send(linked);
});

app.delete('/api/v1/projects/:projectId/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const assetId = z.string().uuid().parse(request.params.assetId);
  await assetStore.unlinkFromProject(request.workspace.id, projectId, assetId);
  reply.code(204).send();
});

app.get('/api/v1/settings/credentials', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query(`SELECT provider, status, updated_at, last_tested_at, last_error
    FROM credential_vault WHERE workspace_id = $1 AND provider = ANY($2::text[]) ORDER BY updated_at DESC`, [workspace.id, [...credentials]]);
  const rows = new Map(result.rows.map((row) => [row.provider, credentialView(row.provider, row)]));
  return [...credentials].map((provider) => rows.get(provider) ?? credentialView(provider));
});

app.get('/api/v1/settings/credentials/:provider', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const provider = credentialProvider(request.params.provider);
  const workspace = request.workspace;
  const result = await query('SELECT provider, status, updated_at, last_tested_at, last_error FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspace.id, provider]);
  return credentialView(provider, result.rows[0]);
});

app.put('/api/v1/settings/credentials/:provider', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const provider = credentialProvider(request.params.provider);
  const input = z.object({ apiKey: z.string().min(1).max(1_000) }).parse(request.body);
  const workspace = request.workspace;
  const result = await query(`INSERT INTO credential_vault (workspace_id, provider, encrypted_secret, status, last_tested_at, last_error)
    VALUES ($1, $2, $3, 'UNVERIFIED', NULL, NULL)
    ON CONFLICT (workspace_id, provider) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, status = 'UNVERIFIED', last_tested_at = NULL, last_error = NULL, updated_at = now()
    RETURNING provider, status, updated_at, last_tested_at, last_error`, [workspace.id, provider, encrypt(input.apiKey.trim())]);
  return credentialView(provider, result.rows[0]);
});

app.post('/api/v1/settings/credentials/:provider/test', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const provider = credentialProvider(request.params.provider);
  const workspace = request.workspace;
  const key = await credentialSecret(workspace.id, provider);
  try {
    if (provider === 'BAILIAN') {
      await Promise.all([runBailianCli(['--version'], undefined, 15_000), fetchAvailableModels('https://dashscope.aliyuncs.com/compatible-mode/v1', key)]);
    } else {
      await testTavilyKey(key);
    }
    const result = await query(`UPDATE credential_vault SET status = 'READY', last_tested_at = now(), last_error = NULL, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 RETURNING provider, status, updated_at, last_tested_at, last_error`, [workspace.id, provider]);
    return credentialView(provider, result.rows[0]);
  } catch (error) {
    const message = readableProviderError(provider, error);
    const result = await query(`UPDATE credential_vault SET status = 'ERROR', last_tested_at = now(), last_error = $3, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 RETURNING provider, status, updated_at, last_tested_at, last_error`, [workspace.id, provider, message.slice(0, 2_000)]);
    return credentialView(provider, result.rows[0]);
  }
});

app.delete('/api/v1/settings/credentials/:provider', { preHandler: workspaceAccess.forRole('OWNER') }, async (request, reply) => {
  const provider = credentialProvider(request.params.provider);
  const workspace = request.workspace;
  await transaction(async (client) => {
    await client.query('DELETE FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspace.id, provider]);
    if (provider === 'BAILIAN') {
      await client.query("DELETE FROM model_catalog WHERE workspace_id = $1 AND item_json->>'provider' = 'BAILIAN_CLI'", [workspace.id]);
      await client.query("DELETE FROM agent_model_policies WHERE workspace_id = $1 AND provider = 'BAILIAN_CLI'", [workspace.id]);
    }
  });
  reply.code(204).send();
});

app.get('/api/v1/models/connections', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query(`SELECT id, provider, label, base_url, status, last_tested_at, last_error, updated_at
    FROM model_connections WHERE workspace_id = $1 ORDER BY updated_at DESC`, [workspace.id]);
  return result.rows.map(modelConnectionView);
});

app.post('/api/v1/models/connections', { preHandler: workspaceAccess.forRole('OWNER') }, async (request, reply) => {
  const input = modelConnectionInput(true).parse(request.body);
  const workspace = request.workspace;
  const result = await query(`INSERT INTO model_connections (workspace_id, provider, label, base_url, encrypted_secret)
    VALUES ($1, $2, $3, $4, $5) RETURNING id, provider, label, base_url, status, last_tested_at, last_error, updated_at`, [workspace.id, input.provider, input.label.trim(), normalizedBaseUrl(input.baseUrl), encrypt(input.apiKey.trim())]);
  reply.code(201).send(modelConnectionView(result.rows[0]));
});

app.put('/api/v1/models/connections/:id', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const input = modelConnectionInput(false).parse(request.body);
  const workspace = request.workspace;
  const existing = await query('SELECT encrypted_secret FROM model_connections WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!existing.rowCount) { const error = new Error('未找到外部 API 连接。'); error.statusCode = 404; throw error; }
  const secret = input.apiKey?.trim() ? encrypt(input.apiKey.trim()) : existing.rows[0].encrypted_secret;
  const result = await query(`UPDATE model_connections SET provider = $3, label = $4, base_url = $5, encrypted_secret = $6,
    status = 'UNVERIFIED', last_tested_at = NULL, last_error = NULL, updated_at = now()
    WHERE id = $1 AND workspace_id = $2
    RETURNING id, provider, label, base_url, status, last_tested_at, last_error, updated_at`, [request.params.id, workspace.id, input.provider, input.label.trim(), normalizedBaseUrl(input.baseUrl), secret]);
  return modelConnectionView(result.rows[0]);
});

app.post('/api/v1/models/connections/:id/test', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const existing = await query('SELECT id, base_url, encrypted_secret FROM model_connections WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!existing.rowCount) { const error = new Error('未找到外部 API 连接。'); error.statusCode = 404; throw error; }
  try {
    await fetchAvailableModels(existing.rows[0].base_url, decrypt(existing.rows[0].encrypted_secret));
    const result = await query(`UPDATE model_connections SET status = 'READY', last_tested_at = now(), last_error = NULL, updated_at = now()
      WHERE id = $1 AND workspace_id = $2 RETURNING id, provider, label, base_url, status, last_tested_at, last_error, updated_at`, [request.params.id, workspace.id]);
    return modelConnectionView(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '外部 API 检测失败。';
    const result = await query(`UPDATE model_connections SET status = 'ERROR', last_tested_at = now(), last_error = $3, updated_at = now()
      WHERE id = $1 AND workspace_id = $2 RETURNING id, provider, label, base_url, status, last_tested_at, last_error, updated_at`, [request.params.id, workspace.id, message.slice(0, 2_000)]);
    return modelConnectionView(result.rows[0]);
  }
});

app.delete('/api/v1/models/connections/:id', { preHandler: workspaceAccess.forRole('OWNER') }, async (request, reply) => {
  const workspace = request.workspace;
  await transaction(async (client) => {
    const removed = await client.query('DELETE FROM model_connections WHERE id = $1 AND workspace_id = $2 RETURNING id', [request.params.id, workspace.id]);
    if (!removed.rowCount) { const error = new Error('未找到外部 API 连接。'); error.statusCode = 404; throw error; }
    await client.query("DELETE FROM model_catalog WHERE workspace_id = $1 AND item_json->>'connectionId' = $2", [workspace.id, request.params.id]);
    await client.query('DELETE FROM agent_model_policies WHERE workspace_id = $1 AND connection_id = $2', [workspace.id, request.params.id]);
  });
  reply.code(204).send();
});

app.get('/api/v1/models/catalog', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query('SELECT item_json, updated_at FROM model_catalog WHERE workspace_id = $1 ORDER BY updated_at DESC, id', [workspace.id]);
  return result.rows.map((row) => ({ ...row.item_json, syncedAt: row.updated_at }));
});

app.post('/api/v1/models/catalog/sync', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const items = []; const errors = [];
  const bailian = await query("SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = 'BAILIAN' AND status = 'READY'", [workspace.id]);
  if (bailian.rowCount) {
    try {
      const models = await fetchAvailableModels('https://dashscope.aliyuncs.com/compatible-mode/v1', decrypt(bailian.rows[0].encrypted_secret));
      items.push(...models.map((model) => modelCatalogItem({ provider: 'BAILIAN_CLI', connectionLabel: '阿里云百炼', model, origin: 'ACCOUNT_CATALOG' })));
      items.push(...bailianCliMediaCatalog());
      items.push(...bailianModelMarketCatalog());
    } catch (error) { errors.push({ connectionLabel: '阿里云百炼', message: error instanceof Error ? error.message : '模型目录同步失败。' }); }
  }
  const external = await query("SELECT id, label, base_url, encrypted_secret FROM model_connections WHERE workspace_id = $1 AND status = 'READY'", [workspace.id]);
  for (const connection of external.rows) {
    try {
      const models = await fetchAvailableModels(connection.base_url, decrypt(connection.encrypted_secret));
      items.push(...models.map((model) => modelCatalogItem({ provider: 'EXTERNAL_API', connectionId: connection.id, connectionLabel: connection.label, model })));
    } catch (error) { errors.push({ connectionLabel: connection.label, message: error instanceof Error ? error.message : '模型目录同步失败。' }); }
  }
  const uniqueItems = [...items.reduce((catalog, item) => {
    const current = catalog.get(item.id);
    if (!current || item.origin === 'ACCOUNT_CATALOG') catalog.set(item.id, item);
    return catalog;
  }, new Map()).values()];
  await transaction(async (client) => {
    await client.query('DELETE FROM model_catalog WHERE workspace_id = $1', [workspace.id]);
    for (const item of uniqueItems) await client.query('INSERT INTO model_catalog (workspace_id, id, item_json) VALUES ($1, $2, $3)', [workspace.id, item.id, JSON.stringify(item)]);
  });
  return { items: uniqueItems, errors };
});

app.get('/api/v1/models/task-policies', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query('SELECT scope, provider, connection_id, model, updated_at FROM agent_model_policies WHERE workspace_id = $1 AND scope = ANY($2::text[])', [workspace.id, modelTasks]);
  const saved = new Map(result.rows.map((row) => [row.scope, { task: row.scope, provider: row.provider, connectionId: row.connection_id ?? undefined, model: row.model, updatedAt: row.updated_at }]));
  return modelTasks.map((task) => saved.get(task) ?? { task });
});

app.put('/api/v1/models/task-policies/:task', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const task = String(request.params.task);
  if (!modelTasks.includes(task)) { const error = new Error('不支持的任务策略。'); error.statusCode = 400; throw error; }
  const input = z.object({ provider: z.enum(['BAILIAN_CLI', 'EXTERNAL_API']).optional(), connectionId: z.string().uuid().optional(), model: z.string().max(160).optional() }).parse(request.body);
  const workspace = request.workspace;
  if (!input.provider || !input.model?.trim()) {
    await query('DELETE FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspace.id, task]);
    return { task };
  }
  if (input.provider === 'EXTERNAL_API' && !input.connectionId) { const error = new Error('外部 API 策略必须选择具体连接。'); error.statusCode = 400; throw error; }
  const catalogItem = await ensureCatalogModel(workspace.id, input.provider, input.connectionId, input.model.trim());
  if (!catalogSupportsTask(catalogItem, task)) { const error = new Error('所选模型不支持当前任务的输入与输出方式。请重新同步并选择匹配模型。'); error.statusCode = 400; throw error; }
  const result = await query(`INSERT INTO agent_model_policies (workspace_id, scope, provider, connection_id, model)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, scope) DO UPDATE SET provider = excluded.provider, connection_id = excluded.connection_id, model = excluded.model, updated_at = now()
    RETURNING scope, provider, connection_id, model, updated_at`, [workspace.id, task, input.provider, input.connectionId ?? null, input.model.trim()]);
  const row = result.rows[0];
  return { task: row.scope, provider: row.provider, connectionId: row.connection_id ?? undefined, model: row.model, updatedAt: row.updated_at };
});

app.get('/api/v1/models/usage', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const [summary, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total_calls, COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success_calls,
      COUNT(*) FILTER (WHERE status <> 'SUCCESS')::int AS failed_calls,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today_calls,
      COALESCE(SUM(input_tokens), 0)::int AS input_tokens, COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM api_usage_logs WHERE workspace_id = $1`, [workspace.id]),
    query('SELECT id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error, created_at FROM api_usage_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 80', [workspace.id]),
  ]);
  const total = summary.rows[0];
  return { summary: { totalCalls: total.total_calls, todayCalls: total.today_calls, successCalls: total.success_calls, failedCalls: total.failed_calls, inputTokens: total.input_tokens, outputTokens: total.output_tokens }, logs: rows.rows.map(usageLogView) };
});

function promptTemplateScope(value) {
  const scope = String(value || '');
  const supported = [ANALYSIS_SCOPE, SOURCE_VERIFICATION_SCOPE, WECHAT_COPY_GENERATION_SCOPE, ...Object.values(OUTLINE_TEMPLATE_SCOPES), ...Object.values(DRAFT_TEMPLATE_SCOPES), ...Object.values(REVISION_TEMPLATE_SCOPES)];
  if (!supported.includes(scope)) { const error = new Error('当前提示词模板尚未接入执行器。'); error.statusCode = 400; throw error; }
  return scope;
}

function promptTemplateView(row) {
  return { id: row.id, scope: row.scope, version: row.version, body: row.body, source: row.source, updatedAt: row.created_at };
}

app.get('/api/v1/settings/prompt-templates/:scope', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  return promptTemplateView(await templateStore.get(workspace.id, promptTemplateScope(request.params.scope)));
});

app.put('/api/v1/settings/prompt-templates/:scope', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const input = z.object({ body: z.string().min(1).max(12_000) }).parse(request.body);
  return promptTemplateView(await templateStore.save(workspace.id, promptTemplateScope(request.params.scope), input.body));
});

app.post('/api/v1/settings/prompt-templates/:scope/reset', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  return promptTemplateView(await templateStore.reset(workspace.id, promptTemplateScope(request.params.scope)));
});

async function analysisProfile(workspaceId) {
  const result = await query('SELECT state_json FROM workspace_snapshots WHERE workspace_id = $1', [workspaceId]);
  return result.rows[0]?.state_json?.workspace ?? {};
}

async function analysisRoute(workspaceId) {
  return textTaskRoute(workspaceId, ANALYSIS_SCOPE, '热点分析');
}

async function textTaskRoute(workspaceId, scope, label) {
  const result = await query('SELECT provider, connection_id, model FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspaceId, scope]);
  if (!result.rowCount) throw businessError(409, 'TASK_POLICY_REQUIRED', `请先为${label}配置任务策略。`, { scope });
  const route = { provider: result.rows[0].provider, connectionId: result.rows[0].connection_id ?? undefined, model: result.rows[0].model };
  if (route.provider === 'BAILIAN_CLI') {
    const credential = await query("SELECT 1 FROM credential_vault WHERE workspace_id = $1 AND provider = 'BAILIAN' AND status = 'READY'", [workspaceId]);
    if (!credential.rowCount) throw new Error('百炼 Key 尚未验证可用。请先在百炼设置中保存并检查。');
  } else {
    const connection = await query("SELECT 1 FROM model_connections WHERE id = $1 AND workspace_id = $2 AND status = 'READY'", [route.connectionId, workspaceId]);
    if (!connection.rowCount) throw new Error(`${label}使用的外部 API 连接不可用。`);
  }
  return route;
}

function analysisItem(row) {
  return { id: row.id, title: row.title, summary: row.summary, source: row.source_name, url: row.canonical_url, category: row.category, keywords: row.matched_keywords ?? [], publishedAt: row.published_at?.toISOString?.() ?? row.published_at ?? row.created_at };
}

app.post('/api/v1/intelligence/items/:id/analyses/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = z.object({ platforms: z.array(analysisPlatform).min(1).max(5) }).parse(request.body);
  const workspace = request.workspace;
  const itemResult = await query('SELECT * FROM intelligence_items WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!itemResult.rowCount) { const error = new Error('未找到这条资讯。'); error.statusCode = 404; throw error; }
  const [profile, route, template] = await Promise.all([analysisProfile(workspace.id), analysisRoute(workspace.id), templateStore.get(workspace.id, ANALYSIS_SCOPE)]);
  const prepared = prepareAnalysisInput({ item: analysisItem(itemResult.rows[0]), profile, platforms: input.platforms, template, route });
  const run = await query(`INSERT INTO generation_runs (workspace_id, skill_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
    VALUES ($1, 'intelligence-analysis:1.0.0', 'DRAFT', $2, $3, $4, $5, $6)
    RETURNING id, status, created_at`, [workspace.id, JSON.stringify(prepared.sourceSnapshot), JSON.stringify(prepared.input), route.model, String(template.version), JSON.stringify(null)]);
  reply.code(201).send({ id: run.rows[0].id, status: run.rows[0].status, createdAt: run.rows[0].created_at, confirmation: { sourceCount: 1, platforms: prepared.input.selectedPlatforms, model: route.model, promptVersion: template.version, generalAudienceWarning: prepared.generalAudienceWarning, costEstimate: null } });
});

app.post('/api/v1/generation-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const workspace = request.workspace;
  const run = await query("UPDATE generation_runs SET status = 'QUEUED' WHERE id = $1 AND workspace_id = $2 AND status = 'DRAFT' RETURNING id, workspace_id, status", [request.params.id, workspace.id]);
  if (!run.rowCount) { const error = new Error('该分析任务当前不能确认。'); error.statusCode = 409; throw error; }
  const job = await query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'INTELLIGENCE_ANALYSIS', $2) RETURNING *", [workspace.id, JSON.stringify({ runId: run.rows[0].id })]);
  try { await enqueue(job.rows[0]); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [run.rows[0].id, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [job.rows[0].id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ id: run.rows[0].id, status: 'QUEUED', jobId: job.rows[0].id });
});

app.post('/api/v1/generation-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const workspace = request.workspace;
  const result = await query("UPDATE generation_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('DRAFT', 'QUEUED') RETURNING id, status", [request.params.id, workspace.id]);
  if (!result.rowCount) { const error = new Error('该分析任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, request.params.id]);
  return result.rows[0];
});

app.get('/api/v1/intelligence/items/:id/analyses/latest', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query(`SELECT a.id, a.selected_platforms, a.output_json, a.overall_score, a.decision, a.created_at, r.model, r.prompt_version
    FROM intelligence_analyses a JOIN generation_runs r ON r.id = a.generation_run_id
    WHERE a.workspace_id = $1 AND a.intelligence_item_id = $2 ORDER BY a.created_at DESC LIMIT 1`, [workspace.id, request.params.id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: row.id, selectedPlatforms: row.selected_platforms, ...row.output_json, overallScore: row.overall_score, decision: row.decision, model: row.model, promptVersion: row.prompt_version, analyzedAt: row.created_at };
});

app.get('/api/v1/intelligence/items/:id/analyses/latest-run', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query(`SELECT r.id, r.status, r.error, r.model, r.prompt_version, r.input_json, r.created_at,
      (SELECT j.id FROM jobs j WHERE j.workspace_id = r.workspace_id AND j.payload_json->>'runId' = r.id::text ORDER BY j.created_at DESC LIMIT 1) AS job_id
    FROM generation_runs r
    WHERE r.workspace_id = $1
      AND r.skill_version_id = 'intelligence-analysis:1.0.0'
      AND r.source_snapshot_json->'item'->>'id' = $2
    ORDER BY r.created_at DESC LIMIT 1`, [workspace.id, request.params.id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    status: row.status,
    error: row.error ?? undefined,
    jobId: row.job_id ?? undefined,
    createdAt: row.created_at,
    confirmation: {
      sourceCount: 1,
      platforms: row.input_json?.selectedPlatforms ?? [],
      model: row.model,
      promptVersion: Number(row.prompt_version),
      generalAudienceWarning: !String(row.source_snapshot_json?.profile?.accountPositioning ?? '').trim() || !String(row.source_snapshot_json?.profile?.targetAudience ?? '').trim(),
      costEstimate: null,
    },
  };
});

app.post('/api/v1/intelligence/clip', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => clipPublicLink(z.object({ url: z.string().url().max(2_000) }).parse(request.body).url));
app.post('/api/v1/intelligence/search', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => searchTavily(request.workspace.id, z.object({ query: z.string(), category: z.string().optional(), domains: z.array(z.string()).optional() }).parse(request.body)));
app.get('/api/v1/intelligence/sources', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => listSources(request.workspace.id));
app.post('/api/v1/intelligence/sources', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = z.object({ sources: z.array(sourceInput).min(1).max(30) }).parse(request.body);
  const workspace = request.workspace;
  reply.code(201).send(await createSources(workspace.id, input.sources));
});
app.put('/api/v1/intelligence/sources/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const input = sourceInput.parse(request.body);
  const workspace = request.workspace;
  return updateSource(workspace.id, request.params.id, input);
});
app.delete('/api/v1/intelligence/sources/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => { await removeSource(request.workspace.id, request.params.id); reply.code(204).send(); });
app.get('/api/v1/intelligence/items', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => listItems(request.workspace.id));
app.post('/api/v1/intelligence/items', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = z.object({
    title: z.string().trim().min(1).max(500),
    summary: z.string().max(20_000).default(''),
    category: z.string().trim().min(1).max(120),
    keywords: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    source: z.string().trim().min(1).max(200),
    publishedAt: z.string().max(80).optional(),
    heat: z.number().int().min(0).max(100).default(0),
    trust: z.enum(['可信', '待核验']).default('待核验'),
    url: z.string().url().max(2_000).refine((value) => /^https?:\/\//i.test(value), '只支持 HTTP(S) 公开链接。'),
    captureMethod: z.enum(['MANUAL_LINK', 'SEARCH']),
    language: z.enum(['zh', 'en', 'other']).optional(),
    note: z.string().max(4_000).optional(),
  }).parse(request.body);
  const workspace = request.workspace;
  reply.code(201).send(await saveItem(workspace.id, input));
});
app.post('/api/v1/intelligence/rss/refresh', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => refreshWorkspaceRss(request.workspace.id));

app.get('/api/v1/creative/projects', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const state = await loadCreativeState({ query }, workspace.id);
  return { projects: [...state.projects].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)) };
});

app.post('/api/v1/creative/projects', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = createProjectInput.parse(request.body ?? {});
  const workspace = request.workspace;
  const project = createBlankProject(input);
  await transaction(async (client) => updateCreativeProjects(client, workspace.id, (state) => ({ ...state, projects: [project, ...state.projects] })));
  reply.code(201).send({ project, created: true });
});

app.post('/api/v1/creative/projects/from-intelligence/:itemId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const itemId = z.string().uuid().parse(request.params.itemId);
  const input = z.object({ angleIndex: z.number().int().min(0).max(9).default(0) }).parse(request.body ?? {});
  const workspace = request.workspace;
  const [itemResult, analysisResult] = await Promise.all([
    query('SELECT * FROM intelligence_items WHERE id = $1 AND workspace_id = $2', [itemId, workspace.id]),
    query(`SELECT a.selected_platforms, a.output_json, a.overall_score, a.decision, a.created_at
      FROM intelligence_analyses a
      WHERE a.workspace_id = $1 AND a.intelligence_item_id = $2
      ORDER BY a.created_at DESC LIMIT 1`, [workspace.id, itemId]),
  ]);
  if (!itemResult.rowCount) { const error = new Error('未找到这条资讯。'); error.statusCode = 404; throw error; }
  const analysisRow = analysisResult.rows[0];
  const analysis = analysisRow ? {
    selectedPlatforms: analysisRow.selected_platforms,
    ...analysisRow.output_json,
    overallScore: analysisRow.overall_score,
    decision: analysisRow.decision,
    analyzedAt: analysisRow.created_at,
  } : null;
  let project;
  let created = false;
  await transaction(async (client) => {
    await updateCreativeProjects(client, workspace.id, (state) => {
      const existing = state.projects.find((item) => item.originType === 'HOTSPOT' && item.originReferenceId === itemId);
      if (existing) { project = existing; return state; }
      project = createProjectFromIntelligence(analysisItem(itemResult.rows[0]), analysis, input.angleIndex);
      created = true;
      return { ...state, projects: [project, ...state.projects] };
    });
  });
  reply.code(created ? 201 : 200).send({ project, created });
});

app.get('/api/v1/creative/projects/:projectId/planning', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  const project = await creativeProject(workspace.id, projectId);
  return { project, planning: project.planning };
});

app.put('/api/v1/creative/projects/:projectId/versions/:versionId', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const versionId = z.string().min(1).max(240).parse(request.params.versionId);
  const input = z.object({ title: z.string().trim().min(1).max(240), body: z.string().max(200_000) }).parse(request.body);
  const workspace = request.workspace;
  let project;
  await transaction(async (client) => {
    await updateCreativeProjects(client, workspace.id, (state) => {
      const projectIndex = state.projects.findIndex((item) => item.id === projectId);
      if (projectIndex < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[projectIndex];
      const versionIndex = current.versions.findIndex((item) => item.id === versionId);
      if (versionIndex < 0) { const error = new Error('未找到这个平台版本。'); error.statusCode = 404; throw error; }
      const updatedAt = new Date().toISOString();
      const versions = [...current.versions];
      versions[versionIndex] = { ...versions[versionIndex], title: input.title, body: input.body, updatedAt };
      project = { ...current, status: current.status === 'BRIEF' ? 'WRITING' : current.status, versions, updatedAt };
      const projects = [...state.projects];
      projects[projectIndex] = project;
      return { ...state, projects };
    });
  });
  return { project };
});

app.put('/api/v1/creative/projects/:projectId/planning', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = projectPlanningInput.parse(request.body);
  const workspace = request.workspace;
  let project;
  await transaction(async (client) => {
    await updateCreativeProjects(client, workspace.id, async (state) => {
      const index = state.projects.findIndex((item) => item.id === projectId);
      if (index < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      project = saveProjectPlanning(state.projects[index], input);
      await writePlanningVersion(client, { workspaceId: workspace.id, projectId, status: 'DRAFT', planning: project.planning, sourceSnapshot: project.sourceSnapshot });
      const projects = [...state.projects];
      projects[index] = project;
      return { ...state, projects };
    });
  });
  return { project, planning: project.planning };
});

app.post('/api/v1/creative/projects/:projectId/planning/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  let project;
  await transaction(async (client) => {
    await updateCreativeProjects(client, workspace.id, async (state) => {
      const index = state.projects.findIndex((item) => item.id === projectId);
      if (index < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      project = confirmProjectPlanning(state.projects[index], state.projects[index].planning);
      await writePlanningVersion(client, { workspaceId: workspace.id, projectId, status: 'CONFIRMED', planning: project.planning, sourceSnapshot: project.sourceSnapshot, confirmedAt: project.planningConfirmedAt });
      const projects = [...state.projects];
      projects[index] = project;
      return { ...state, projects };
    });
  });
  return { project };
});

app.get('/api/v1/account-voices', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  return { voices: await accountVoiceStore.list(workspace.id) };
});

app.post('/api/v1/account-voices', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = accountVoiceInput.parse(request.body);
  const workspace = request.workspace;
  const voice = await accountVoiceStore.create(workspace.id, input);
  reply.code(201).send({ voice });
});

app.get('/api/v1/account-voices/:id', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const voice = await accountVoiceStore.get(workspace.id, z.string().uuid().parse(request.params.id));
  if (!voice) { const error = new Error('未找到账号声音。'); error.statusCode = 404; throw error; }
  return { voice };
});

app.put('/api/v1/account-voices/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const input = accountVoiceInput.parse(request.body);
  const workspace = request.workspace;
  const voice = await accountVoiceStore.update(workspace.id, z.string().uuid().parse(request.params.id), input);
  return { voice };
});

app.post('/api/v1/account-voices/:id/default', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const workspace = request.workspace;
  const voice = await accountVoiceStore.setDefault(workspace.id, z.string().uuid().parse(request.params.id));
  return { voice };
});

app.post('/api/v1/account-voices/:id/calibrations', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = accountVoiceCalibrationInput.parse(request.body);
  const workspace = request.workspace;
  const calibration = await accountVoiceStore.addCalibration(workspace.id, z.string().uuid().parse(request.params.id), input);
  reply.code(201).send({ calibration });
});

app.post('/api/v1/account-voices/calibration-drafts', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const input = accountVoiceCalibrationDraftInput.parse(request.body);
  const workspace = request.workspace;
  const startedAt = Date.now();
  let route;
  try {
    route = await textTaskRoute(workspace.id, 'VOICE_CALIBRATION', '账号声音提炼');
    const article = await readPublicArticle(input.sourceUrl);
    const prompt = buildVoiceCalibrationPrompt(article);
    const connectionInput = await textConnectionInput(workspace.id, route);
    const result = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    let draft;
    let inputTokens = result.inputTokens ?? 0;
    let outputTokens = result.outputTokens ?? 0;
    try { draft = parseVoiceCalibrationDraft(result.content); }
    catch (validationError) {
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildVoiceCalibrationRepairPrompt(prompt.system, validationError instanceof Error ? validationError.message : '输出结构不完整。'), message: result.content, ...connectionInput });
      draft = parseVoiceCalibrationDraft(repaired.content);
      inputTokens += repaired.inputTokens ?? 0;
      outputTokens += repaired.outputTokens ?? 0;
    }
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
      VALUES ($1, $2, $3, 'VOICE_CALIBRATION', 'SUCCESS', $4, $5, $6)`, [workspace.id, route.provider, route.model, Date.now() - startedAt, inputTokens || null, outputTokens || null]);
    return { article: { title: article.title, url: article.url, source: article.source }, draft };
  } catch (error) {
    const message = voiceCalibrationErrorMessage(error);
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms, error)
      VALUES ($1, $2, $3, 'VOICE_CALIBRATION', 'FAILED', $4, $5)`, [workspace.id, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, message.slice(0, 2_000)]);
    if (error instanceof Error && message === error.message) throw error;
    throw new Error(message);
  }
});

app.get('/api/v1/creative/skills', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  return creativeSkillStore.list(workspace.id);
});

app.get('/api/v1/creative/projects/:projectId/brief', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  return { brief: await creativeSkillStore.getBrief(workspace.id, projectId) };
});

app.put('/api/v1/creative/projects/:projectId/brief', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = writingBriefInput.parse(request.body);
  const workspace = request.workspace;
  return { brief: await creativeSkillStore.saveBrief(workspace.id, projectId, input) };
});

async function creativeProject(workspaceId, projectId) {
  const result = await query('SELECT project_json FROM content_projects WHERE workspace_id = $1 AND project_id = $2', [workspaceId, projectId]);
  const project = result.rows[0]?.project_json ? normalizeProject(result.rows[0].project_json, new Date().toISOString()) : null;
  if (!project) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
  return project;
}

app.get('/api/v1/creative/projects/:projectId/materials', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  return projectMaterialStore.list(workspace.id, projectId);
});

app.post('/api/v1/creative/projects/:projectId/inputs', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = projectInputPayload.parse(request.body);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  reply.code(201).send(await projectMaterialStore.createInput(workspace.id, projectId, input));
});

app.put('/api/v1/creative/project-inputs/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const id = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  return projectMaterialStore.updateInput(workspace.id, id, projectInputPayload.parse(request.body));
});

app.delete('/api/v1/creative/project-inputs/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const id = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  await projectMaterialStore.removeInput(workspace.id, id);
  reply.code(204).send();
});

function plainMetadata(value, maxLength = 300) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function searchWikimediaImages(queryText) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6',
    gsrsearch: queryText, gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '640', origin: '*',
  });
  let response;
  try {
    response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    throw new Error(`开放图库连接失败（${error instanceof Error ? error.message : '网络错误'}）`);
  }
  if (!response.ok) throw new Error(`图片搜索服务返回 HTTP ${response.status}`);
  const payload = await response.json();
  const results = (payload?.query?.pages ?? []).flatMap((page) => {
    const info = page?.imageinfo?.[0];
    if (!info?.url || !info?.thumburl) return [];
    const metadata = info.extmetadata ?? {};
    const license = plainMetadata(metadata.LicenseShortName?.value || metadata.UsageTerms?.value || '请查看来源页');
    const attribution = plainMetadata(metadata.Artist?.value || metadata.Credit?.value || 'Wikimedia Commons');
    return [{
      id: String(page.pageid), title: String(page.title || 'Wikimedia Commons 图片').replace(/^File:/i, ''),
      thumbnailUrl: info.thumburl, imageUrl: info.url, sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/?curid=${page.pageid}`,
      license, attribution,
    }];
  });
  if (!results.length) throw new Error('开放图库没有匹配图片');
  return results;
}

app.get('/api/v1/creative/image-search', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const input = z.object({ q: z.string().trim().min(2).max(120) }).parse(request.query);
  const workspace = request.workspace;
  const searches = [
    searchTavilyImages(workspace.id, input.q).then((results) => {
      if (!results.length) throw new Error('未配置 Tavily 或没有网页候选图');
      return { provider: 'Tavily 图片搜索', results };
    }),
    searchWikimediaImages(input.q).then((results) => ({ provider: 'Wikimedia Commons', results })),
  ];
  try {
    return await Promise.any(searches);
  } catch (error) {
    const messages = error instanceof AggregateError ? error.errors.map((item) => item instanceof Error ? item.message : String(item)) : [error instanceof Error ? error.message : '未知错误'];
    throw new Error(`图片搜索暂时不可用：${messages.join('；')}。`);
  }
});

app.post('/api/v1/creative/projects/:projectId/visual/plan', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = visualPlanningInput.parse(request.body ?? {});
  const workspace = request.workspace;
  const [project, drafts] = await Promise.all([
    creativeProject(workspace.id, projectId),
    draftStore.listProject(workspace.id, projectId),
  ]);
  const draft = drafts.find((item) => item.platform === 'WECHAT');
  if (!String(draft?.body ?? '').trim()) throw businessError(409, 'WECHAT_DRAFT_REQUIRED', '请先完成公众号正文，再生成配图方案。');
  const persistedPlan = draft.visualPlan?.plan;
  const currentPlan = input.currentPlan.length ? input.currentPlan : Array.isArray(persistedPlan) ? persistedPlan : [];
  const currentItem = input.currentItemId ? currentPlan.find((item) => item.id === input.currentItemId) : undefined;
  if (input.currentItemId && !currentItem) { const error = new Error('没有找到要重新策划的图片。'); error.statusCode = 404; throw error; }

  const scope = VISUAL_PLANNING_SCOPE;
  const route = await textTaskRoute(workspace.id, scope, '配图策划');
  const connectionInput = await textConnectionInput(workspace.id, route);
  const prompt = buildVisualPlanningPrompt({
    project: {
      ...project,
      versionTitle: draft.title,
      versionBody: draft.body,
    },
    platform: input.platform,
    bodyItemCount: input.bodyItemCount,
    styleProfile: input.styleProfile,
    request: input.request,
    currentItem,
  });
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const result = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, maxTokens: 16_000, temperature: 0.15, ...connectionInput });
    inputTokens += result.inputTokens ?? 0;
    outputTokens += result.outputTokens ?? 0;
    let parsed;
    try {
      parsed = parseVisualPlanningContent(result.content, { platform: input.platform, bodyItemCount: input.bodyItemCount, singleItem: Boolean(input.currentItemId) });
    } catch (validationError) {
      const repaired = await textRunner.runText({
        provider: route.provider,
        model: route.model,
        system: buildVisualPlanningRepairPrompt(prompt.system, validationError instanceof Error ? validationError.message : '输出结构不完整。', {
          platform: input.platform,
          bodyItemCount: input.bodyItemCount,
          singleItem: Boolean(input.currentItemId),
        }),
        message: result.content,
        maxTokens: 16_000,
        temperature: 0.1,
        ...connectionInput,
      });
      inputTokens += repaired.inputTokens ?? 0;
      outputTokens += repaired.outputTokens ?? 0;
      parsed = parseVisualPlanningContent(repaired.content, { platform: input.platform, bodyItemCount: input.bodyItemCount, singleItem: Boolean(input.currentItemId) });
    }
    const plan = mergePlannedItems({
      platform: input.platform,
      plannedItems: parsed.items,
      currentPlan,
      currentItemId: input.currentItemId,
      keepAssignedAssets: input.keepAssignedAssets,
    });
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
      VALUES ($1, $2, $3, $4, 'SUCCESS', $5, $6, $7)`, [workspace.id, route.provider, route.model, VISUAL_PLANNING_OPERATION, Date.now() - startedAt, inputTokens || null, outputTokens || null]);
    reply.code(201).send({
      plan,
      strategy: parsed.strategy,
      policy: {
        scope,
        provider: route.provider,
        connectionId: route.connectionId ?? null,
        model: route.model,
        promptVersion: VISUAL_PLANNING_PROMPT_VERSION,
      },
    });
  } catch (error) {
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
      VALUES ($1, $2, $3, $4, 'ERROR', $5, $6, $7, $8)`, [workspace.id, route.provider, route.model, VISUAL_PLANNING_OPERATION, Date.now() - startedAt, inputTokens || null, outputTokens || null, (error instanceof Error ? error.message : '配图策划失败').slice(0, 2_000)]);
    throw error;
  }
});

function generatedImageMime(filename) {
  const extension = path.extname(filename).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
}

app.post('/api/v1/creative/projects/:projectId/visual/generate', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = visualGenerationInput.parse(request.body);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  const operation = input.assetIds.length ? 'IMAGE_TO_IMAGE' : 'TEXT_TO_IMAGE';
  const policy = await query('SELECT provider, model FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspace.id, operation]);
  if (!policy.rowCount) throw businessError(409, 'TASK_POLICY_REQUIRED', `请先在“模型与 API”中为${operation === 'IMAGE_TO_IMAGE' ? '图生图' : '文生图'}选择模型。`, { scope: operation });
  if (policy.rows[0].provider !== 'BAILIAN_CLI') { const error = new Error('当前版本的 AI 生图仅支持已配置的百炼 CLI 文生图模型。'); error.statusCode = 400; throw error; }
  const model = policy.rows[0].model;
  const apiKey = await credentialSecret(workspace.id, 'BAILIAN');
  const linkedAssets = input.assetIds.length ? await assetStore.listProject(workspace.id, projectId) : [];
  const linkedAssetIds = new Set(linkedAssets.map((asset) => asset.id));
  if (input.assetIds.some((assetId) => !linkedAssetIds.has(assetId))) throw businessError(400, 'PROJECT_ASSET_REQUIRED', '参考图必须先关联到当前项目。');
  const referenceAssets = await Promise.all(input.assetIds.map((assetId) => assetStore.getStored(workspace.id, assetId)));
  const referenceImages = referenceAssets.map((asset) => {
    if (!asset.mime_type?.startsWith('image/')) throw businessError(400, 'ASSET_NOT_IMAGE', `“${asset.title}”不是可用的参考图片。`);
    return safePath(config.uploadRoot, asset.storage_key);
  });
  const jobFolder = path.join(config.uploadRoot, workspace.id, createHash('sha256').update(projectId).digest('hex').slice(0, 20), 'generated', randomUUID());
  const startedAt = Date.now();
  let assetPersisted = false;
  try {
    await fs.mkdir(jobFolder, { recursive: true });
    const command = input.assetIds.length ? 'edit' : 'generate';
    const args = ['image', command, '--prompt', input.prompt, '--model', model, '--size', input.size, '--n', '1', '--out-dir', jobFolder, '--out-prefix', 'visual', '--output', 'json', '--quiet'];
    for (const image of referenceImages) args.push('--image', image);
    await runBailianCli(args, apiKey, 180_000);
    const files = await fs.readdir(jobFolder, { withFileTypes: true });
    const image = files.find((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name));
    if (!image) throw new Error('模型未返回可保存的图片文件。');
    const absolutePath = path.join(jobFolder, image.name);
    const content = await fs.readFile(absolutePath);
    const detected = detectFileType(content, generatedImageMime(image.name));
    if (detected.kind !== 'IMAGE') throw businessError(400, 'ASSET_TYPE_MISMATCH', '模型返回的文件不是可用图片。');
    const stored = {
      kind: detected.kind,
      storageKey: path.relative(config.uploadRoot, absolutePath).split(path.sep).join('/'),
      originalFilename: image.name,
      mimeType: detected.mimeType,
      sizeBytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      sourceUrl: null,
    };
    const created = await assetStore.createFromStoredFile(workspace.id, request.user.sub, stored, {
      origin: 'AI_GENERATED',
      title: `AI 配图 · ${input.prompt.slice(0, 38)}`,
      sourceNote: `AI 生图｜模型：${model}｜比例：${input.size}${referenceImages.length ? `｜参考图：${referenceImages.length} 张` : ''}`,
      copyrightStatus: 'OWNED',
    });
    assetPersisted = true;
    if (!created.created) await fs.rm(jobFolder, { recursive: true, force: true });
    const projectAsset = await assetStore.linkToProject(workspace.id, projectId, created.asset.id, {
      role: 'VISUAL', scope: 'IMAGING', title: created.asset.title, notes: created.asset.sourceNote, platforms: [input.platform],
    });
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms)
      VALUES ($1, 'BAILIAN_CLI', $2, $3, 'SUCCESS', $4)`, [workspace.id, model, operation, Date.now() - startedAt]);
    reply.code(created.created ? 201 : 200).send({ asset: created.asset, projectAsset });
  } catch (error) {
    if (!assetPersisted) await fs.rm(jobFolder, { recursive: true, force: true }).catch(() => {});
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms, error)
      VALUES ($1, 'BAILIAN_CLI', $2, $3, 'ERROR', $4, $5)`, [workspace.id, model, operation, Date.now() - startedAt, (error instanceof Error ? error.message : '图片生成失败').slice(0, 2_000)]);
    throw error;
  }
});

app.post('/api/v1/creative/projects/:projectId/references', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = projectReferenceMetadata.extend({ url: z.string().url().max(2_000).refine((value) => /^https?:\/\//i.test(value), '只支持 HTTP(S) 公开链接。') }).parse(request.body);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  reply.code(201).send(await projectMaterialStore.createReference(workspace.id, projectId, { ...input, sourceType: 'LINK' }));
});

app.put('/api/v1/creative/project-references/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const id = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  return projectMaterialStore.updateReference(workspace.id, id, projectReferenceMetadata.parse(request.body));
});

app.delete('/api/v1/creative/project-references/:id', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const id = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  await projectMaterialStore.removeReference(workspace.id, id);
  reply.code(204).send();
});

async function projectResearchMaterialSnapshot(rows) {
  let remaining = 12_000;
  const take = (value, maximum = 3_000) => {
    const text = String(value || '').trim();
    const result = text.slice(0, Math.max(0, Math.min(maximum, remaining)));
    remaining -= result.length;
    return result;
  };
  const inputs = rows.inputs.map((row) => ({
    id: row.id, type: 'INPUT', kind: row.kind, title: row.title, scope: row.scope,
    platforms: row.platforms_json ?? [], content: take(row.body),
  }));
  const references = [];
  for (const row of [...rows.references, ...rows.assets]) {
    let extractedText = '';
    if (remaining > 0 && row.source_type === 'ASSET' && ['text/plain', 'text/markdown'].includes(row.mime_type)) {
      extractedText = take(await readAssetText(config.uploadRoot, row.storage_key, Math.min(3_000, remaining)));
    }
    references.push({
      id: row.id, type: row.source_type, role: row.role, title: row.title, notes: row.notes,
      scope: row.scope, platforms: row.platforms_json ?? [], url: row.url ?? null,
      filename: row.original_filename ?? null, mimeType: row.mime_type ?? null,
      extractedText: extractedText || null,
      contentStatus: row.source_type === 'LINK' ? 'NOT_READ' : extractedText ? 'TEXT_EXTRACTED' : 'METADATA_ONLY',
    });
  }
  return [...inputs, ...references];
}

async function researchMaterialIds(runId) {
  if (!runId) return { inputIds: [], referenceIds: [], assetIds: [] };
  const result = await query('SELECT input_id, reference_id, asset_link_id FROM project_research_materials WHERE generation_run_id = $1', [runId]);
  return {
    inputIds: result.rows.flatMap((row) => row.input_id ? [row.input_id] : []),
    referenceIds: result.rows.flatMap((row) => row.reference_id ? [row.reference_id] : []),
    assetIds: result.rows.flatMap((row) => row.asset_link_id ? [row.asset_link_id] : []),
  };
}

app.get('/api/v1/creative/projects/:projectId/agent', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = projectAgentQuery.parse(request.query);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  return projectAgentStore.context(workspace.id, projectId, input);
});

app.post('/api/v1/creative/projects/:projectId/research/start', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = simplifiedResearchStartInput.parse(request.body ?? {});
  const workspace = request.workspace;
  const [project, brief, policy, verificationPolicy, template, listed] = await Promise.all([
    creativeProject(workspace.id, projectId),
    creativeSkillStore.getBrief(workspace.id, projectId),
    query(`SELECT p.model FROM agent_model_policies p
      JOIN credential_vault c ON c.workspace_id = p.workspace_id AND c.provider = 'BAILIAN' AND c.status = 'READY'
      WHERE p.workspace_id = $1 AND p.scope = $2 AND p.provider = 'BAILIAN_CLI'`, [workspace.id, PROJECT_RESEARCH_SCOPE]),
    query(`SELECT p.model FROM agent_model_policies p
      JOIN credential_vault c ON c.workspace_id = p.workspace_id AND c.provider = 'BAILIAN' AND c.status = 'READY'
      WHERE p.workspace_id = $1 AND p.scope = $2 AND p.provider = 'BAILIAN_CLI'`, [workspace.id, SOURCE_VERIFICATION_SCOPE]),
    templateStore.get(workspace.id, SOURCE_VERIFICATION_SCOPE),
    projectMaterialStore.list(workspace.id, projectId),
  ]);
  if (!policy.rowCount) { const error = new Error('请先在“核心 Agent”配置可用的规划模型。'); error.statusCode = 400; throw error; }
  const inputIds = listed.inputs.filter((item) => item.scope === 'PROJECT' || item.scope === 'RESEARCH').map((item) => item.id);
  const referenceIds = listed.references.filter((item) => item.scope === 'PROJECT' || item.scope === 'RESEARCH').map((item) => item.id);
  const assetIds = listed.assets.filter((item) => item.scope === 'PROJECT' || item.scope === 'RESEARCH').map((item) => item.linkId);
  const materialRows = await projectMaterialStore.researchSnapshot(workspace.id, projectId, inputIds, referenceIds, assetIds);
  const materials = await projectResearchMaterialSnapshot(materialRows);
  const route = { provider: 'BAILIAN_CLI', model: policy.rows[0].model };
  const verificationRoute = verificationPolicy.rowCount ? { provider: 'BAILIAN_CLI', model: verificationPolicy.rows[0].model } : null;
  const run = await transaction(async (client) => {
    await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
      WHERE workspace_id = $1 AND action_version_id = $2 AND status IN ('QUEUED', 'RUNNING')
        AND source_snapshot_json->>'projectId' = $3`, [workspace.id, SIMPLIFIED_RESEARCH_WORKFLOW_VERSION, projectId]);
    const created = await client.query(`INSERT INTO generation_runs
      (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
      VALUES ($1, $2, 'QUEUED', $3, $4, $5, '1.0.0', 'null'::jsonb) RETURNING *`, [
      workspace.id,
      SIMPLIFIED_RESEARCH_WORKFLOW_VERSION,
      JSON.stringify({ projectId, project, brief, request: input.request || '根据已确认的规划开始研究。', materials, stage: 'RESEARCH', process: { phase: 'PLANNING', progress: 5 } }),
      JSON.stringify({ route, verificationRoute, verificationTemplate: template.body }),
      route.model,
    ]);
    await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, action_run_id, role, content, stage, message_type, metadata_json)
      VALUES ($1, $2, $3, 'USER', $4, 'RESEARCH', 'MESSAGE', '{}'::jsonb),
             ($1, $2, $3, 'ASSISTANT', '正在检索研究资料。', 'RESEARCH', 'RUN_STATUS', $5)`, [
      workspace.id, projectId, created.rows[0].id, input.request || '开始研究', JSON.stringify({ action: 'PROJECT_RESEARCH_WORKFLOW', phase: 'PLANNING', progress: 5 }),
    ]);
    for (const id of inputIds) await client.query('INSERT INTO project_research_materials (generation_run_id, input_id) VALUES ($1, $2)', [created.rows[0].id, id]);
    for (const id of referenceIds) await client.query('INSERT INTO project_research_materials (generation_run_id, reference_id) VALUES ($1, $2)', [created.rows[0].id, id]);
    for (const id of assetIds) await client.query('INSERT INTO project_research_materials (generation_run_id, asset_link_id) VALUES ($1, $2)', [created.rows[0].id, id]);
    const job = await client.query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'PROJECT_RESEARCH_WORKFLOW', $2) RETURNING *", [workspace.id, JSON.stringify({ runId: created.rows[0].id })]);
    return { run: created.rows[0], job: job.rows[0] };
  });
  try { await enqueue(run.job); }
  catch (error) {
    const message = error instanceof Error ? error.message : '研究任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [run.run.id, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [run.job.id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ ...runView(run.run), jobId: run.job.id });
});

function advanceProjectToMasterWriting(state, projectId, now = new Date().toISOString()) {
  let project;
  const projects = (state.projects ?? []).map((item) => {
    if (item.id !== projectId) return item;
    project = {
      ...item,
      stage: 'MASTER_WRITING',
      status: 'WRITING',
      updatedAt: now,
    };
    return project;
  });
  if (!project) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
  return { ...state, projects };
}

app.post('/api/v1/creative/research-results/:artifactId/accept', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const artifactId = z.string().uuid().parse(request.params.artifactId);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const result = await client.query(`SELECT a.*, r.id AS research_result_id, r.output_json
      FROM project_artifacts a
      JOIN project_research_results r ON r.artifact_id = a.id
      WHERE a.id = $1 AND a.workspace_id = $2
        AND a.artifact_type = 'RESEARCH_RESULT' AND a.status = 'CANDIDATE'
      FOR UPDATE OF a, r`, [artifactId, workspace.id]);
    if (!result.rowCount) { const error = new Error('这份研究结果当前不能采用。'); error.statusCode = 409; throw error; }
    const candidate = result.rows[0];
    const now = new Date().toISOString();
    await client.query(`UPDATE project_artifacts SET status = 'REJECTED', updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND artifact_type = 'RESEARCH_RESULT'
        AND status IN ('CANDIDATE', 'ACCEPTED') AND id <> $3`, [workspace.id, candidate.project_id, candidate.id]);
    const accepted = await client.query(`UPDATE project_artifacts
      SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
      WHERE id = $1 AND workspace_id = $2 RETURNING *`, [candidate.id, workspace.id]);
    await client.query('UPDATE project_research_results SET accepted_at = now() WHERE id = $1', [candidate.research_result_id]);
    const message = await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
      VALUES ($1, $2, 'ASSISTANT', '研究结果已采用，已进入正文创作。', 'RESEARCH', 'SYSTEM_EVENT', $3, $4)
      RETURNING id`, [
      workspace.id,
      candidate.project_id,
      JSON.stringify([candidate.id]),
      JSON.stringify({ action: 'RESEARCH_RESULT_ACCEPTED' }),
    ]);
    const state = await updateCreativeProjects(client, workspace.id, (current) => advanceProjectToMasterWriting(current, candidate.project_id, now), now);
    const project = state.projects.find((item) => item.id === candidate.project_id);
    await projectAgentStore.upsertStageSummary(client, {
      workspaceId: workspace.id,
      projectId: candidate.project_id,
      stage: 'RESEARCH',
      summary: candidate.output_json.summary,
      throughMessageId: message.rows[0].id,
    });
    return {
      artifact: artifactView({ ...accepted.rows[0], payload_json: candidate.output_json, version_number: 1 }),
      project,
    };
  });
});

app.post('/api/v1/creative/projects/:projectId/research/skip', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  return transaction(async (client) => {
    const now = new Date().toISOString();
    const state = await updateCreativeProjects(client, workspace.id, (current) => advanceProjectToMasterWriting(current, projectId, now), now);
    const project = state.projects.find((item) => item.id === projectId);
    const message = await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, role, content, stage, message_type, metadata_json)
      VALUES ($1, $2, 'ASSISTANT', '已跳过研究，直接进入正文创作。', 'RESEARCH', 'SYSTEM_EVENT', $3)
      RETURNING id`, [workspace.id, projectId, JSON.stringify({ action: 'RESEARCH_SKIPPED' })]);
    await projectAgentStore.upsertStageSummary(client, {
      workspaceId: workspace.id,
      projectId,
      stage: 'RESEARCH',
      summary: '本次跳过研究，正文将仅基于项目规划和用户提供的资料创作。',
      throughMessageId: message.rows[0].id,
    });
    return { project };
  });
});

app.post('/api/v1/creative/projects/:projectId/agent/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = agentPrepareInput.parse(request.body);
  const workspace = request.workspace;
  if (input.stage === 'RESEARCH') {
    const [project, brief, policy, materialRows] = await Promise.all([
      creativeProject(workspace.id, projectId),
      creativeSkillStore.getBrief(workspace.id, projectId),
      query(`SELECT p.model FROM agent_model_policies p
        JOIN credential_vault c ON c.workspace_id = p.workspace_id AND c.provider = 'BAILIAN' AND c.status = 'READY'
        WHERE p.workspace_id = $1 AND p.scope = $2 AND p.provider = 'BAILIAN_CLI'`, [workspace.id, PROJECT_RESEARCH_SCOPE]),
      projectMaterialStore.researchSnapshot(workspace.id, projectId, input.inputIds, input.referenceIds, input.assetIds),
    ]);
    if (!policy.rowCount) throw new Error('请先在“核心 Agent”配置可用的规划模型。');
    const materials = await projectResearchMaterialSnapshot(materialRows);
    const run = await transaction(async (client) => {
      await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
        WHERE workspace_id = $1 AND action_version_id = $2 AND status = 'DRAFT' AND source_snapshot_json->>'projectId' = $3`, [workspace.id, PROJECT_RESEARCH_ACTION_VERSION, projectId]);
      const created = await client.query(`INSERT INTO generation_runs
        (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
        VALUES ($1, $2, 'DRAFT', $3, $4, $5, '1.0.0', 'null'::jsonb) RETURNING *`, [
        workspace.id,
        PROJECT_RESEARCH_ACTION_VERSION,
        JSON.stringify({ projectId, project, brief, request: input.request, materials, stage: 'RESEARCH' }),
        JSON.stringify({ route: { provider: 'BAILIAN_CLI', model: policy.rows[0].model } }),
        policy.rows[0].model,
      ]);
      await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, metadata_json)
        VALUES ($1, $2, $3, 'USER', $4, 'RESEARCH', 'MESSAGE', '{}'::jsonb),
               ($1, $2, $3, 'ASSISTANT', $5, 'RESEARCH', 'CONFIRMATION', $6)`, [
        workspace.id, projectId, created.rows[0].id, input.request, '研究计划已准备，确认后开始执行。',
        JSON.stringify({ action: 'PROJECT_RESEARCH_PLAN', model: policy.rows[0].model }),
      ]);
      for (const id of input.inputIds) await client.query('INSERT INTO project_research_materials (generation_run_id, input_id) VALUES ($1, $2)', [created.rows[0].id, id]);
      for (const id of input.referenceIds) await client.query('INSERT INTO project_research_materials (generation_run_id, reference_id) VALUES ($1, $2)', [created.rows[0].id, id]);
      for (const id of input.assetIds) await client.query('INSERT INTO project_research_materials (generation_run_id, asset_link_id) VALUES ($1, $2)', [created.rows[0].id, id]);
      return created.rows[0];
    });
    reply.code(201).send(runView(run));
    return;
  }

  if (input.platform !== 'WECHAT') throw businessError(400, 'WECHAT_MASTER_REQUIRED', '正文创作只支持公众号母稿。');
  const [project, context, materialRows, summaries, masterResult, drafts, acceptedResearch] = await Promise.all([
    creativeProject(workspace.id, projectId),
    creativeSkillStore.getContext(workspace.id, projectId, 'WECHAT'),
    projectMaterialStore.researchSnapshot(workspace.id, projectId, input.inputIds, input.referenceIds, input.assetIds),
    query(`SELECT stage, platform, summary, version FROM project_stage_summaries
      WHERE workspace_id = $1 AND project_id = $2 AND (platform IS NULL OR platform = $3)
      ORDER BY created_at DESC LIMIT 10`, [workspace.id, projectId, 'WECHAT']),
    query(`SELECT m.* FROM content_master_versions m
      JOIN project_artifacts a ON a.id = m.artifact_id AND a.status = 'ACCEPTED'
      WHERE m.workspace_id = $1 AND m.project_id = $2 ORDER BY m.version_number DESC LIMIT 1`, [workspace.id, projectId]),
    draftStore.listProject(workspace.id, projectId),
    query(`SELECT r.output_json
      FROM project_research_results r
      JOIN project_artifacts a ON a.id = r.artifact_id AND a.status = 'ACCEPTED'
      WHERE r.workspace_id = $1 AND r.project_id = $2
      ORDER BY r.accepted_at DESC NULLS LAST, r.created_at DESC LIMIT 1`, [workspace.id, projectId]),
  ]);
  if (!context) throw new Error('请先保存创作设定和写作策略。');
  const currentDraft = drafts.find((draft) => draft.platform === 'WECHAT');
  const currentContent = currentDraft
    ? { id: currentDraft.id, title: currentDraft.title, body: currentDraft.body, factsToVerify: project.factChecks ?? [] }
    : { id: null, title: '', body: '', factsToVerify: project.factChecks ?? [] };
  const resolution = resolveCopyAction({ request: input.request, hasBody: Boolean(currentContent.body?.trim()), selection: input.selection, targetPlatform: 'WECHAT' });
  if (resolution.needsClarification) {
    await projectAgentStore.appendMessage(workspace.id, projectId, { role: 'USER', content: input.request, stage: 'COPY', metadata: { platform: 'WECHAT' } });
    const message = await projectAgentStore.appendMessage(workspace.id, projectId, { role: 'ASSISTANT', content: resolution.question, stage: 'COPY', metadata: { platform: 'WECHAT', needsClarification: true } });
    reply.code(200).send({ needsClarification: true, message });
    return;
  }
  const action = resolution.action;
  const [route, template, researchPolicy, verificationPolicy, verificationTemplate] = await Promise.all([
    textTaskRoute(workspace.id, copyActionScope(action), action === 'GENERATE_OUTLINE' || action === 'GENERATE_DRAFT' ? '文案生成' : '文案改写'),
    templateStore.get(workspace.id, copyPromptTemplateScope(action, 'WECHAT')),
    action === 'GENERATE_DRAFT' ? query(`SELECT p.model FROM agent_model_policies p
      JOIN credential_vault c ON c.workspace_id = p.workspace_id AND c.provider = 'BAILIAN' AND c.status = 'READY'
      WHERE p.workspace_id = $1 AND p.scope = $2 AND p.provider = 'BAILIAN_CLI'`, [workspace.id, PROJECT_RESEARCH_SCOPE]) : Promise.resolve({ rowCount: 0, rows: [] }),
    action === 'GENERATE_DRAFT' ? query(`SELECT p.model FROM agent_model_policies p
      JOIN credential_vault c ON c.workspace_id = p.workspace_id AND c.provider = 'BAILIAN' AND c.status = 'READY'
      WHERE p.workspace_id = $1 AND p.scope = $2 AND p.provider = 'BAILIAN_CLI'`, [workspace.id, SOURCE_VERIFICATION_SCOPE]) : Promise.resolve({ rowCount: 0, rows: [] }),
    action === 'GENERATE_DRAFT' ? templateStore.get(workspace.id, SOURCE_VERIFICATION_SCOPE) : Promise.resolve(null),
  ]);
  const materials = await projectResearchMaterialSnapshot(materialRows);
  const master = masterResult.rows[0];
  const acceptedResearchResult = acceptedResearch.rows[0]?.output_json ?? null;
  const researchContext = acceptedResearchResult ? {
    verifiedFacts: acceptedResearchResult.facts ?? [],
    cautions: acceptedResearchResult.cautions ?? [],
    creativeReferences: acceptedResearchResult.materialContext?.creativeReferences ?? [],
    userContent: acceptedResearchResult.materialContext?.userContent ?? [],
    visualAssets: acceptedResearchResult.materialContext?.visualAssets ?? [],
  } : null;
  const sourceSnapshot = {
    projectId,
    project,
    brief: context.brief,
    accountVoice: context.accountVoice,
    skills: context.skills,
    platform: 'WECHAT',
    stage: 'COPY',
    action,
    request: input.request,
    currentContent,
    selection: input.selection ?? null,
    contentMaster: master ? {
      id: master.id,
      thesis: master.thesis,
      facts: master.facts_json,
      cases: master.cases_json,
      preservedExpressions: master.preserved_expressions_json,
      factsToVerify: master.facts_to_verify_json,
      materialRefs: master.material_refs_json,
    } : null,
    summaries: summaries.rows,
    materials,
    researchContext,
  };
  const researchRoute = action === 'GENERATE_DRAFT'
    ? researchPolicy.rowCount ? { provider: 'BAILIAN_CLI', model: researchPolicy.rows[0].model } : null
    : null;
  const verificationRoute = action === 'GENERATE_DRAFT'
    ? verificationPolicy.rowCount ? { provider: 'BAILIAN_CLI', model: verificationPolicy.rows[0].model } : null
    : null;
  const policySnapshot = {
    scope: WECHAT_COPY_GENERATION_SCOPE,
    provider: route.provider,
    connectionId: route.connectionId ?? null,
    model: route.model,
    promptVersion: template.version,
  };
  sourceSnapshot.policy = policySnapshot;
  const runInput = {
    template: { id: template.id, version: template.version, body: template.body },
    route: { provider: route.provider, connectionId: route.connectionId ?? null, model: route.model },
    ...(researchRoute ? { researchRoute } : {}),
    ...(verificationRoute ? { verificationRoute } : {}),
    ...(verificationTemplate ? { verificationTemplate: verificationTemplate.body } : {}),
  };
  const run = await transaction(async (client) => {
    await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
      WHERE workspace_id = $1 AND action_version_id LIKE 'project-copy-%' AND status = 'DRAFT'
        AND source_snapshot_json->>'projectId' = $2 AND source_snapshot_json->>'platform' = $3`, [workspace.id, projectId, 'WECHAT']);
    const created = await client.query(`INSERT INTO generation_runs
      (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
      VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, 'null'::jsonb) RETURNING *`, [
      workspace.id, copyActionVersion(action), JSON.stringify(sourceSnapshot), JSON.stringify(runInput), route.model, String(template.version),
    ]);
    await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, action_run_id, role, content, stage, message_type, metadata_json)
      VALUES ($1, $2, $3, 'USER', $4, 'COPY', 'MESSAGE', $5),
             ($1, $2, $3, 'ASSISTANT', $6, 'COPY', 'CONFIRMATION', $7)`, [
      workspace.id, projectId, created.rows[0].id, input.request, JSON.stringify({ platform: 'WECHAT' }),
       action === 'GENERATE_DRAFT' ? '正文任务已准备，确认后自动补齐上下文并生成成稿。' : '文案修改已准备，确认后生成可对比版本。',
      JSON.stringify({ platform: 'WECHAT', action, policy: policySnapshot }),
    ]);
    return created.rows[0];
  });
  reply.code(201).send(runView(run));
});

app.post('/api/v1/creative/agent-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const prepared = await transaction(async (client) => {
    const run = await client.query(`UPDATE generation_runs SET status = 'QUEUED'
      WHERE id = $1 AND workspace_id = $2 AND status = 'DRAFT'
        AND (action_version_id = $3 OR action_version_id LIKE 'project-copy-%')
      RETURNING *`, [runId, workspace.id, PROJECT_RESEARCH_ACTION_VERSION]);
    if (!run.rowCount) { const error = new Error('该 Agent 任务当前不能确认。'); error.statusCode = 409; throw error; }
    const jobType = run.rows[0].action_version_id === PROJECT_RESEARCH_ACTION_VERSION ? 'PROJECT_RESEARCH_PLAN' : 'PROJECT_COPY_ACTION';
    const job = await client.query('INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, $2, $3) RETURNING *', [workspace.id, jobType, JSON.stringify({ runId })]);
    return { run: run.rows[0], job: job.rows[0], jobType };
  });
  try { await enqueue(prepared.job); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [runId, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [prepared.job.id, message.slice(0, 2_000)]);
    throw error;
  }
  await projectAgentStore.appendMessage(workspace.id, prepared.run.source_snapshot_json.projectId, {
    actionRunId: runId,
    role: 'ASSISTANT',
    content: '任务已进入执行队列。',
    stage: prepared.run.source_snapshot_json.stage ?? 'COPY',
    messageType: 'RUN_STATUS',
    metadata: { platform: prepared.run.source_snapshot_json.platform ?? null, status: 'QUEUED', jobType: prepared.jobType },
  });
  reply.code(202).send({ id: runId, status: 'QUEUED', jobId: prepared.job.id });
});

app.post('/api/v1/creative/agent-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const result = await query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
    WHERE id = $1 AND workspace_id = $2 AND status IN ('DRAFT', 'QUEUED', 'RUNNING')
      AND (action_version_id = $3 OR action_version_id = $4 OR action_version_id LIKE 'project-copy-%') RETURNING *`, [runId, workspace.id, PROJECT_RESEARCH_ACTION_VERSION, SIMPLIFIED_RESEARCH_WORKFLOW_VERSION]);
  if (!result.rowCount) { const error = new Error('该 Agent 任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status IN ('PENDING', 'RUNNING')", [workspace.id, runId]);
  return runView(result.rows[0]);
});

app.post('/api/v1/creative/projects/:projectId/research/sources/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ planArtifactId: z.string().uuid().optional() }).parse(request.body ?? {});
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  const planResult = await query(`SELECT p.id, p.output_json, p.artifact_id
    FROM project_research_plans p
    WHERE p.workspace_id = $1 AND p.project_id = $2
      AND ($3::uuid IS NULL OR p.artifact_id = $3)
    ORDER BY p.created_at DESC LIMIT 1`, [workspace.id, projectId, input.planArtifactId ?? null]);
  if (!planResult.rowCount) { const error = new Error('请先生成研究计划。'); error.statusCode = 409; throw error; }
  const plan = researchSourceActions(planResult.rows[0].output_json);
  if (plan.counts.search > 0) {
    const tavily = await query("SELECT 1 FROM credential_vault WHERE workspace_id = $1 AND provider = 'TAVILY' AND status = 'READY'", [workspace.id]);
    if (!tavily.rowCount) { const error = new Error('请先在“检索 API”中保存并验证 Tavily Key。'); error.statusCode = 400; throw error; }
  }
  const tools = [
    ...(plan.counts.search ? ['Tavily 网页搜索'] : []),
    ...(plan.counts.read ? ['公开网页读取'] : []),
    ...(plan.counts.askUser ? ['用户补充'] : []),
  ];
  const run = await transaction(async (client) => {
    await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
      WHERE workspace_id = $1 AND action_version_id = $2 AND status = 'DRAFT'
        AND source_snapshot_json->>'projectId' = $3`, [workspace.id, PROJECT_RESEARCH_SOURCES_VERSION, projectId]);
    const created = await client.query(`INSERT INTO generation_runs
      (workspace_id, action_version_id, status, source_snapshot_json, input_json, prompt_version, estimated_cost)
      VALUES ($1, $2, 'DRAFT', $3, '{}'::jsonb, '1.0.0', 'null'::jsonb) RETURNING *`, [
      workspace.id,
      PROJECT_RESEARCH_SOURCES_VERSION,
      JSON.stringify({
        projectId,
        planId: planResult.rows[0].id,
        planArtifactId: planResult.rows[0].artifact_id,
        request: '查找研究资料',
        stage: 'RESEARCH',
        actions: plan.actions,
        counts: plan.counts,
        tools,
      }),
    ]);
    await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, action_run_id, role, content, stage, message_type, metadata_json)
      VALUES ($1, $2, $3, 'USER', '查找研究资料', 'RESEARCH', 'MESSAGE', '{}'::jsonb),
             ($1, $2, $3, 'ASSISTANT', '来源任务已准备，确认后开始执行。', 'RESEARCH', 'CONFIRMATION', $4)`, [
      workspace.id,
      projectId,
      created.rows[0].id,
      JSON.stringify({ action: 'PROJECT_RESEARCH_SOURCES', counts: plan.counts, tools }),
    ]);
    return created.rows[0];
  });
  reply.code(201).send(runView(run));
});

app.post('/api/v1/creative/research-source-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const prepared = await transaction(async (client) => {
    const run = await client.query(`UPDATE generation_runs SET status = 'QUEUED'
      WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'DRAFT'
      RETURNING id`, [runId, workspace.id, PROJECT_RESEARCH_SOURCES_VERSION]);
    if (!run.rowCount) { const error = new Error('该来源任务当前不能确认。'); error.statusCode = 409; throw error; }
    const job = await client.query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'PROJECT_RESEARCH_SOURCES', $2) RETURNING *", [workspace.id, JSON.stringify({ runId })]);
    return job.rows[0];
  });
  try { await enqueue(prepared); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [runId, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [prepared.id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ id: runId, status: 'QUEUED', jobId: prepared.id });
});

app.post('/api/v1/creative/research-source-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const result = await query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
    WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status IN ('DRAFT', 'QUEUED') RETURNING *`, [runId, workspace.id, PROJECT_RESEARCH_SOURCES_VERSION]);
  if (!result.rowCount) { const error = new Error('该来源任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, runId]);
  return runView(result.rows[0]);
});

app.post('/api/v1/creative/projects/:projectId/research/verification/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({
    sourceArtifactId: z.string().uuid(),
    selectedSourceIds: z.array(z.string().uuid()).min(1).max(20),
  }).parse(request.body ?? {});
  const selectedSourceIds = [...new Set(input.selectedSourceIds)];
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  const sourceRunResult = await query(`SELECT sr.id, sr.artifact_id, p.output_json AS plan_output, a.metadata_json
    FROM project_research_source_runs sr
    JOIN project_research_plans p ON p.id = sr.research_plan_id
    JOIN project_artifacts a ON a.id = sr.artifact_id
    WHERE sr.workspace_id = $1 AND sr.project_id = $2 AND sr.artifact_id = $3`, [workspace.id, projectId, input.sourceArtifactId]);
  if (!sourceRunResult.rowCount) { const error = new Error('未找到这组研究来源。'); error.statusCode = 404; throw error; }
  const sourceRun = sourceRunResult.rows[0];
  const sourceRows = await query(`SELECT id, title, url, source_name, summary, metadata_json, status, selected, retrieved_at
    FROM project_research_sources WHERE workspace_id = $1 AND project_id = $2 AND source_run_id = $3
    ORDER BY action_index, retrieved_at`, [workspace.id, projectId, sourceRun.id]);
  const selectedSet = new Set(selectedSourceIds);
  const selectedSources = sourceRows.rows.filter((row) => selectedSet.has(row.id) && row.status === 'CAPTURED').map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source_name,
    summary: row.summary,
    metadata: row.metadata_json ?? {},
    retrievedAt: row.retrieved_at,
  }));
  if (selectedSources.length !== selectedSourceIds.length) { const error = new Error('选择中包含不存在或不可核验的来源，请刷新后重试。'); error.statusCode = 400; throw error; }
  const claims = Array.isArray(sourceRun.plan_output?.claims) ? sourceRun.plan_output.claims : [];
  if (!claims.length) { const error = new Error('研究计划没有待核验主张，请先重新制定研究计划。'); error.statusCode = 400; throw error; }
  const [route, template] = await Promise.all([
    textTaskRoute(workspace.id, SOURCE_VERIFICATION_SCOPE, '事实核验'),
    templateStore.get(workspace.id, SOURCE_VERIFICATION_SCOPE),
  ]);
  const artifactPayload = sourceRun.metadata_json?.payload ?? {};
  const artifactSources = Array.isArray(artifactPayload.sources) ? artifactPayload.sources.map((source) => ({ ...source, selected: selectedSet.has(source.id) })) : [];
  const run = await transaction(async (client) => {
    const active = await client.query(`SELECT 1 FROM generation_runs WHERE workspace_id = $1
      AND source_snapshot_json->>'projectId' = $2 AND action_version_id = $3 AND status IN ('QUEUED', 'RUNNING')`, [workspace.id, projectId, SOURCE_VERIFICATION_VERSION]);
    if (active.rowCount) { const error = new Error('当前已有事实核验任务正在执行。'); error.statusCode = 409; throw error; }
    await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
      WHERE workspace_id = $1 AND source_snapshot_json->>'projectId' = $2 AND action_version_id = $3 AND status = 'DRAFT'`, [workspace.id, projectId, SOURCE_VERIFICATION_VERSION]);
    await client.query('UPDATE project_research_sources SET selected = (id = ANY($4::uuid[])) WHERE workspace_id = $1 AND project_id = $2 AND source_run_id = $3', [workspace.id, projectId, sourceRun.id, selectedSourceIds]);
    await client.query(`UPDATE project_artifacts SET metadata_json = jsonb_set(metadata_json, '{payload,sources}', $2::jsonb, true), updated_at = now()
      WHERE id = $1 AND workspace_id = $3`, [input.sourceArtifactId, JSON.stringify(artifactSources), workspace.id]);
    const created = await client.query(`INSERT INTO generation_runs
      (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
      VALUES ($1, $2, 'DRAFT', $3, $4, $5, '1.0.0', 'null'::jsonb) RETURNING *`, [
      workspace.id,
      SOURCE_VERIFICATION_VERSION,
      JSON.stringify({ projectId, sourceRunId: sourceRun.id, sourceArtifactId: input.sourceArtifactId, request: '核验研究事实', stage: 'RESEARCH', claims, sources: selectedSources, materials: selectedSources }),
      JSON.stringify({ route, template: { id: template.id, version: template.version, body: template.body } }),
      route.model,
    ]);
    await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, action_run_id, role, content, stage, message_type, metadata_json)
      VALUES ($1, $2, $3, 'USER', '核验研究事实', 'RESEARCH', 'MESSAGE', '{}'::jsonb),
             ($1, $2, $3, 'ASSISTANT', '事实核验已准备，确认后调用模型。', 'RESEARCH', 'CONFIRMATION', $4)`, [
      workspace.id,
      projectId,
      created.rows[0].id,
      JSON.stringify({ action: 'SOURCE_VERIFICATION', sourceCount: selectedSources.length, model: route.model }),
    ]);
    return created.rows[0];
  });
  reply.code(201).send(runView(run));
});

app.post('/api/v1/creative/source-verification-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const prepared = await transaction(async (client) => {
    const run = await client.query(`UPDATE generation_runs SET status = 'QUEUED'
      WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'DRAFT' RETURNING id`, [runId, workspace.id, SOURCE_VERIFICATION_VERSION]);
    if (!run.rowCount) { const error = new Error('该事实核验任务当前不能确认。'); error.statusCode = 409; throw error; }
    const job = await client.query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'SOURCE_VERIFICATION', $2) RETURNING *", [workspace.id, JSON.stringify({ runId })]);
    return job.rows[0];
  });
  try { await enqueue(prepared); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [runId, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [prepared.id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ id: runId, status: 'QUEUED', jobId: prepared.id });
});

app.post('/api/v1/creative/source-verification-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const result = await query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
    WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status IN ('DRAFT', 'QUEUED') RETURNING *`, [runId, workspace.id, SOURCE_VERIFICATION_VERSION]);
  if (!result.rowCount) { const error = new Error('该事实核验任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, runId]);
  return runView(result.rows[0]);
});

app.post('/api/v1/creative/research-verifications/:artifactId/accept', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const artifactId = z.string().uuid().parse(request.params.artifactId);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const result = await client.query(`SELECT a.*, v.id AS verification_id, v.output_json
      FROM project_artifacts a JOIN project_source_verifications v ON v.artifact_id = a.id
      WHERE a.id = $1 AND a.workspace_id = $2 AND a.artifact_type = 'RESEARCH_VERIFICATION' AND a.status = 'CANDIDATE'
      FOR UPDATE OF a`, [artifactId, workspace.id]);
    if (!result.rowCount) { const error = new Error('该核验结论当前不能确认。'); error.statusCode = 409; throw error; }
    const artifact = result.rows[0];
    await client.query(`UPDATE project_artifacts SET status = 'REJECTED', updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND artifact_type = 'RESEARCH_VERIFICATION' AND status = 'ACCEPTED' AND id <> $3`, [workspace.id, artifact.project_id, artifact.id]);
    const accepted = await client.query("UPDATE project_artifacts SET status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = $1 RETURNING *", [artifact.id]);
    await client.query('UPDATE project_source_verifications SET confirmed_at = now() WHERE id = $1', [artifact.verification_id]);
    const message = await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
      VALUES ($1, $2, 'ASSISTANT', '研究结论已确认。', 'RESEARCH', 'SYSTEM_EVENT', $3, $4) RETURNING id`, [workspace.id, artifact.project_id, JSON.stringify([artifact.id]), JSON.stringify({ action: 'SOURCE_VERIFICATION_ACCEPTED' })]);
    await projectAgentStore.upsertStageSummary(client, { workspaceId: workspace.id, projectId: artifact.project_id, stage: 'RESEARCH', summary: artifact.output_json.summary, throughMessageId: message.rows[0].id });
    return { artifact: artifactView({ ...accepted.rows[0], payload_json: artifact.output_json, version_number: 1 }) };
  });
});

app.get('/api/v1/creative/projects/:projectId/research', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  await creativeProject(workspace.id, projectId);
  const [messages, run, plan] = await Promise.all([
    query(`SELECT * FROM (
      SELECT id, role, content, action_run_id, stage, message_type, artifact_refs_json, created_at
      FROM project_agent_messages WHERE workspace_id = $1 AND project_id = $2
      ORDER BY created_at DESC LIMIT 100
    ) recent ORDER BY created_at ASC`, [workspace.id, projectId]),
    query(`SELECT r.*, j.id AS job_id FROM generation_runs r
      LEFT JOIN jobs j ON j.workspace_id = r.workspace_id AND j.payload_json->>'runId' = r.id::text
      WHERE r.workspace_id = $1 AND r.action_version_id = $2 AND r.source_snapshot_json->>'projectId' = $3
      ORDER BY r.created_at DESC LIMIT 1`, [workspace.id, PROJECT_RESEARCH_ACTION_VERSION, projectId]),
    query('SELECT * FROM project_research_plans WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1', [workspace.id, projectId]),
  ]);
  const materialIds = await researchMaterialIds(run.rows[0]?.id);
  const usedMaterialIds = await researchMaterialIds(plan.rows[0]?.generation_run_id);
  return {
    messages: messages.rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      runId: row.action_run_id ?? null,
      stage: row.stage,
      messageType: row.message_type,
      artifactRefs: row.artifact_refs_json ?? [],
      createdAt: row.created_at,
    })),
    run: researchRunView(run.rows[0], materialIds),
    plan: researchPlanView(plan.rows[0]),
    usedMaterialIds,
  };
});

app.post('/api/v1/creative/projects/:projectId/research/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = projectResearchInput.parse(request.body);
  const workspace = request.workspace;
  const [project, brief, policy, materialRows] = await Promise.all([
    creativeProject(workspace.id, projectId),
    creativeSkillStore.getBrief(workspace.id, projectId),
    query(`SELECT p.model FROM agent_model_policies p
      JOIN credential_vault c ON c.workspace_id = p.workspace_id AND c.provider = 'BAILIAN' AND c.status = 'READY'
      WHERE p.workspace_id = $1 AND p.scope = $2 AND p.provider = 'BAILIAN_CLI'`, [workspace.id, PROJECT_RESEARCH_SCOPE]),
    projectMaterialStore.researchSnapshot(workspace.id, projectId, input.inputIds, input.referenceIds, input.assetIds),
  ]);
  if (!policy.rowCount) { const error = new Error('请先在“核心 Agent”配置可用的规划模型。'); error.statusCode = 400; throw error; }
  const materials = await projectResearchMaterialSnapshot(materialRows);
  const run = await transaction(async (client) => {
    await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
      WHERE workspace_id = $1 AND action_version_id = $2 AND status = 'DRAFT' AND source_snapshot_json->>'projectId' = $3`, [workspace.id, PROJECT_RESEARCH_ACTION_VERSION, projectId]);
    const created = await client.query(`INSERT INTO generation_runs
      (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
      VALUES ($1, $2, 'DRAFT', $3, $4, $5, '1.0.0', 'null'::jsonb) RETURNING *`, [
      workspace.id, PROJECT_RESEARCH_ACTION_VERSION,
      JSON.stringify({ projectId, project, brief, request: input.request, materials }),
      JSON.stringify({ route: { provider: 'BAILIAN_CLI', model: policy.rows[0].model } }), policy.rows[0].model,
    ]);
    await client.query('INSERT INTO project_agent_messages (workspace_id, project_id, action_run_id, role, content) VALUES ($1, $2, $3, $4, $5)', [workspace.id, projectId, created.rows[0].id, 'USER', input.request]);
    for (const id of input.inputIds) await client.query('INSERT INTO project_research_materials (generation_run_id, input_id) VALUES ($1, $2)', [created.rows[0].id, id]);
    for (const id of input.referenceIds) await client.query('INSERT INTO project_research_materials (generation_run_id, reference_id) VALUES ($1, $2)', [created.rows[0].id, id]);
    for (const id of input.assetIds) await client.query('INSERT INTO project_research_materials (generation_run_id, asset_link_id) VALUES ($1, $2)', [created.rows[0].id, id]);
    return created.rows[0];
  });
  reply.code(201).send(researchRunView(run, { inputIds: input.inputIds, referenceIds: input.referenceIds, assetIds: input.assetIds }));
});

app.post('/api/v1/creative/research-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const run = await query('UPDATE generation_runs SET status = \'QUEUED\' WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = \'DRAFT\' RETURNING id', [runId, workspace.id, PROJECT_RESEARCH_ACTION_VERSION]);
  if (!run.rowCount) { const error = new Error('该研究计划当前不能确认。'); error.statusCode = 409; throw error; }
  const job = await query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'PROJECT_RESEARCH_PLAN', $2) RETURNING *", [workspace.id, JSON.stringify({ runId })]);
  try { await enqueue(job.rows[0]); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [runId, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [job.rows[0].id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ id: runId, status: 'QUEUED', jobId: job.rows[0].id });
});

app.post('/api/v1/creative/research-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const result = await query("UPDATE generation_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status IN ('DRAFT', 'QUEUED') RETURNING id, status", [runId, workspace.id, PROJECT_RESEARCH_ACTION_VERSION]);
  if (!result.rowCount) { const error = new Error('该研究计划当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, runId]);
  return result.rows[0];
});

app.post('/api/v1/creative/projects/:projectId/outline/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform }).parse(request.body);
  const workspace = request.workspace;
  const templateScope = outlineTemplateScope(input.platform);
  const [project, context, route, template] = await Promise.all([
    creativeProject(workspace.id, projectId),
    creativeSkillStore.getContext(workspace.id, projectId, input.platform),
    textTaskRoute(workspace.id, OUTLINE_SCOPE, '文案生成'),
    templateStore.get(workspace.id, templateScope),
  ]);
  if (!context) throw new Error('请先保存创作设定和写作策略。');
  if (!context.brief.selectedPlatforms.includes(input.platform)) throw new Error('目标平台不在已保存的创作设定中。');
  const platformVersion = project.versions?.find((version) => version.platform === input.platform);
  if (!platformVersion) throw new Error('项目没有对应的图文平台版本。');
  const sourceSnapshot = { project, brief: context.brief, accountVoice: context.accountVoice, skills: context.skills, platform: input.platform };
  const runInput = { template: { id: template.id, version: template.version, body: template.body }, route: { provider: route.provider, connectionId: route.connectionId ?? null, model: route.model } };
  const run = await query(`INSERT INTO generation_runs
    (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
    VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, 'null'::jsonb)
    RETURNING id, status, created_at`, [workspace.id, OUTLINE_ACTION_VERSION, JSON.stringify(sourceSnapshot), JSON.stringify(runInput), route.model, String(template.version)]);
  reply.code(201).send({
    id: run.rows[0].id,
    status: run.rows[0].status,
    createdAt: run.rows[0].created_at,
    confirmation: { model: route.model, platform: input.platform, actionVersion: OUTLINE_ACTION_VERSION, promptVersion: template.version, skills: context.skills.map((skill) => ({ dimension: skill.dimension, name: skill.name, version: skill.version.version })), costEstimate: null },
  });
});

app.post('/api/v1/creative/outline-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const run = await query("UPDATE generation_runs SET status = 'QUEUED' WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'DRAFT' RETURNING id", [runId, workspace.id, OUTLINE_ACTION_VERSION]);
  if (!run.rowCount) { const error = new Error('该大纲任务当前不能确认。'); error.statusCode = 409; throw error; }
  const job = await query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'CREATIVE_OUTLINE', $2) RETURNING *", [workspace.id, JSON.stringify({ runId: run.rows[0].id })]);
  try { await enqueue(job.rows[0]); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [run.rows[0].id, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [job.rows[0].id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ id: run.rows[0].id, status: 'QUEUED', jobId: job.rows[0].id });
});

app.post('/api/v1/creative/outline-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const result = await query("UPDATE generation_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status IN ('DRAFT', 'QUEUED') RETURNING id, status", [runId, workspace.id, OUTLINE_ACTION_VERSION]);
  if (!result.rowCount) { const error = new Error('该大纲任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, runId]);
  return result.rows[0];
});

app.get('/api/v1/creative/projects/:projectId/outline/latest-run', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const input = z.object({ platform: creativePlatform }).parse(request.query);
  const workspace = request.workspace;
  const result = await query(`SELECT r.id, r.status, r.error, r.model, r.prompt_version, r.source_snapshot_json, r.created_at,
      (SELECT j.id FROM jobs j WHERE j.workspace_id = r.workspace_id AND j.payload_json->>'runId' = r.id::text ORDER BY j.created_at DESC LIMIT 1) AS job_id
    FROM generation_runs r
    WHERE r.workspace_id = $1 AND r.action_version_id = $2 AND r.source_snapshot_json->'project'->>'id' = $3
      AND r.source_snapshot_json->>'platform' = $4
    ORDER BY r.created_at DESC LIMIT 1`, [workspace.id, OUTLINE_ACTION_VERSION, request.params.projectId, input.platform]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: row.id, status: row.status, error: row.error ?? undefined, jobId: row.job_id ?? undefined, createdAt: row.created_at, confirmation: { model: row.model, platform: row.source_snapshot_json.platform, actionVersion: OUTLINE_ACTION_VERSION, promptVersion: Number(row.prompt_version), skills: (row.source_snapshot_json.skills ?? []).map((skill) => ({ dimension: skill.dimension, name: skill.name, version: skill.version?.version ?? skill.version })) } };
});

app.get('/api/v1/creative/projects/:projectId/outline/latest', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const input = z.object({ platform: creativePlatform }).parse(request.query);
  const workspace = request.workspace;
  const result = await query(`SELECT c.*, r.model FROM creative_outline_candidates c
    JOIN generation_runs r ON r.id = c.generation_run_id
    WHERE c.workspace_id = $1 AND c.project_id = $2 AND c.platform = $3
    ORDER BY c.created_at DESC LIMIT 1`, [workspace.id, request.params.projectId, input.platform]);
  return outlineCandidateView(result.rows[0]);
});

app.post('/api/v1/creative/outline-candidates/:id/accept', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const candidateId = z.string().uuid().parse(request.params.id);
  const input = z.object({ selectedTitle: z.string().min(1).max(120) }).parse(request.body);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const candidateResult = await client.query(`SELECT c.*, r.model FROM creative_outline_candidates c
      JOIN generation_runs r ON r.id = c.generation_run_id
      WHERE c.id = $1 AND c.workspace_id = $2 AND c.status = 'CANDIDATE' FOR UPDATE OF c`, [candidateId, workspace.id]);
    if (!candidateResult.rowCount) { const error = new Error('该大纲候选当前不能接受。'); error.statusCode = 409; throw error; }
    const candidate = candidateResult.rows[0];
    if (!candidate.output_json.titleOptions.includes(input.selectedTitle)) throw new Error('请选择候选中提供的标题。');
    const updatedAt = new Date().toISOString();
    let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const projectIndex = state.projects.findIndex((item) => item.id === candidate.project_id);
      if (projectIndex < 0) throw new Error('正式文案版本已不存在，无法接受大纲。');
      const current = state.projects[projectIndex];
      const versionIndex = current.versions.findIndex((item) => item.platform === candidate.platform);
      if (versionIndex < 0) throw new Error('正式文案版本已不存在，无法接受大纲。');
      const versions = [...current.versions];
      versions[versionIndex] = { ...versions[versionIndex], title: input.selectedTitle, status: 'DRAFT', updatedAt };
      project = { ...current, versions, status: 'WRITING', updatedAt };
      const projects = [...state.projects];
      projects[projectIndex] = project;
      return { ...state, projects };
    }, updatedAt);
    const superseded = await client.query("UPDATE creative_outline_candidates SET status = 'REJECTED', updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND platform = $3 AND status = 'ACCEPTED' AND id <> $4 RETURNING id", [workspace.id, candidate.project_id, candidate.platform, candidate.id]);
    const supersededIds = superseded.rows.map((row) => row.id);
    if (supersededIds.length) await client.query("UPDATE creative_draft_candidates SET status = 'REJECTED', updated_at = now() WHERE workspace_id = $1 AND outline_candidate_id = ANY($2::uuid[]) AND status IN ('CANDIDATE', 'ACCEPTED')", [workspace.id, supersededIds]);
    const accepted = await client.query("UPDATE creative_outline_candidates SET status = 'ACCEPTED', selected_title = $3, accepted_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING *", [candidate.id, workspace.id, input.selectedTitle]);
    return { candidate: outlineCandidateView({ ...accepted.rows[0], model: candidate.model }), project };
  });
});

app.post('/api/v1/creative/projects/:projectId/draft/prepare', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform }).parse(request.body);
  const workspace = request.workspace;
  const templateScope = draftTemplateScope(input.platform);
  const [project, context, route, template, outlineResult] = await Promise.all([
    creativeProject(workspace.id, projectId),
    creativeSkillStore.getContext(workspace.id, projectId, input.platform),
    textTaskRoute(workspace.id, DRAFT_SCOPE, '文案生成'),
    templateStore.get(workspace.id, templateScope),
    query(`SELECT * FROM creative_outline_candidates
      WHERE workspace_id = $1 AND project_id = $2 AND platform = $3 AND status = 'ACCEPTED'
      ORDER BY accepted_at DESC LIMIT 1`, [workspace.id, projectId, input.platform]),
  ]);
  if (!context) throw new Error('请先保存创作设定和写作策略。');
  if (!context.brief.selectedPlatforms.includes(input.platform)) throw new Error('目标平台不在已保存的创作设定中。');
  if (!outlineResult.rowCount) { const error = new Error('请先采用当前平台的大纲。'); error.statusCode = 409; throw error; }
  const platformVersion = project.versions?.find((version) => version.platform === input.platform);
  if (!platformVersion) throw new Error('项目没有对应的图文平台版本。');
  const outlineRow = outlineResult.rows[0];
  const outline = { id: outlineRow.id, selectedTitle: outlineRow.selected_title, ...outlineRow.output_json };
  const sourceSnapshot = { project, brief: context.brief, skills: context.skills, platform: input.platform, outline };
  const runInput = { template: { id: template.id, version: template.version, body: template.body }, route: { provider: route.provider, connectionId: route.connectionId ?? null, model: route.model } };
  const run = await query(`INSERT INTO generation_runs
    (workspace_id, action_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
    VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, 'null'::jsonb)
    RETURNING id, status, created_at`, [workspace.id, DRAFT_ACTION_VERSION, JSON.stringify(sourceSnapshot), JSON.stringify(runInput), route.model, String(template.version)]);
  reply.code(201).send({
    id: run.rows[0].id,
    status: run.rows[0].status,
    createdAt: run.rows[0].created_at,
    confirmation: { model: route.model, platform: input.platform, actionVersion: DRAFT_ACTION_VERSION, promptVersion: template.version, skills: context.skills.map((skill) => ({ dimension: skill.dimension, name: skill.name, version: skill.version.version })), costEstimate: null },
  });
});

app.post('/api/v1/creative/draft-runs/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const run = await query("UPDATE generation_runs SET status = 'QUEUED' WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'DRAFT' RETURNING id", [runId, workspace.id, DRAFT_ACTION_VERSION]);
  if (!run.rowCount) { const error = new Error('该初稿任务当前不能确认。'); error.statusCode = 409; throw error; }
  const job = await query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'CREATIVE_DRAFT', $2) RETURNING *", [workspace.id, JSON.stringify({ runId: run.rows[0].id })]);
  try { await enqueue(job.rows[0]); }
  catch (error) {
    const message = error instanceof Error ? error.message : '任务入队失败。';
    await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [run.rows[0].id, message.slice(0, 2_000)]);
    await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [job.rows[0].id, message.slice(0, 2_000)]);
    throw error;
  }
  reply.code(202).send({ id: run.rows[0].id, status: 'QUEUED', jobId: job.rows[0].id });
});

app.post('/api/v1/creative/draft-runs/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const runId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  const result = await query("UPDATE generation_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status IN ('DRAFT', 'QUEUED') RETURNING id, status", [runId, workspace.id, DRAFT_ACTION_VERSION]);
  if (!result.rowCount) { const error = new Error('该初稿任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, runId]);
  return result.rows[0];
});

app.get('/api/v1/creative/projects/:projectId/draft/latest-run', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const input = z.object({ platform: creativePlatform }).parse(request.query);
  const workspace = request.workspace;
  const result = await query(`SELECT r.id, r.status, r.error, r.model, r.prompt_version, r.source_snapshot_json, r.created_at,
      (SELECT j.id FROM jobs j WHERE j.workspace_id = r.workspace_id AND j.payload_json->>'runId' = r.id::text ORDER BY j.created_at DESC LIMIT 1) AS job_id
    FROM generation_runs r
    WHERE r.workspace_id = $1 AND r.action_version_id = $2 AND r.source_snapshot_json->'project'->>'id' = $3
      AND r.source_snapshot_json->>'platform' = $4
      AND EXISTS (SELECT 1 FROM creative_outline_candidates o WHERE o.id::text = r.source_snapshot_json->'outline'->>'id' AND o.status = 'ACCEPTED')
    ORDER BY r.created_at DESC LIMIT 1`, [workspace.id, DRAFT_ACTION_VERSION, request.params.projectId, input.platform]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: row.id, status: row.status, error: row.error ?? undefined, jobId: row.job_id ?? undefined, createdAt: row.created_at, confirmation: { model: row.model, platform: row.source_snapshot_json.platform, actionVersion: DRAFT_ACTION_VERSION, promptVersion: Number(row.prompt_version), skills: (row.source_snapshot_json.skills ?? []).map((skill) => ({ dimension: skill.dimension, name: skill.name, version: skill.version?.version ?? skill.version })) } };
});

app.get('/api/v1/creative/projects/:projectId/draft/latest', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const input = z.object({ platform: creativePlatform }).parse(request.query);
  const workspace = request.workspace;
  const result = await query(`SELECT c.*, r.model, r.prompt_version FROM creative_draft_candidates c
    JOIN generation_runs r ON r.id = c.generation_run_id
    JOIN creative_outline_candidates o ON o.id = c.outline_candidate_id AND o.status = 'ACCEPTED'
    WHERE c.workspace_id = $1 AND c.project_id = $2 AND c.platform = $3 AND c.status <> 'REJECTED'
    ORDER BY c.created_at DESC LIMIT 1`, [workspace.id, request.params.projectId, input.platform]);
  return draftCandidateView(result.rows[0]);
});

app.post('/api/v1/creative/draft-candidates/:id/accept', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const candidateId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const candidateResult = await client.query(`SELECT c.*, r.model, r.prompt_version FROM creative_draft_candidates c
      JOIN generation_runs r ON r.id = c.generation_run_id
      JOIN creative_outline_candidates o ON o.id = c.outline_candidate_id AND o.status = 'ACCEPTED'
      WHERE c.id = $1 AND c.workspace_id = $2 AND c.status = 'CANDIDATE' FOR UPDATE OF c`, [candidateId, workspace.id]);
    if (!candidateResult.rowCount) { const error = new Error('该初稿候选当前不能接受。'); error.statusCode = 409; throw error; }
    const candidate = candidateResult.rows[0];
    const updatedAt = new Date().toISOString();
    let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const projectIndex = state.projects.findIndex((item) => item.id === candidate.project_id);
      if (projectIndex < 0) throw new Error('正式文案版本已不存在，无法接受初稿。');
      const current = state.projects[projectIndex];
      const versionIndex = current.versions.findIndex((item) => item.platform === candidate.platform);
      if (versionIndex < 0) throw new Error('正式文案版本已不存在，无法接受初稿。');
      const versions = [...current.versions];
      versions[versionIndex] = { ...versions[versionIndex], title: candidate.output_json.title, body: candidate.output_json.body, status: 'DRAFT', updatedAt };
      project = {
        ...current,
        versions,
        status: 'WRITING',
        factChecks: [...new Set([...(current.factChecks ?? []), ...(candidate.output_json.factsToVerify ?? [])])],
        updatedAt,
      };
      const projects = [...state.projects];
      projects[projectIndex] = project;
      return { ...state, projects };
    }, updatedAt);
    await client.query("UPDATE creative_draft_candidates SET status = 'REJECTED', updated_at = now() WHERE workspace_id = $1 AND outline_candidate_id = $2 AND id <> $3 AND status IN ('CANDIDATE', 'ACCEPTED')", [workspace.id, candidate.outline_candidate_id, candidate.id]);
    const accepted = await client.query("UPDATE creative_draft_candidates SET status = 'ACCEPTED', accepted_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING *", [candidate.id, workspace.id]);
    return { candidate: draftCandidateView({ ...accepted.rows[0], model: candidate.model, prompt_version: candidate.prompt_version }), project };
  });
});

app.post('/api/v1/creative/project-artifacts/:id/accept', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const artifactId = z.string().uuid().parse(request.params.id);
  const input = z.object({ selectedTitle: z.string().trim().min(1).max(120).optional() }).parse(request.body ?? {});
  const workspace = request.workspace;
  return transaction(async (client) => {
    const candidateResult = await client.query(`SELECT a.*, r.source_snapshot_json,
        v.id AS content_version_id, v.title AS content_title, v.body AS content_body,
        v.facts_to_verify_json, v.change_summary
      FROM project_artifacts a
      LEFT JOIN generation_runs r ON r.id = a.action_run_id
      LEFT JOIN platform_content_versions v ON v.artifact_id = a.id
      WHERE a.id = $1 AND a.workspace_id = $2 AND a.status = 'CANDIDATE'
        AND a.artifact_type IN ('OUTLINE', 'PLATFORM_COPY')
      FOR UPDATE OF a`, [artifactId, workspace.id]);
    if (!candidateResult.rowCount) { const error = new Error('该候选产物当前不能采用。'); error.statusCode = 409; throw error; }
    const candidate = candidateResult.rows[0];
    const updatedAt = new Date().toISOString();
    let project;
    let summary;
    await updateCreativeProjects(client, workspace.id, async (state) => {
      if (candidate.artifact_type === 'OUTLINE') {
        const payload = candidate.metadata_json?.payload ?? {};
        const selectedTitle = input.selectedTitle ?? payload.titleOptions?.[0];
        if (!selectedTitle || (payload.titleOptions?.length && !payload.titleOptions.includes(selectedTitle))) throw new Error('请选择候选大纲中提供的标题。');
        const projectIndex = state.projects.findIndex((item) => item.id === candidate.project_id);
        const currentProject = state.projects[projectIndex];
        const versionIndex = currentProject?.versions?.findIndex((item) => item.platform === candidate.platform) ?? -1;
        if (!currentProject || versionIndex < 0) throw new Error('正式文案版本已不存在，无法采用候选。');
        const versions = [...currentProject.versions];
        versions[versionIndex] = { ...versions[versionIndex], title: selectedTitle, status: 'DRAFT', updatedAt };
        project = {
          ...currentProject,
          versions,
          status: 'WRITING',
          factChecks: mergeFactsToVerify(currentProject.factChecks ?? [], payload.factsToVerify ?? []),
          updatedAt,
        };
        const projects = [...state.projects];
        projects[projectIndex] = project;
        summary = payload.summary || `已采用${creativePlatformNames[candidate.platform]}大纲。`;
        return { ...state, projects };
      }

      if (!candidate.content_version_id) throw new Error('候选文案内容已不存在。');
      const masterState = await loadContentMasterState(client, workspace.id, candidate.project_id);
      let masterId = masterState.acceptedMasterId;
      const candidateFacts = mergeFactsToVerify(candidate.facts_to_verify_json ?? []);
      if (!masterId) {
        const masterArtifact = await projectAgentStore.createArtifact(client, {
          workspaceId: workspace.id,
          projectId: candidate.project_id,
          type: 'CONTENT_MASTER',
          stage: 'COPY',
          status: 'ACCEPTED',
          actionRunId: candidate.action_run_id,
          title: candidate.content_title,
        });
        const materialRefs = (candidate.source_snapshot_json?.materials ?? []).map((material) => material.id).filter(Boolean);
        const createdMaster = await client.query(`INSERT INTO content_master_versions
          (workspace_id, project_id, artifact_id, version_number, thesis, facts_to_verify_json, material_refs_json, parent_version_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [
          workspace.id,
          candidate.project_id,
          masterArtifact.id,
          masterState.nextVersion,
          candidate.source_snapshot_json?.project?.coreViewpoint || candidate.content_title,
          JSON.stringify(candidateFacts),
          JSON.stringify(materialRefs),
          masterState.parentVersionId,
        ]);
        masterId = createdMaster.rows[0].id;
      }
      await client.query('UPDATE platform_content_versions SET content_master_version_id = $1 WHERE id = $2', [masterId, candidate.content_version_id]);
      const applied = applyAcceptedCopyToState(state, {
        projectId: candidate.project_id,
        platform: candidate.platform,
        title: candidate.content_title,
        body: candidate.content_body,
        factsToVerify: candidateFacts,
        updatedAt,
      });
      project = applied.project;
      summary = candidate.change_summary || `已采用${creativePlatformNames[candidate.platform]}文案候选。`;
      return applied.state;
    }, updatedAt);
    await client.query(`UPDATE project_artifacts SET status = 'REJECTED', updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND platform = $3 AND artifact_type = $4
        AND status = 'ACCEPTED' AND id <> $5`, [workspace.id, candidate.project_id, candidate.platform, candidate.artifact_type, candidate.id]);
    const acceptedResult = await client.query(`UPDATE project_artifacts SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
      WHERE id = $1 AND workspace_id = $2 RETURNING *`, [candidate.id, workspace.id]);
    await projectAgentStore.upsertStageSummary(client, {
      workspaceId: workspace.id,
      projectId: candidate.project_id,
      stage: 'COPY',
      platform: candidate.platform,
      summary,
      throughMessageId: candidate.created_by_message_id,
    });
    return { artifact: artifactView({ ...acceptedResult.rows[0], payload_json: candidate.metadata_json?.payload ?? {}, version_number: 1 }), project };
  });
});

app.post('/api/v1/creative/project-artifacts/:id/reject', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const artifactId = z.string().uuid().parse(request.params.id);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const result = await client.query(`UPDATE project_artifacts
      SET status = 'REJECTED', updated_at = now()
      WHERE id = $1 AND workspace_id = $2 AND status = 'CANDIDATE'
        AND artifact_type IN ('OUTLINE', 'PLATFORM_COPY')
      RETURNING id, project_id, platform`, [artifactId, workspace.id]);
    if (!result.rowCount) { const error = new Error('该候选产物当前不能废弃。'); error.statusCode = 409; throw error; }
    const artifact = result.rows[0];
    await client.query(`INSERT INTO project_agent_messages
      (workspace_id, project_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
      VALUES ($1, $2, 'ASSISTANT', '候选已废弃。', 'COPY', 'SYSTEM_EVENT', $3, $4)`, [
      workspace.id,
      artifact.project_id,
      JSON.stringify([artifact.id]),
      JSON.stringify({ platform: artifact.platform }),
    ]);
    return { id: artifact.id, status: 'REJECTED' };
  });
});

app.post('/api/v1/creative/projects/:projectId/platforms/:platform', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const platformValue = String(request.params.platform);
  if (platformValue === 'VIDEO_CHANNEL') throw new Error('视频号使用独立的视频创作流程。');
  const platform = creativePlatform.parse(platformValue);
  const workspace = request.workspace;
  return transaction(async (client) => {
    await client.query(`INSERT INTO platform_strategies (workspace_id, project_id, platform)
      VALUES ($1, $2, $3) ON CONFLICT (workspace_id, project_id, platform) DO NOTHING`, [workspace.id, projectId, platform]);
    const updatedAt = new Date().toISOString();
    let project;
    let created = false;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const projectIndex = state.projects.findIndex((item) => item.id === projectId);
      if (projectIndex < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[projectIndex];
      if (current.versions?.some((version) => version.platform === platform)) { project = current; return state; }
      created = true;
      project = { ...current, versions: [...(current.versions ?? []), { id: randomUUID(), platform, status: 'DRAFT', title: '', body: '', updatedAt }], updatedAt };
      const projects = [...state.projects];
      projects[projectIndex] = project;
      return { ...state, projects };
    }, updatedAt);
    return { project, platform, created };
  });
});

app.post('/api/v1/creative/projects/:projectId/platform-versions/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform }).parse(request.body);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const updatedAt = new Date().toISOString();
    let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const projectIndex = state.projects.findIndex((item) => item.id === projectId);
      if (projectIndex < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[projectIndex];
      if (!['MASTER_WRITING', 'PLATFORM_ADAPTATION'].includes(current.stage)) { const error = new Error('当前项目不在创作阶段。'); error.statusCode = 409; throw error; }
      const version = current.versions?.find((item) => item.platform === input.platform);
      if (!version || String(version.body ?? '').trim().length < 80) { const error = new Error(`请先完成${creativePlatformNames[input.platform] ?? input.platform}的正文。`); error.statusCode = 409; throw error; }
      const delivery = deliveryOf(current);
      const currentPlatform = platformDelivery(delivery, input.platform);
      project = {
        ...current,
        delivery: { ...delivery, platforms: { ...delivery.platforms, [input.platform]: { ...currentPlatform, stage: needsVisual(input.platform) ? 'VISUAL' : 'LAYOUT' } } },
        stage: 'PLATFORM_ADAPTATION',
        status: 'WRITING',
        updatedAt,
      };
      const projects = [...state.projects];
      projects[projectIndex] = project;
      return { ...state, projects };
    }, updatedAt);
    return { project };
  });
});

function deliveryOf(project) {
  const delivery = project?.delivery && typeof project.delivery === 'object' ? project.delivery : {};
  if (delivery.platforms && typeof delivery.platforms === 'object') return { platforms: delivery.platforms };
  // Compatibility for projects created before channel-level delivery existed.
  const legacyLayouts = delivery.layouts && typeof delivery.layouts === 'object' ? delivery.layouts : {};
  const legacyPlatforms = {};
  for (const [platform, layout] of Object.entries(legacyLayouts)) {
    legacyPlatforms[platform] = { stage: delivery.review ? 'READY' : 'REVIEW', visual: delivery.visual ?? null, layout, review: delivery.review ?? null };
  }
  return { platforms: legacyPlatforms };
}

function needsVisual(platform) { return platform !== 'WEIBO'; }
function platformDelivery(delivery, platform) {
  return delivery.platforms?.[platform] ?? { stage: 'COPY', visual: null, layout: undefined, review: null };
}
function targetCreativePlatforms(project) {
  return (project.planning?.targetPlatforms ?? project.versions?.map((version) => version.platform) ?? []).filter((platform) => platform !== 'VIDEO_CHANNEL');
}
function allTargetPlatformsReady(project, delivery) {
  const targets = targetCreativePlatforms(project);
  return targets.length > 0 && targets.every((platform) => platformDelivery(delivery, platform).stage === 'READY');
}

function escapeDeliveryHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function documentForPlatform(project, platform, visual, now) {
  const version = (project.versions ?? []).find((item) => item.platform === platform);
  const title = String(version?.title || project.title || '未命名内容').trim();
  const paragraphs = String(version?.body ?? '').split(/\n\s*\n|\r?\n/).map((item) => item.trim()).filter(Boolean);
  const assets = visual?.assets ?? [];
  const coverAsset = assets.find((asset) => asset.role === 'COVER');
  const bodyAssets = assets.filter((asset) => asset.assetId !== coverAsset?.assetId);
  const assetBlock = (asset) => asset.url
    ? `<figure data-placement="${escapeDeliveryHtml(asset.placement ?? '')}"><img src="${escapeDeliveryHtml(asset.url)}" alt="${escapeDeliveryHtml(asset.title)}"/><figcaption>${escapeDeliveryHtml(asset.title)}</figcaption></figure>`
    : `<p>【配图素材：${escapeDeliveryHtml(asset.title)}】</p>`;
  if (platform === 'XIAOHONGSHU' || platform === 'WEIBO') {
    const content = [`# ${title}`, ...(coverAsset ? [`【首图：${coverAsset.title}】`] : []), ...paragraphs, ...bodyAssets.map((asset) => `【${asset.placement || '配图'}：${asset.title}】`)].join('\n\n');
    return { platform, format: 'MARKDOWN', content, generatedAt: now };
  }
  const interval = Math.max(1, Math.ceil(paragraphs.length / Math.max(1, bodyAssets.length)));
  const articleBlocks = paragraphs.flatMap((item, index) => {
    const blocks = [`<p>${escapeDeliveryHtml(item)}</p>`];
    const asset = bodyAssets[Math.floor(index / interval)];
    if (asset && (index + 1) % interval === 0) blocks.push(assetBlock(asset));
    return blocks;
  });
  const used = new Set(bodyAssets.slice(0, Math.floor(paragraphs.length / interval)).map((asset) => asset.assetId));
  const remaining = bodyAssets.filter((asset) => !used.has(asset.assetId)).map(assetBlock);
  const content = `<article>\n<h1>${escapeDeliveryHtml(title)}</h1>\n${coverAsset ? assetBlock(coverAsset) : ''}\n${[...articleBlocks, ...remaining].join('\n')}\n</article>`;
  return { platform, format: 'HTML', content, generatedAt: now };
}

app.get('/api/v1/creative/projects/:projectId/delivery', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const workspace = request.workspace;
  return { delivery: deliveryOf(await creativeProject(workspace.id, projectId)) };
});

app.put('/api/v1/creative/projects/:projectId/visual', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({
    draftId: z.string().uuid(),
    revision: z.number().int().positive(),
    planVersion: z.number().int().min(1).max(100),
    styleProfile: z.object({
      preset: visualStylePreset,
      customPrompt: z.string().trim().max(1_200).default(''),
    }).default({ preset: 'FRESH_EDITORIAL', customPrompt: '' }),
    coverAssetId: z.string().uuid().nullable(),
    assetIds: z.array(z.string().uuid()).max(12),
    plan: z.array(visualPlanItemInput).max(12).default([]),
  }).superRefine((value, context) => {
    const assigned = value.plan.map((item) => item.assetId).filter(Boolean);
    if (new Set(assigned).size !== assigned.length) context.addIssue({ code: 'custom', path: ['plan'], message: '同一张图片不能绑定到多个配图位置。' });
    try {
      validateVisualPlanImageCount('WECHAT', Math.max(value.assetIds.length, value.plan.length));
    } catch (error) {
      context.addIssue({ code: 'custom', path: ['assetIds'], message: error instanceof Error ? error.message : '配图数量超过平台上限。' });
    }
  }).parse(request.body);
  const workspace = request.workspace;
  const draft = await draftStore.get(workspace.id, input.draftId);
  if (draft.projectId !== projectId || draft.platform !== 'WECHAT') throw businessError(400, 'WECHAT_DRAFT_REQUIRED', '配图只能保存到当前项目的公众号母稿。');
  if (String(draft.body ?? '').trim().length < 80) throw businessError(409, 'WECHAT_DRAFT_REQUIRED', '请先完成公众号正文。');
  return transaction(async (client) => {
    const listed = await projectMaterialStore.list(workspace.id, projectId);
    const requested = [...new Set([...input.assetIds, ...input.plan.map((item) => item.assetId).filter(Boolean)])];
    if (input.coverAssetId && !requested.includes(input.coverAssetId)) requested.unshift(input.coverAssetId);
    const assets = listed.assets.filter((item) => requested.includes(item.id));
    if (assets.length !== requested.length) { const error = new Error('存在不属于当前项目的素材。'); error.statusCode = 400; throw error; }
    const invalid = assets.find((item) => item.kind !== 'IMAGE' || !item.mimeType?.startsWith('image/'));
    if (invalid) { const error = new Error(`“${invalid.title}”不是可用的视觉素材。`); error.statusCode = 400; throw error; }
    const assetById = new Map(assets.map((item) => [item.id, item]));
    const assignedKeys = input.plan.flatMap((item) => {
      if (!item.assetId) return [];
      const asset = assetById.get(item.assetId);
      return [asset?.sha256 || item.assetId];
    });
    if (new Set(assignedKeys).size !== assignedKeys.length) { const error = new Error('同一张图片不能绑定到多个配图位置。'); error.statusCode = 400; throw error; }
    const patched = await draftStore.patchWorkingCopy(workspace.id, draft.id, {
      revision: input.revision,
      visualPlan: {
        planVersion: input.planVersion,
        styleProfile: input.styleProfile,
        coverAssetId: input.coverAssetId,
        plan: input.plan,
      },
    }, client);
    const roleByAssetId = new Map(input.plan.flatMap((item) => item.assetId
      ? [[item.assetId, item.role === 'COVER' || item.role === 'MAIN' ? 'COVER' : 'BODY']]
      : []));
    const saved = await draftStore.replaceWorkingAssets(workspace.id, draft.id, {
      revision: patched.revision,
      assets: requested.map((assetId) => ({
        assetId,
        role: roleByAssetId.get(assetId) ?? (assetId === input.coverAssetId ? 'COVER' : 'BODY'),
      })),
    }, client);
    return { draft: saved };
  });
});

app.post('/api/v1/creative/projects/:projectId/visual/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform }).parse(request.body);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const now = new Date().toISOString(); let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const index = state.projects.findIndex((item) => item.id === projectId);
      if (index < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[index];
      const delivery = deliveryOf(current); const currentPlatform = platformDelivery(delivery, input.platform);
      if (currentPlatform.stage !== 'VISUAL') { const error = new Error('当前渠道不在配图阶段。'); error.statusCode = 409; throw error; }
      project = { ...current, stage: 'PLATFORM_ADAPTATION', status: 'WRITING', delivery: { ...delivery, platforms: { ...delivery.platforms, [input.platform]: { ...currentPlatform, stage: 'LAYOUT' } } }, updatedAt: now };
      const projects = [...state.projects]; projects[index] = project;
      return { ...state, projects };
    }, now);
    return { project };
  });
});

app.post('/api/v1/creative/projects/:projectId/layout/generate', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform }).parse(request.body);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const now = new Date().toISOString(); let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const index = state.projects.findIndex((item) => item.id === projectId);
      if (index < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[index];
      const delivery = deliveryOf(current); const currentPlatform = platformDelivery(delivery, input.platform);
      if (currentPlatform.stage !== 'LAYOUT') { const error = new Error('当前渠道不在排版阶段。'); error.statusCode = 409; throw error; }
      const version = (current.versions ?? []).find((item) => item.platform === input.platform);
      if (!version || !String(version.body ?? '').trim()) { const error = new Error('请先完成当前渠道的正文。'); error.statusCode = 409; throw error; }
      project = { ...current, delivery: { ...delivery, platforms: { ...delivery.platforms, [input.platform]: { ...currentPlatform, layout: documentForPlatform(current, input.platform, currentPlatform.visual, now) } } }, updatedAt: now };
      const projects = [...state.projects]; projects[index] = project;
      return { ...state, projects };
    }, now);
    return { project, delivery: deliveryOf(project) };
  });
});

app.post('/api/v1/creative/projects/:projectId/layout/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform }).parse(request.body);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const now = new Date().toISOString(); let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const index = state.projects.findIndex((item) => item.id === projectId);
      if (index < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[index]; const delivery = deliveryOf(current); const currentPlatform = platformDelivery(delivery, input.platform);
      if (currentPlatform.stage !== 'LAYOUT') { const error = new Error('当前渠道不在排版阶段。'); error.statusCode = 409; throw error; }
      if (!currentPlatform.layout) { const error = new Error('请先生成当前渠道的排版预览。'); error.statusCode = 409; throw error; }
      project = { ...current, stage: 'PLATFORM_ADAPTATION', status: 'WRITING', delivery: { ...delivery, platforms: { ...delivery.platforms, [input.platform]: { ...currentPlatform, stage: 'REVIEW' } } }, updatedAt: now };
      const projects = [...state.projects]; projects[index] = project;
      return { ...state, projects };
    }, now);
    return { project };
  });
});

app.post('/api/v1/creative/projects/:projectId/review/complete', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const projectId = z.string().min(1).max(200).parse(request.params.projectId);
  const input = z.object({ platform: creativePlatform, acknowledgedFactChecks: z.array(z.string().min(1).max(2_000)).max(100) }).parse(request.body);
  const workspace = request.workspace;
  return transaction(async (client) => {
    const now = new Date().toISOString(); let project;
    await updateCreativeProjects(client, workspace.id, (state) => {
      const index = state.projects.findIndex((item) => item.id === projectId);
      if (index < 0) { const error = new Error('未找到这个内容项目。'); error.statusCode = 404; throw error; }
      const current = state.projects[index]; const delivery = deliveryOf(current); const currentPlatform = platformDelivery(delivery, input.platform);
      if (currentPlatform.stage !== 'REVIEW') { const error = new Error('当前渠道不在审核阶段。'); error.statusCode = 409; throw error; }
      const required = [...new Set(current.factChecks ?? [])];
      const confirmed = new Set(input.acknowledgedFactChecks);
      if (required.some((item) => !confirmed.has(item))) { const error = new Error('请先确认所有需要人工核对的事实。'); error.statusCode = 409; throw error; }
      const nextDelivery = { ...delivery, platforms: { ...delivery.platforms, [input.platform]: { ...currentPlatform, stage: 'READY', review: { acknowledgedFactChecks: required, completedAt: now } } } };
      project = { ...current, stage: allTargetPlatformsReady(current, nextDelivery) ? 'COMPLETED' : 'PLATFORM_ADAPTATION', status: allTargetPlatformsReady(current, nextDelivery) ? 'SCHEDULED' : 'WRITING', delivery: nextDelivery, updatedAt: now };
      const projects = [...state.projects]; projects[index] = project;
      return { ...state, projects };
    }, now);
    return { project, delivery: deliveryOf(project) };
  });
});

app.get('/api/v1/agent/skills', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => listAvailableSkills(request.workspace.id));

app.get('/api/v1/agent/model-policies/:scope', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query('SELECT scope, provider, model, updated_at FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspace.id, String(request.params.scope)]);
  return result.rows[0] ?? { scope: String(request.params.scope), configured: false };
});

app.put('/api/v1/agent/model-policies/:scope', { preHandler: workspaceAccess.forRole('OWNER') }, async (request) => {
  const input = z.object({ model: z.string().min(1).max(160) }).parse(request.body);
  const scope = String(request.params.scope);
  if (scope !== 'AGENT_PLANNER') { const error = new Error('当前只支持配置核心 Agent 规划模型。'); error.statusCode = 400; throw error; }
  const workspace = request.workspace;
  await ensureCatalogModel(workspace.id, 'BAILIAN_CLI', undefined, input.model.trim());
  const result = await query(`INSERT INTO agent_model_policies (workspace_id, scope, provider, model) VALUES ($1, $2, 'BAILIAN_CLI', $3) ON CONFLICT (workspace_id, scope) DO UPDATE SET model = excluded.model, updated_at = now() RETURNING scope, provider, model, updated_at`, [workspace.id, scope, input.model.trim()]);
  return result.rows[0];
});

app.post('/api/v1/agent/plans', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = z.object({ request: z.string().min(1).max(8_000), context: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
  const workspace = request.workspace;
  const policy = await query('SELECT 1 FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspace.id, 'AGENT_PLANNER']);
  if (!policy.rowCount) { const error = new Error('请先配置核心 Agent 规划模型。'); error.statusCode = 400; throw error; }
  const result = await query('INSERT INTO agent_plans (workspace_id, status, request_text, context_json) VALUES ($1, $2, $3, $4) RETURNING id, status, created_at', [workspace.id, 'GENERATING', input.request.trim(), JSON.stringify(input.context ?? {})]);
  const job = await query('INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, $2, $3) RETURNING *', [workspace.id, 'AGENT_PLAN', JSON.stringify({ planId: result.rows[0].id })]);
  await enqueue(job.rows[0]);
  reply.code(202).send({ id: result.rows[0].id, status: result.rows[0].status });
});

app.get('/api/v1/agent/plans/:id', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query('SELECT id, status, request_text, context_json, plan_json, planner_model, error, confirmed_at, created_at, updated_at FROM agent_plans WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!result.rowCount) { const error = new Error('未找到 Agent 计划。'); error.statusCode = 404; throw error; }
  return result.rows[0];
});

app.post('/api/v1/agent/plans/:id/confirm', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const workspace = request.workspace;
  const result = await transaction(async (client) => {
    const plan = await client.query('SELECT plan_json FROM agent_plans WHERE id = $1 AND workspace_id = $2 AND status = $3 FOR UPDATE', [request.params.id, workspace.id, 'WAITING_CONFIRMATION']);
    if (!plan.rowCount) { const error = new Error('该计划当前不能确认。'); error.statusCode = 409; throw error; }
    const steps = Array.isArray(plan.rows[0].plan_json?.steps) ? plan.rows[0].plan_json.steps : [];
    for (const step of steps) await client.query('INSERT INTO generation_runs (workspace_id, agent_plan_id, skill_version_id, status, input_json) VALUES ($1, $2, $3, $4, $5)', [workspace.id, request.params.id, step.skillVersionId, 'DRAFT', JSON.stringify({ purpose: step.purpose, inputs: step.inputs })]);
    return client.query('UPDATE agent_plans SET status = $1, confirmed_at = now(), updated_at = now() WHERE id = $2 RETURNING id, status, confirmed_at', ['CONFIRMED', request.params.id]);
  });
  return result.rows[0];
});

app.post('/api/v1/agent/plans/:id/cancel', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request) => {
  const workspace = request.workspace;
  const result = await query('UPDATE agent_plans SET status = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 AND status IN ($4, $5) RETURNING id, status', ['CANCELLED', request.params.id, workspace.id, 'GENERATING', 'WAITING_CONFIRMATION']);
  if (!result.rowCount) { const error = new Error('该计划当前不能取消。'); error.statusCode = 409; throw error; }
  return result.rows[0];
});

app.post('/api/v1/jobs/bailian-text', { preHandler: workspaceAccess.forRole('EDITOR') }, async (request, reply) => {
  const input = z.object({ model: z.string().min(1).max(120), system: z.string().min(1).max(8_000), message: z.string().min(1).max(60_000) }).parse(request.body);
  const workspace = request.workspace;
  const result = await query('INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, $2, $3) RETURNING *', [workspace.id, 'BAILIAN_TEXT', JSON.stringify(input)]);
  await enqueue(result.rows[0]);
  reply.code(202).send({ id: result.rows[0].id, status: result.rows[0].status });
});

app.get('/api/v1/jobs/:id', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  const workspace = request.workspace;
  const result = await query('SELECT id, job_type, status, result_json, error, created_at, started_at, completed_at FROM jobs WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!result.rowCount) { const error = new Error('未找到任务。'); error.statusCode = 404; throw error; }
  return result.rows[0];
});

function credentialProvider(value) {
  const provider = String(value || '').toUpperCase();
  if (!credentials.has(provider)) { const error = new Error('不支持的凭据类型。'); error.statusCode = 404; throw error; }
  return provider;
}

function credentialView(provider, row) {
  return { provider, configured: Boolean(row), status: row?.status ?? 'UNCONFIGURED', updatedAt: row?.updated_at ?? null, lastTestedAt: row?.last_tested_at ?? null, lastError: row?.last_error ?? null };
}

async function credentialSecret(workspaceId, provider) {
  const result = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, provider]);
  if (!result.rowCount) { const error = new Error('请先保存 API Key。'); error.statusCode = 400; throw error; }
  return decrypt(result.rows[0].encrypted_secret);
}

async function textConnectionInput(workspaceId, route) {
  if (route.provider === 'BAILIAN_CLI') return { apiKey: await credentialSecret(workspaceId, 'BAILIAN') };
  const result = await query('SELECT base_url, encrypted_secret FROM model_connections WHERE id = $1 AND workspace_id = $2 AND status = \'READY\'', [route.connectionId, workspaceId]);
  if (!result.rowCount) throw new Error('账号声音提炼使用的外部 API 连接不可用。');
  return { connection: { baseUrl: result.rows[0].base_url, apiKey: decrypt(result.rows[0].encrypted_secret) } };
}

function modelConnectionInput(requireKey) {
  return z.object({
    provider: z.enum(['DASHSCOPE', 'SILICONFLOW', 'VOLCENGINE_ARK', 'KIMI', 'ZHIPU', 'OPENAI', 'OPENAI_COMPATIBLE']),
    label: z.string().min(1).max(100),
    baseUrl: z.string().url().max(1_000),
    apiKey: requireKey ? z.string().min(1).max(1_000) : z.string().min(1).max(1_000).optional(),
  });
}

function normalizedBaseUrl(value) {
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('API 地址必须使用 HTTP 或 HTTPS。');
  return url.toString().replace(/\/$/, '');
}

function modelConnectionView(row) {
  return { id: row.id, provider: row.provider, label: row.label, baseUrl: row.base_url, model: '', purposes: [], status: row.status === 'UNVERIFIED' ? 'UNTESTED' : row.status, lastTestedAt: row.last_tested_at ?? undefined, lastError: row.last_error ?? undefined, updatedAt: row.updated_at };
}

async function fetchAvailableModels(baseUrl, apiKey) {
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (error) {
    throw new Error(`无法访问模型目录：${error instanceof Error ? error.message : '网络错误'}`);
  }
  if (!response.ok) {
    let detail = '';
    try { const payload = await response.json(); detail = [payload?.code, payload?.message, payload?.error?.message].filter((item) => typeof item === 'string').join(' / '); } catch { /* HTTP 状态足以说明失败。 */ }
    throw new Error(`模型目录请求失败（HTTP ${response.status}${detail ? `：${detail}` : ''}）。`);
  }
  const payload = await response.json();
  const values = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const models = values.map((item) => typeof item === 'string' ? item : item?.id ?? item?.model_id ?? item?.model).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  if (!models.length) throw new Error('模型目录未返回可选模型。');
  return [...new Set(models)];
}

function modelCatalogItem({ provider, connectionId, connectionLabel, model, origin = 'ACCOUNT_CATALOG', capabilities, operations }) {
  return { id: `${provider === 'BAILIAN_CLI' ? 'bailian' : `external:${connectionId}`}:${model}`, provider, ...(connectionId ? { connectionId } : {}), connectionLabel, model, capabilities: capabilities ?? classifyModelCapabilities(model), operations: operations ?? classifyModelOperations(model), origin };
}

function bailianCliMediaCatalog() {
  // 来源：当前安装的 bailian-cli 1.10.1 命令定义。媒体接口不是 OpenAI 兼容 /models 的一部分。
  const entries = [
    ['qwen-image-2.0', ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE']], ['qwen-image-2.0-pro', ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE']], ['qwen-image-max', ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE']], ['wan2.7-image', ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE']], ['wan2.6-t2i', ['TEXT_TO_IMAGE']],
    ['happyhorse-1.1-t2v', ['TEXT_TO_VIDEO']], ['happyhorse-1.1-i2v', ['IMAGE_TO_VIDEO']], ['happyhorse-1.1-r2v', ['REFERENCE_TO_VIDEO']], ['happyhorse-1.0-video-edit', ['VIDEO_EDIT']], ['wan2.6-t2v', ['TEXT_TO_VIDEO']], ['wan2.6-r2v', ['REFERENCE_TO_VIDEO']],
  ];
  return entries.map(([model, operations]) => modelCatalogItem({ provider: 'BAILIAN_CLI', connectionLabel: '阿里云百炼 · CLI 媒体', model, origin: 'CLI_MEDIA', capabilities: [String(model).includes('image') || String(model).includes('t2i') ? 'IMAGE' : 'VIDEO'], operations }));
}

function bailianModelMarketCatalog() {
  // 2026-07-25 核对自百炼控制台“模型广场”。这些模型不由 OpenAI 兼容 /models 返回。
  const entries = [
    ['qwen3-tts-flash', ['AUDIO'], []],
    ['qwen3-asr-flash', ['ASR'], []],
    ['fun-asr', ['ASR'], []],
    ['wan2.7-t2v-2026-06-12', ['VIDEO'], ['TEXT_TO_VIDEO']],
    ['wan2.7-i2v-2026-04-25', ['VIDEO'], ['IMAGE_TO_VIDEO']],
    ['wan2.7-r2v-2026-06-12', ['VIDEO'], ['REFERENCE_TO_VIDEO']],
    ['wan2.7-videoedit', ['VIDEO'], ['VIDEO_EDIT']],
    ['wan2.2-kf2v-flash', ['VIDEO'], ['FIRST_LAST_FRAME_TO_VIDEO']],
  ];
  return entries.map(([model, capabilities, operations]) => modelCatalogItem({
    provider: 'BAILIAN_CLI',
    connectionLabel: '阿里云百炼 · 模型市场',
    model,
    origin: 'MARKET_CATALOG',
    capabilities,
    operations,
  }));
}

function classifyModelCapabilities(model) {
  const value = String(model).toLowerCase();
  if (/embed|rerank/.test(value)) return ['EMBEDDING'];
  if (/asr|paraformer|fun-asr/.test(value)) return ['ASR'];
  if (/music/.test(value)) return ['MUSIC'];
  if (/omni/.test(value)) return ['TEXT', 'VISION', 'MULTIMODAL'];
  if (/\bvl\b|vision/.test(value)) return ['TEXT', 'VISION'];
  if (/tts|cosy|voice|speech/.test(value)) return ['AUDIO'];
  if (/video|wanx|wan\d+\.\d+-(t2v|i2v|r2v|videoedit)|hailuo|seedance|happyhorse/.test(value)) return ['VIDEO'];
  if (/image|flux|z-image|cogview|stable-diffusion|sdxl|wan\d+\.\d+-t2i/.test(value)) return ['IMAGE'];
  if (/code|coder/.test(value)) return ['CODE'];
  if (/reasoner|reasoning|r1/.test(value)) return ['TEXT', 'REASONING'];
  return ['TEXT'];
}

function classifyModelOperations(model) {
  const value = String(model).toLowerCase();
  if (/video-?edit|videoedit/.test(value)) return ['VIDEO_EDIT'];
  if (/first.*last|last.*frame|kf2v|flf2v/.test(value)) return ['FIRST_LAST_FRAME_TO_VIDEO'];
  if (/r2v|reference.*video/.test(value)) return ['REFERENCE_TO_VIDEO'];
  if (/i2v|image.*video/.test(value)) return ['IMAGE_TO_VIDEO'];
  if (/t2v|text.*video/.test(value)) return ['TEXT_TO_VIDEO'];
  if (/image-edit|edit-image/.test(value)) return ['IMAGE_TO_IMAGE'];
  if (/qwen-image-(2\.0|2\.0-pro|max)|wan2\.7-image/.test(value)) return ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'];
  if (/image|t2i|flux|z-image|cogview|stable-diffusion|sdxl/.test(value)) return ['TEXT_TO_IMAGE'];
  return [];
}

async function ensureCatalogModel(workspaceId, provider, connectionId, model) {
  const catalog = await query('SELECT item_json FROM model_catalog WHERE workspace_id = $1 AND item_json->>\'provider\' = $2 AND item_json->>\'model\' = $3 AND COALESCE(item_json->>\'connectionId\', \'\') = $4', [workspaceId, provider, model, connectionId ?? '']);
  if (!catalog.rowCount) { const error = new Error('模型不在已同步且可用的目录中。请先完成连接检测并同步模型。'); error.statusCode = 400; throw error; }
  return catalog.rows[0].item_json;
}

function catalogSupportsTask(item, task) {
  const operations = Array.isArray(item?.operations) ? item.operations : classifyModelOperations(item?.model);
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities : classifyModelCapabilities(item?.model);
  const operationTasks = new Set(['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO', 'FIRST_LAST_FRAME_TO_VIDEO', 'REFERENCE_TO_VIDEO', 'VIDEO_EDIT']);
  if (operationTasks.has(task)) return operations.includes(task);
  if (task === 'SPEECH_SYNTHESIS') return capabilities.includes('AUDIO');
  if (task === 'SPEECH_RECOGNITION') return capabilities.includes('ASR');
  return capabilities.includes('TEXT');
}

async function testTavilyKey(apiKey) {
  let response;
  try {
    response = await fetch('https://api.tavily.com/search', { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'Tavily', search_depth: 'basic', max_results: 1 }) });
  } catch (error) { throw new Error(`无法访问 Tavily：${error instanceof Error ? error.message : '网络错误'}`); }
  if (!response.ok) throw new Error(`Tavily 检测失败（HTTP ${response.status}）。`);
}

function readableProviderError(provider, error) {
  const message = error instanceof Error ? error.message : '检测失败。';
  return provider === 'BAILIAN' ? `百炼检测失败：${message}` : message;
}

function usageLogView(row) {
  const connectionLabel = row.provider === 'BAILIAN_CLI' ? '阿里云百炼' : row.provider === 'TAVILY' ? 'Tavily' : row.provider === 'PUBLIC_WEB' ? '公开网页' : row.provider === 'UNKNOWN' ? '未知服务' : '外部 API';
  return { id: row.id, task: row.operation, provider: row.provider, connectionLabel, model: row.model ?? '-', status: row.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR', startedAt: row.created_at, durationMs: row.duration_ms, requestChars: 0, responseChars: 0, inputTokens: row.input_tokens ?? undefined, outputTokens: row.output_tokens ?? undefined, error: row.error ?? undefined };
}

async function start() {
  await app.listen({ port: config.port, host: config.host });
}

start().catch((error) => { app.log.error(error); process.exit(1); });
