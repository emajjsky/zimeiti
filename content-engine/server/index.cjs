const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const { z } = require('zod');
const config = require('./config.cjs');
const { query, transaction } = require('./db.cjs');
const { encrypt, decrypt, hashPassword, verifyPassword } = require('./crypto.cjs');
const { clipPublicLink } = require('./services/public-web.cjs');
const { searchTavily } = require('./services/tavily.cjs');
const { listSources, createSources, updateSource, removeSource, listItems, refreshWorkspaceRss } = require('./services/intelligenceRepository.cjs');
const { enqueue } = require('./queue.cjs');
const { listAvailableSkills } = require('./agent/skillRegistry.cjs');
const { runBailianCli } = require('./runner/bailian.cjs');
const { ANALYSIS_SCOPE, createTemplateStore, prepareAnalysisInput } = require('./services/intelligence-analysis.cjs');

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
const credentials = new Set(['TAVILY', 'BAILIAN']);
const modelTasks = ['INTELLIGENCE_ANALYSIS', 'TOPIC_RECOMMENDATION', 'CONTENT_WRITING', 'CONTENT_REWRITE', 'CONTENT_LAYOUT', 'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'SPEECH_SYNTHESIS', 'SPEECH_RECOGNITION', 'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO', 'FIRST_LAST_FRAME_TO_VIDEO', 'REFERENCE_TO_VIDEO', 'VIDEO_EDIT'];
const externalProviders = new Set(['DASHSCOPE', 'SILICONFLOW', 'VOLCENGINE_ARK', 'KIMI', 'ZHIPU', 'OPENAI', 'OPENAI_COMPATIBLE']);
const sourceInput = z.object({ name: z.string().max(160), type: z.literal('RSS'), url: z.string().url().max(2_000), category: z.string().max(120), includeKeywords: z.array(z.string().max(120)).optional(), excludeKeywords: z.array(z.string().max(120)).optional(), language: z.enum(['ALL', 'ZH', 'EN']).optional(), enabled: z.boolean(), refreshMinutes: z.number().min(5).max(10_080), trust: z.string().max(80) });
const templateStore = createTemplateStore({ query });

app.register(cors, { origin: config.corsOrigin, credentials: false });
app.register(jwt, { secret: config.jwtSecret });

app.setErrorHandler((error, _request, reply) => {
  const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
  reply.code(status).send({ error: { message: error.message || '请求失败。' } });
});

async function authenticate(request) { await request.jwtVerify(); }

async function currentWorkspace(userId) {
  const result = await query(`SELECT w.id, w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = $1 ORDER BY m.role = 'OWNER' DESC, w.created_at ASC LIMIT 1`, [userId]);
  if (!result.rowCount) throw new Error('当前用户没有工作空间。');
  return result.rows[0];
}

function defaultState(name) {
  return { workspace: { name, materialRoot: '', primaryTopics: [], enabledPlatforms: ['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'], setupCompleted: false }, feishuTemplate: { name: `${name}内容库`, topicStorage: 'ONE_TABLE', includeSchedule: true, includeReview: false, status: 'DRAFT' }, sources: [], intelligence: [], topics: [], projects: [] };
}

const authInput = z.object({ email: z.string().email().max(320), password: z.string().min(8).max(200), displayName: z.string().min(1).max(80).optional(), workspaceName: z.string().min(1).max(80).optional() });

app.get('/health', async () => ({ ok: true, service: 'content-engine-api' }));

app.post('/api/v1/auth/register', async (request, reply) => {
  const input = authInput.parse(request.body);
  const email = input.email.trim().toLowerCase();
  const user = await transaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount) { const error = new Error('该邮箱已注册，请直接登录。'); error.statusCode = 409; throw error; }
    const createdUser = await client.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name', [email, hashPassword(input.password), input.displayName?.trim() || email.split('@')[0]]);
    const createdWorkspace = await client.query('INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id, name', [input.workspaceName?.trim() || `${createdUser.rows[0].display_name}的内容工作室`, createdUser.rows[0].id]);
    await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [createdWorkspace.rows[0].id, createdUser.rows[0].id, 'OWNER']);
    await client.query('INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2)', [createdWorkspace.rows[0].id, JSON.stringify(defaultState(createdWorkspace.rows[0].name))]);
    return { user: createdUser.rows[0], workspace: createdWorkspace.rows[0] };
  });
  const accessToken = app.jwt.sign({ sub: user.user.id, email: user.user.email });
  reply.code(201).send({ ...user, accessToken });
});

