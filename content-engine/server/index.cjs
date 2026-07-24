const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const { z } = require('zod');
const config = require('./config.cjs');
const { query, transaction } = require('./db.cjs');
const { encrypt, hashPassword, verifyPassword } = require('./crypto.cjs');
const { clipPublicLink } = require('./services/public-web.cjs');
const { searchTavily } = require('./services/tavily.cjs');
const { refreshRss } = require('./services/rss.cjs');
const { enqueue } = require('./queue.cjs');

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
const credentials = new Set(['TAVILY', 'BAILIAN']);

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

app.get('/api/v1/settings/credentials/:provider', { preHandler: authenticate }, async (request) => {
  const provider = String(request.params.provider || '').toUpperCase();
  if (!credentials.has(provider)) { const error = new Error('不支持的凭据类型。'); error.statusCode = 404; throw error; }
  const workspace = await currentWorkspace(request.user.sub);
  const result = await query('SELECT updated_at FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspace.id, provider]);
  return { configured: Boolean(result.rowCount), updatedAt: result.rows[0]?.updated_at ?? null };
});

app.put('/api/v1/settings/credentials/:provider', { preHandler: authenticate }, async (request) => {
  const provider = String(request.params.provider || '').toUpperCase();
  const input = z.object({ apiKey: z.string().min(1).max(1_000) }).parse(request.body);
  if (!credentials.has(provider)) { const error = new Error('不支持的凭据类型。'); error.statusCode = 404; throw error; }
  const workspace = await currentWorkspace(request.user.sub);
  await query(`INSERT INTO credential_vault (workspace_id, provider, encrypted_secret) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, provider) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, updated_at = now()`, [workspace.id, provider, encrypt(input.apiKey.trim())]);
  return { configured: true };
});

app.post('/api/v1/intelligence/clip', { preHandler: authenticate }, async (request) => clipPublicLink(z.object({ url: z.string().url().max(2_000) }).parse(request.body).url));
app.post('/api/v1/intelligence/search', { preHandler: authenticate }, async (request) => searchTavily((await currentWorkspace(request.user.sub)).id, z.object({ query: z.string(), category: z.string().optional(), domains: z.array(z.string()).optional() }).parse(request.body)));
app.post('/api/v1/intelligence/rss/refresh', { preHandler: authenticate }, async (request) => refreshRss(z.object({ sources: z.array(z.object({ id: z.string(), name: z.string(), type: z.literal('RSS'), url: z.string().url(), category: z.string(), includeKeywords: z.array(z.string()).optional(), excludeKeywords: z.array(z.string()).optional(), language: z.enum(['ALL', 'ZH', 'EN']).optional(), enabled: z.boolean(), refreshMinutes: z.number(), trust: z.string() })) }).parse(request.body).sources));

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

async function start() {
  await app.listen({ port: config.port, host: config.host });
}

start().catch((error) => { app.log.error(error); process.exit(1); });