app.post('/api/v1/auth/login', async (request) => {
  const input = authInput.pick({ email: true, password: true }).parse(request.body);
  const result = await query('SELECT id, email, display_name, password_hash FROM users WHERE email = $1', [input.email.trim().toLowerCase()]);
  if (!result.rowCount || !verifyPassword(input.password, result.rows[0].password_hash)) { const error = new Error('邮箱或密码错误。'); error.statusCode = 401; throw error; }
  const user = result.rows[0]; const workspace = await currentWorkspace(user.id);
  return { user: { id: user.id, email: user.email, display_name: user.display_name }, workspace, accessToken: app.jwt.sign({ sub: user.id, email: user.email }) };
});

app.get('/api/v1/auth/me', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  return { user: { id: request.user.sub, email: request.user.email }, workspace };
});

app.get('/api/v1/workspace/state', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT state_json, revision, updated_at FROM workspace_snapshots WHERE workspace_id = $1', [workspace.id]);
  return { workspace, state: result.rows[0]?.state_json ?? defaultState(workspace.name), revision: result.rows[0]?.revision ?? 1, updatedAt: result.rows[0]?.updated_at ?? new Date().toISOString() };
});

app.put('/api/v1/workspace/state', { preHandler: authenticate }, async (request) => {
  const body = z.object({ state: z.record(z.string(), z.unknown()) }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query(`INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2) ON CONFLICT (workspace_id) DO UPDATE SET state_json = excluded.state_json, revision = workspace_snapshots.revision + 1, updated_at = now() RETURNING revision, updated_at`, [workspace.id, JSON.stringify(body.state)]);
  return { revision: result.rows[0].revision, updatedAt: result.rows[0].updated_at };
});

app.get('/api/v1/settings/credentials', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query(`SELECT provider, status, updated_at, last_tested_at, last_error
    FROM credential_vault WHERE workspace_id = $1 AND provider = ANY($2::text[]) ORDER BY updated_at DESC`, [workspace.id, [...credentials]]);
  const rows = new Map(result.rows.map((row) => [row.provider, credentialView(row.provider, row)]));
  return [...credentials].map((provider) => rows.get(provider) ?? credentialView(provider));
});

app.get('/api/v1/settings/credentials/:provider', { preHandler: authenticate }, async (request) => {
  const provider = credentialProvider(request.params.provider);
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT provider, status, updated_at, last_tested_at, last_error FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspace.id, provider]);
  return credentialView(provider, result.rows[0]);
});

app.put('/api/v1/settings/credentials/:provider', { preHandler: authenticate }, async (request) => {
  const provider = credentialProvider(request.params.provider);
  const input = z.object({ apiKey: z.string().min(1).max(1_000) }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query(`INSERT INTO credential_vault (workspace_id, provider, encrypted_secret, status, last_tested_at, last_error)
    VALUES ($1, $2, $3, 'UNVERIFIED', NULL, NULL)
    ON CONFLICT (workspace_id, provider) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, status = 'UNVERIFIED', last_tested_at = NULL, last_error = NULL, updated_at = now()
    RETURNING provider, status, updated_at, last_tested_at, last_error`, [workspace.id, provider, encrypt(input.apiKey.trim())]);
  return credentialView(provider, result.rows[0]);
});

app.post('/api/v1/settings/credentials/:provider/test', { preHandler: authenticate }, async (request) => {
  const provider = credentialProvider(request.params.provider);
  const workspace = await currentWorkspace(request.user.sub);
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

app.delete('/api/v1/settings/credentials/:provider', { preHandler: authenticate }, async (request, reply) => {
  const provider = credentialProvider(request.params.provider);
  const workspace = await currentWorkspace(request.user.sub);
  await transaction(async (client) => {
    await client.query('DELETE FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspace.id, provider]);
    if (provider === 'BAILIAN') {
      await client.query("DELETE FROM model_catalog WHERE workspace_id = $1 AND item_json->>'provider' = 'BAILIAN_CLI'", [workspace.id]);
      await client.query("DELETE FROM agent_model_policies WHERE workspace_id = $1 AND provider = 'BAILIAN_CLI'", [workspace.id]);
    }
  });
  reply.code(204).send();
});

app.get('/api/v1/models/connections', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query(`SELECT id, provider, label, base_url, status, last_tested_at, last_error, updated_at
    FROM model_connections WHERE workspace_id = $1 ORDER BY updated_at DESC`, [workspace.id]);
  return result.rows.map(modelConnectionView);
});

app.post('/api/v1/models/connections', { preHandler: authenticate }, async (request, reply) => {
  const input = modelConnectionInput(true).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query(`INSERT INTO model_connections (workspace_id, provider, label, base_url, encrypted_secret)
    VALUES ($1, $2, $3, $4, $5) RETURNING id, provider, label, base_url, status, last_tested_at, last_error, updated_at`, [workspace.id, input.provider, input.label.trim(), normalizedBaseUrl(input.baseUrl), encrypt(input.apiKey.trim())]);
  reply.code(201).send(modelConnectionView(result.rows[0]));
});

app.put('/api/v1/models/connections/:id', { preHandler: authenticate }, async (request) => {
  const input = modelConnectionInput(false).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const existing = await query('SELECT encrypted_secret FROM model_connections WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!existing.rowCount) { const error = new Error('未找到外部 API 连接。'); error.statusCode = 404; throw error; }
  const secret = input.apiKey?.trim() ? encrypt(input.apiKey.trim()) : existing.rows[0].encrypted_secret;
  const result = await query(`UPDATE model_connections SET provider = $3, label = $4, base_url = $5, encrypted_secret = $6,
    status = 'UNVERIFIED', last_tested_at = NULL, last_error = NULL, updated_at = now()
    WHERE id = $1 AND workspace_id = $2
    RETURNING id, provider, label, base_url, status, last_tested_at, last_error, updated_at`, [request.params.id, workspace.id, input.provider, input.label.trim(), normalizedBaseUrl(input.baseUrl), secret]);
  return modelConnectionView(result.rows[0]);
});

app.post('/api/v1/models/connections/:id/test', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
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

app.delete('/api/v1/models/connections/:id', { preHandler: authenticate }, async (request, reply) => {
  const workspace = await currentWorkspace(request.user.sub);
  await transaction(async (client) => {
    const removed = await client.query('DELETE FROM model_connections WHERE id = $1 AND workspace_id = $2 RETURNING id', [request.params.id, workspace.id]);
    if (!removed.rowCount) { const error = new Error('未找到外部 API 连接。'); error.statusCode = 404; throw error; }
    await client.query("DELETE FROM model_catalog WHERE workspace_id = $1 AND item_json->>'connectionId' = $2", [workspace.id, request.params.id]);
    await client.query('DELETE FROM agent_model_policies WHERE workspace_id = $1 AND connection_id = $2', [workspace.id, request.params.id]);
  });
  reply.code(204).send();
});

app.get('/api/v1/models/catalog', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT item_json, updated_at FROM model_catalog WHERE workspace_id = $1 ORDER BY updated_at DESC, id', [workspace.id]);
  return result.rows.map((row) => ({ ...row.item_json, syncedAt: row.updated_at }));
});

app.post('/api/v1/models/catalog/sync', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
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

app.get('/api/v1/models/task-policies', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT scope, provider, connection_id, model, updated_at FROM agent_model_policies WHERE workspace_id = $1 AND scope = ANY($2::text[])', [workspace.id, modelTasks]);
  const saved = new Map(result.rows.map((row) => [row.scope, { task: row.scope, provider: row.provider, connectionId: row.connection_id ?? undefined, model: row.model, updatedAt: row.updated_at }]));
  return modelTasks.map((task) => saved.get(task) ?? { task });
});

app.put('/api/v1/models/task-policies/:task', { preHandler: authenticate }, async (request) => {
  const task = String(request.params.task);
  if (!modelTasks.includes(task)) { const error = new Error('不支持的任务策略。'); error.statusCode = 400; throw error; }
  const input = z.object({ provider: z.enum(['BAILIAN_CLI', 'EXTERNAL_API']).optional(), connectionId: z.string().uuid().optional(), model: z.string().max(160).optional() }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
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

app.get('/api/v1/models/usage', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
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

function analysisTemplateScope(value) {
  const scope = String(value || '');
  if (scope !== ANALYSIS_SCOPE) { const error = new Error('当前提示词模板尚未接入执行器。'); error.statusCode = 400; throw error; }
  return scope;
}

function promptTemplateView(row) {
  return { id: row.id, scope: row.scope, version: row.version, body: row.body, source: row.source, updatedAt: row.created_at };
}

app.get('/api/v1/settings/prompt-templates/:scope', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  return promptTemplateView(await templateStore.get(workspace.id, analysisTemplateScope(request.params.scope)));
});

app.put('/api/v1/settings/prompt-templates/:scope', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const input = z.object({ body: z.string().min(1).max(12_000) }).parse(request.body);
  return promptTemplateView(await templateStore.save(workspace.id, analysisTemplateScope(request.params.scope), input.body));
});

app.post('/api/v1/settings/prompt-templates/:scope/reset', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  return promptTemplateView(await templateStore.reset(workspace.id, analysisTemplateScope(request.params.scope)));
});

async function analysisProfile(workspaceId) {
  const result = await query('SELECT state_json FROM workspace_snapshots WHERE workspace_id = $1', [workspaceId]);
  return result.rows[0]?.state_json?.workspace ?? {};
}

async function analysisRoute(workspaceId) {
  const result = await query('SELECT provider, connection_id, model FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspaceId, ANALYSIS_SCOPE]);
  if (!result.rowCount) throw new Error('请先为热点分析配置可用文本模型。');
  const route = { provider: result.rows[0].provider, connectionId: result.rows[0].connection_id ?? undefined, model: result.rows[0].model };
  if (route.provider === 'BAILIAN_CLI') {
    const credential = await query("SELECT 1 FROM credential_vault WHERE workspace_id = $1 AND provider = 'BAILIAN' AND status = 'READY'", [workspaceId]);
    if (!credential.rowCount) throw new Error('百炼 Key 尚未验证可用。请先在百炼设置中保存并检查。');
  } else {
    const connection = await query("SELECT 1 FROM model_connections WHERE id = $1 AND workspace_id = $2 AND status = 'READY'", [route.connectionId, workspaceId]);
    if (!connection.rowCount) throw new Error('热点分析使用的外部 API 连接不可用。');
  }
  return route;
}

function analysisItem(row) {
  return { id: row.id, title: row.title, summary: row.summary, source: row.source_name, url: row.canonical_url, category: row.category, keywords: row.matched_keywords ?? [], publishedAt: row.published_at?.toISOString?.() ?? row.published_at ?? row.created_at };
}

app.post('/api/v1/intelligence/items/:id/analyses/prepare', { preHandler: authenticate }, async (request, reply) => {
  const input = z.object({ platforms: z.array(z.enum(['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'])).min(1).max(3) }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const itemResult = await query('SELECT * FROM intelligence_items WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!itemResult.rowCount) { const error = new Error('未找到这条资讯。'); error.statusCode = 404; throw error; }
  const [profile, route, template] = await Promise.all([analysisProfile(workspace.id), analysisRoute(workspace.id), templateStore.get(workspace.id, ANALYSIS_SCOPE)]);
  const prepared = prepareAnalysisInput({ item: analysisItem(itemResult.rows[0]), profile, platforms: input.platforms, template, route });
  const run = await query(`INSERT INTO generation_runs (workspace_id, skill_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
    VALUES ($1, 'intelligence-analysis:1.0.0', 'DRAFT', $2, $3, $4, $5, $6)
    RETURNING id, status, created_at`, [workspace.id, JSON.stringify(prepared.sourceSnapshot), JSON.stringify(prepared.input), route.model, String(template.version), JSON.stringify(null)]);
  reply.code(201).send({ id: run.rows[0].id, status: run.rows[0].status, createdAt: run.rows[0].created_at, confirmation: { sourceCount: 1, platforms: prepared.input.selectedPlatforms, model: route.model, promptVersion: template.version, generalAudienceWarning: prepared.generalAudienceWarning, costEstimate: null } });
});

app.post('/api/v1/generation-runs/:id/confirm', { preHandler: authenticate }, async (request, reply) => {
  const workspace = await currentWorkspace(request.user.sub);
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

app.post('/api/v1/generation-runs/:id/cancel', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query("UPDATE generation_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('DRAFT', 'QUEUED') RETURNING id, status", [request.params.id, workspace.id]);
  if (!result.rowCount) { const error = new Error('该分析任务当前不能取消。'); error.statusCode = 409; throw error; }
  await query("UPDATE jobs SET status = 'CANCELLED', completed_at = now() WHERE workspace_id = $1 AND payload_json->>'runId' = $2 AND status = 'PENDING'", [workspace.id, request.params.id]);
  return result.rows[0];
});

app.get('/api/v1/intelligence/items/:id/analyses/latest', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query(`SELECT a.id, a.selected_platforms, a.output_json, a.overall_score, a.decision, a.created_at, r.model, r.prompt_version
    FROM intelligence_analyses a JOIN generation_runs r ON r.id = a.generation_run_id
    WHERE a.workspace_id = $1 AND a.intelligence_item_id = $2 ORDER BY a.created_at DESC LIMIT 1`, [workspace.id, request.params.id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: row.id, selectedPlatforms: row.selected_platforms, ...row.output_json, overallScore: row.overall_score, decision: row.decision, model: row.model, promptVersion: row.prompt_version, analyzedAt: row.created_at };
});

app.post('/api/v1/intelligence/clip', { preHandler: authenticate }, async (request) => clipPublicLink(z.object({ url: z.string().url().max(2_000) }).parse(request.body).url));
app.post('/api/v1/intelligence/search', { preHandler: authenticate }, async (request) => searchTavily((await currentWorkspace(request.user.sub)).id, z.object({ query: z.string(), category: z.string().optional(), domains: z.array(z.string()).optional() }).parse(request.body)));
app.get('/api/v1/intelligence/sources', { preHandler: authenticate }, async (request) => listSources((await currentWorkspace(request.user.sub)).id));
app.post('/api/v1/intelligence/sources', { preHandler: authenticate }, async (request, reply) => {
  const input = z.object({ sources: z.array(sourceInput).min(1).max(30) }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  reply.code(201).send(await createSources(workspace.id, input.sources));
});
app.put('/api/v1/intelligence/sources/:id', { preHandler: authenticate }, async (request) => {
  const input = sourceInput.parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  return updateSource(workspace.id, request.params.id, input);
});
app.delete('/api/v1/intelligence/sources/:id', { preHandler: authenticate }, async (request, reply) => { await removeSource((await currentWorkspace(request.user.sub)).id, request.params.id); reply.code(204).send(); });
app.get('/api/v1/intelligence/items', { preHandler: authenticate }, async (request) => listItems((await currentWorkspace(request.user.sub)).id));
app.post('/api/v1/intelligence/rss/refresh', { preHandler: authenticate }, async (request) => refreshWorkspaceRss((await currentWorkspace(request.user.sub)).id));

app.get('/api/v1/agent/skills', { preHandler: authenticate }, async (request) => listAvailableSkills((await currentWorkspace(request.user.sub)).id));

app.get('/api/v1/agent/model-policies/:scope', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT scope, provider, model, updated_at FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspace.id, String(request.params.scope)]);
  return result.rows[0] ?? { scope: String(request.params.scope), configured: false };
});

app.put('/api/v1/agent/model-policies/:scope', { preHandler: authenticate }, async (request) => {
  const input = z.object({ model: z.string().min(1).max(160) }).parse(request.body);
  const scope = String(request.params.scope);
  if (scope !== 'AGENT_PLANNER') { const error = new Error('当前只支持配置核心 Agent 规划模型。'); error.statusCode = 400; throw error; }
  const workspace = await currentWorkspace(request.user.sub);
  await ensureCatalogModel(workspace.id, 'BAILIAN_CLI', undefined, input.model.trim());
  const result = await query(`INSERT INTO agent_model_policies (workspace_id, scope, provider, model) VALUES ($1, $2, 'BAILIAN_CLI', $3) ON CONFLICT (workspace_id, scope) DO UPDATE SET model = excluded.model, updated_at = now() RETURNING scope, provider, model, updated_at`, [workspace.id, scope, input.model.trim()]);
  return result.rows[0];
});

app.post('/api/v1/agent/plans', { preHandler: authenticate }, async (request, reply) => {
  const input = z.object({ request: z.string().min(1).max(8_000), context: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const policy = await query('SELECT 1 FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2', [workspace.id, 'AGENT_PLANNER']);
  if (!policy.rowCount) { const error = new Error('请先配置核心 Agent 规划模型。'); error.statusCode = 400; throw error; }
  const result = await query('INSERT INTO agent_plans (workspace_id, status, request_text, context_json) VALUES ($1, $2, $3, $4) RETURNING id, status, created_at', [workspace.id, 'GENERATING', input.request.trim(), JSON.stringify(input.context ?? {})]);
  const job = await query('INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, $2, $3) RETURNING *', [workspace.id, 'AGENT_PLAN', JSON.stringify({ planId: result.rows[0].id })]);
  await enqueue(job.rows[0]);
  reply.code(202).send({ id: result.rows[0].id, status: result.rows[0].status });
});

app.get('/api/v1/agent/plans/:id', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT id, status, request_text, context_json, plan_json, planner_model, error, confirmed_at, created_at, updated_at FROM agent_plans WHERE id = $1 AND workspace_id = $2', [request.params.id, workspace.id]);
  if (!result.rowCount) { const error = new Error('未找到 Agent 计划。'); error.statusCode = 404; throw error; }
  return result.rows[0];
});

app.post('/api/v1/agent/plans/:id/confirm', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await transaction(async (client) => {
    const plan = await client.query('SELECT plan_json FROM agent_plans WHERE id = $1 AND workspace_id = $2 AND status = $3 FOR UPDATE', [request.params.id, workspace.id, 'WAITING_CONFIRMATION']);
    if (!plan.rowCount) { const error = new Error('该计划当前不能确认。'); error.statusCode = 409; throw error; }
    const steps = Array.isArray(plan.rows[0].plan_json?.steps) ? plan.rows[0].plan_json.steps : [];
    for (const step of steps) await client.query('INSERT INTO generation_runs (workspace_id, agent_plan_id, skill_version_id, status, input_json) VALUES ($1, $2, $3, $4, $5)', [workspace.id, request.params.id, step.skillVersionId, 'DRAFT', JSON.stringify({ purpose: step.purpose, inputs: step.inputs })]);
    return client.query('UPDATE agent_plans SET status = $1, confirmed_at = now(), updated_at = now() WHERE id = $2 RETURNING id, status, confirmed_at', ['CONFIRMED', request.params.id]);
  });
  return result.rows[0];
});

app.post('/api/v1/agent/plans/:id/cancel', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('UPDATE agent_plans SET status = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3 AND status IN ($4, $5) RETURNING id, status', ['CANCELLED', request.params.id, workspace.id, 'GENERATING', 'WAITING_CONFIRMATION']);
  if (!result.rowCount) { const error = new Error('该计划当前不能取消。'); error.statusCode = 409; throw error; }
  return result.rows[0];
});

app.post('/api/v1/jobs/bailian-text', { preHandler: authenticate }, async (request, reply) => {
  const input = z.object({ model: z.string().min(1).max(120), system: z.string().min(1).max(8_000), message: z.string().min(1).max(60_000) }).parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, $2, $3) RETURNING *', [workspace.id, 'BAILIAN_TEXT', JSON.stringify(input)]);
  await enqueue(result.rows[0]);
  reply.code(202).send({ id: result.rows[0].id, status: result.rows[0].status });
});

app.get('/api/v1/jobs/:id', { preHandler: authenticate }, async (request) => {
  const workspace = await currentWorkspace(request.user.sub);
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
  return { id: row.id, task: row.operation, provider: row.provider, connectionLabel: row.provider === 'BAILIAN_CLI' ? '阿里云百炼' : '外部 API', model: row.model ?? '-', status: row.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR', startedAt: row.created_at, durationMs: row.duration_ms, requestChars: 0, responseChars: 0, inputTokens: row.input_tokens ?? undefined, outputTokens: row.output_tokens ?? undefined, error: row.error ?? undefined };
}

async function start() {
  await app.listen({ port: config.port, host: config.host });
}

start().catch((error) => { app.log.error(error); process.exit(1); });
