const { app, BrowserWindow, ipcMain, net, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { lookup } = require('node:dns/promises');
const { spawn } = require('node:child_process');
const { XMLParser } = require('fast-xml-parser');

let database;
let intelligenceScheduler;

function initialiseDatabase() {
  // 使用 Electron 随附的 SQLite，数据库只由主进程持有，渲染进程不能直接读写文件。
  const { DatabaseSync } = require('node:sqlite');
  const databasePath = path.join(app.getPath('userData'), 'content-engine.sqlite');
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS model_connections (
      id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      api_key_encrypted BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bailian_cli_settings (
      setting_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      api_key_encrypted BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS model_task_policies (
      task TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS model_catalog (
      id TEXT PRIMARY KEY,
      item_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS web_search_settings (
      setting_id TEXT PRIMARY KEY,
      api_key_encrypted BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS api_usage_logs (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      provider TEXT NOT NULL,
      connection_label TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      request_chars INTEGER NOT NULL DEFAULT 0,
      response_chars INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER,
      output_tokens INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_usage_logs_started_at ON api_usage_logs(started_at DESC);
    INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
  `);
}

function registerIpc() {
  ipcMain.handle('state:load', () => {
    const row = database.prepare('SELECT payload_json, revision, updated_at FROM workspace_state WHERE workspace_id = ?')
      .get('local-owner');
    if (!row) return null;
    return { state: JSON.parse(row.payload_json), revision: row.revision, updatedAt: row.updated_at };
  });

  ipcMain.handle('state:save', (_event, state) => {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('无效的本地工作空间数据。');
    }
    const payload = JSON.stringify(state);
    if (payload.length > 5 * 1024 * 1024) {
      throw new Error('工作空间数据超过 5MB，请将大文件保存到素材库。');
    }
    database.prepare(`
      INSERT INTO workspace_state (workspace_id, payload_json, revision, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(workspace_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        revision = workspace_state.revision + 1,
        updated_at = CURRENT_TIMESTAMP
    `).run('local-owner', payload);
    const row = database.prepare('SELECT revision, updated_at FROM workspace_state WHERE workspace_id = ?').get('local-owner');
    return { revision: row.revision, updatedAt: row.updated_at };
  });

  ipcMain.handle('intelligence:refresh-rss', async (_event, sources) => {
    if (!Array.isArray(sources) || sources.length > 25) throw new Error('情报源配置无效。');
    const enabledSources = sources.filter((source) => source?.enabled);
    const settled = await Promise.allSettled(enabledSources.map(collectRss));
    const items = [];
    const results = settled.map((result, index) => {
      const source = enabledSources[index];
      if (result.status === 'fulfilled') {
        items.push(...result.value);
        return { sourceId: source.id, ok: true, count: result.value.length };
      }
      return { sourceId: source.id, ok: false, count: 0, error: result.reason instanceof Error ? result.reason.message : '采集失败' };
    });
    return { items, results };
  });

  ipcMain.handle('intelligence:preview-link', async (_event, rawUrl) => previewPublicLink(rawUrl));
  ipcMain.handle('intelligence:web-search-status', () => ({ configured: Boolean(database.prepare('SELECT 1 FROM web_search_settings WHERE setting_id = ?').get('tavily')) }));
  ipcMain.handle('intelligence:web-search-save', (_event, apiKey) => {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('请输入 Tavily API Key。');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 Tavily API Key。');
    database.prepare(`INSERT INTO web_search_settings (setting_id, api_key_encrypted, updated_at) VALUES ('tavily', ?, CURRENT_TIMESTAMP) ON CONFLICT(setting_id) DO UPDATE SET api_key_encrypted = excluded.api_key_encrypted, updated_at = CURRENT_TIMESTAMP`).run(safeStorage.encryptString(apiKey.trim()));
    return { configured: true };
  });
  ipcMain.handle('intelligence:web-search', async (_event, input) => searchWebCandidates(input));

  ipcMain.handle('intelligence:analyze', async (_event, item) => {
    if (!item || typeof item !== 'object' || typeof item.title !== 'string' || item.title.length > 500) throw new Error('资讯内容无效，无法分析。');
    const route = resolveTaskRoute('INTELLIGENCE_ANALYSIS');
    const prompt = JSON.stringify({ title: item.title, summary: item.summary, category: item.category, source: item.source });
    const system = '你是内容编辑助手。仅返回一个 JSON 对象，不要使用 Markdown。字段：summary（80字以内中文摘要）、heat（0到100整数）、suggestedAngle（不超过40字的内容角度）、factsToVerify（最多3条待核验事实数组）。不得编造原文没有提供的事实。';
    const started = Date.now();
    try {
      const result = await executeTextRoute(route, system, prompt);
      const analysis = parseIntelligenceAnalysis(result.content);
      writeUsageLog({ task: 'INTELLIGENCE_ANALYSIS', route, status: 'SUCCESS', started, requestChars: system.length + prompt.length, responseChars: result.content.length, usage: result.usage });
      return { ...analysis, model: route.model, analyzedAt: localTime() };
    } catch (error) {
      writeUsageLog({ task: 'INTELLIGENCE_ANALYSIS', route, status: 'ERROR', started, requestChars: system.length + prompt.length, responseChars: 0, error: error instanceof Error ? error.message : '模型调用失败' });
      throw error;
    }
  });

  ipcMain.handle('models:list', () => database.prepare('SELECT id, config_json FROM model_connections ORDER BY updated_at DESC').all().map((row) => ({ id: row.id, ...JSON.parse(row.config_json) })));

  ipcMain.handle('models:save', (_event, input) => {
    const config = validateModelInput(input);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 API Key。');
    const existing = database.prepare('SELECT api_key_encrypted FROM model_connections WHERE id = ?').get(config.id);
    const apiKey = input.apiKey?.trim() || (existing ? safeStorage.decryptString(existing.api_key_encrypted) : '');
    if (!apiKey) throw new Error('请输入 API Key。');
    const encrypted = safeStorage.encryptString(apiKey);
    database.prepare(`INSERT INTO model_connections (id, config_json, api_key_encrypted, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, api_key_encrypted = excluded.api_key_encrypted, updated_at = CURRENT_TIMESTAMP`).run(config.id, JSON.stringify(config), encrypted);
    return config;
  });

  ipcMain.handle('models:test', async (_event, id) => {
    const row = database.prepare('SELECT config_json, api_key_encrypted FROM model_connections WHERE id = ?').get(id);
    if (!row) throw new Error('未找到模型连接。');
    const config = JSON.parse(row.config_json);
    const apiKey = safeStorage.decryptString(row.api_key_encrypted);
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`连接失败：${response.status}`);
      config.status = 'READY'; config.lastTestedAt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); config.lastError = undefined;
    } catch (error) {
      config.status = 'ERROR'; config.lastError = error instanceof Error ? error.message : '连接测试失败';
    }
    database.prepare('UPDATE model_connections SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(config), id);
    return config;
  });

  ipcMain.handle('models:remove', (_event, id) => {
    if (typeof id !== 'string' || !id) throw new Error('模型连接标识无效。');
    database.prepare('DELETE FROM model_connections WHERE id = ?').run(id);
    database.prepare('DELETE FROM model_catalog WHERE id LIKE ?').run(`external:${id}:%`);
  });

  ipcMain.handle('model-catalog:sync', () => syncModelCatalog());
  ipcMain.handle('model-catalog:list', () => database.prepare('SELECT item_json, updated_at FROM model_catalog ORDER BY updated_at DESC, id').all().map((row) => ({ ...JSON.parse(row.item_json), syncedAt: row.updated_at })));
  ipcMain.handle('task-policies:list', () => listTaskPolicies());
  ipcMain.handle('task-policies:save', (_event, input) => saveTaskPolicy(input));
  ipcMain.handle('usage:summary', () => usageSummary());
  ipcMain.handle('usage:list', () => database.prepare('SELECT * FROM api_usage_logs ORDER BY started_at DESC LIMIT 80').all().map(mapUsageLog));

  ipcMain.handle('bailian:status', async () => getBailianStatus());

  ipcMain.handle('bailian:save', async (_event, input) => {
    const config = validateBailianInput(input);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存百炼 API Key。');
    const existing = database.prepare('SELECT api_key_encrypted FROM bailian_cli_settings WHERE setting_id = ?').get('default');
    const apiKey = input.apiKey?.trim() || (existing ? safeStorage.decryptString(existing.api_key_encrypted) : '');
    if (!apiKey) throw new Error('请输入百炼 API Key。');
    database.prepare(`INSERT INTO bailian_cli_settings (setting_id, config_json, api_key_encrypted, updated_at) VALUES ('default', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(setting_id) DO UPDATE SET config_json = excluded.config_json, api_key_encrypted = excluded.api_key_encrypted, updated_at = CURRENT_TIMESTAMP`).run(JSON.stringify({ ...config, status: 'UNCONFIGURED', lastError: undefined }), safeStorage.encryptString(apiKey));
    return getBailianStatus();
  });

  ipcMain.handle('bailian:test', async () => {
    const row = database.prepare('SELECT config_json, api_key_encrypted FROM bailian_cli_settings WHERE setting_id = ?').get('default');
    if (!row) throw new Error('请先保存百炼 API Key。');
    const config = JSON.parse(row.config_json);
    let testError;
    try {
      const apiKey = safeStorage.decryptString(row.api_key_encrypted);
      await Promise.all([runBailianCli(['--version']), validateBailianApiKey(apiKey)]);
      config.status = 'READY'; config.lastTestedAt = localTime(); config.lastError = undefined;
    } catch (error) {
      testError = error instanceof Error ? error : new Error('百炼 CLI 连通性检查失败，未获得具体错误原因。');
      config.status = 'ERROR'; config.lastError = testError.message;
    }
    database.prepare('UPDATE bailian_cli_settings SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_id = ?').run(JSON.stringify(config), 'default');
    if (testError) return { ...(await getBailianStatus()), status: 'ERROR', lastError: testError.message };
    return getBailianStatus();
  });

  ipcMain.handle('bailian:remove', () => {
    database.prepare('DELETE FROM bailian_cli_settings WHERE setting_id = ?').run('default');
    database.prepare("DELETE FROM model_catalog WHERE id LIKE 'bailian:%'").run();
  });
}

const modelTasks = ['INTELLIGENCE_ANALYSIS', 'TOPIC_RECOMMENDATION', 'CONTENT_WRITING', 'CONTENT_REWRITE', 'CONTENT_LAYOUT', 'IMAGE_GENERATION', 'SPEECH_SYNTHESIS', 'VIDEO_GENERATION'];

function listTaskPolicies() {
  const saved = new Map(database.prepare('SELECT task, config_json, updated_at FROM model_task_policies').all().map((row) => [row.task, { ...JSON.parse(row.config_json), task: row.task, updatedAt: row.updated_at }]));
  return modelTasks.map((task) => saved.get(task) ?? { task });
}

function saveTaskPolicy(input) {
  if (!input || typeof input !== 'object' || !modelTasks.includes(input.task)) throw new Error('任务策略无效。');
  const task = input.task;
  if (!input.provider && !input.model) {
    database.prepare('DELETE FROM model_task_policies WHERE task = ?').run(task);
    return { task };
  }
  if (!['BAILIAN_CLI', 'EXTERNAL_API'].includes(input.provider) || typeof input.model !== 'string' || !input.model.trim()) throw new Error('请为该功能选择一个模型。');
  if (input.provider === 'EXTERNAL_API' && (typeof input.connectionId !== 'string' || !input.connectionId)) throw new Error('外部 API 模型必须关联已验证连接。');
  const config = { task, provider: input.provider, connectionId: input.provider === 'EXTERNAL_API' ? input.connectionId : undefined, model: input.model.trim() };
  database.prepare(`INSERT INTO model_task_policies (task, config_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(task) DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP`).run(task, JSON.stringify(config));
  const row = database.prepare('SELECT updated_at FROM model_task_policies WHERE task = ?').get(task);
  return { ...config, updatedAt: row.updated_at };
}

async function syncModelCatalog() {
  const items = [];
  const errors = [];
  const bailianRow = database.prepare('SELECT config_json, api_key_encrypted FROM bailian_cli_settings WHERE setting_id = ?').get('default');
  if (bailianRow) {
    const config = JSON.parse(bailianRow.config_json);
    if (config.status === 'READY') {
      items.push(...bailianCliBuiltInModels());
      try {
        const models = await fetchAvailableModels('https://dashscope.aliyuncs.com/compatible-mode/v1', safeStorage.decryptString(bailianRow.api_key_encrypted));
        items.push(...models.map((model) => ({ id: `bailian:${model}`, provider: 'BAILIAN_CLI', connectionLabel: '阿里云百炼 CLI', model, capabilities: classifyModelCapabilities(model) })));
      } catch (error) { errors.push({ connectionLabel: '阿里云百炼 CLI', message: error instanceof Error ? error.message : '模型目录同步失败' }); }
    }
  }
  const connections = database.prepare('SELECT id, config_json, api_key_encrypted FROM model_connections').all();
  for (const row of connections) {
    const config = JSON.parse(row.config_json);
    if (config.status !== 'READY') continue;
    try {
      const models = await fetchAvailableModels(config.baseUrl, safeStorage.decryptString(row.api_key_encrypted));
      items.push(...models.map((model) => ({ id: `external:${row.id}:${model}`, provider: 'EXTERNAL_API', connectionId: row.id, connectionLabel: config.label, model, capabilities: classifyModelCapabilities(model) })));
    } catch (error) { errors.push({ connectionLabel: config.label, message: error instanceof Error ? error.message : '模型目录同步失败' }); }
  }
  const seen = new Set();
  const uniqueItems = items.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
  database.prepare('DELETE FROM model_catalog').run();
  const insert = database.prepare('INSERT INTO model_catalog (id, item_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  for (const item of uniqueItems) insert.run(item.id, JSON.stringify(item));
  return { items: uniqueItems, errors };
}

function bailianCliBuiltInModels() {
  const models = [
    ['qwen3.7-max', ['TEXT']],
    ['qwen3.7-plus', ['TEXT', 'VISION']],
    ['qwen3.6-flash', ['TEXT']],
    ['qwen3.5-omni-plus', ['TEXT', 'VISION', 'MULTIMODAL']],
    ['qwen3.5-omni-plus-realtime', ['TEXT', 'VISION', 'MULTIMODAL']],
    ['qwen-image-3.0-pro', ['IMAGE']],
    ['wan2.7-image-pro', ['IMAGE']],
    ['qwen-image-2.0', ['IMAGE']],
    ['qwen-image-2.0-pro', ['IMAGE']],
    ['wan2.6-t2i', ['IMAGE']],
    ['wan2.7-image', ['IMAGE']],
    ['happyhorse-1.1-t2v', ['VIDEO']],
    ['happyhorse-1.1-i2v', ['VIDEO']],
    ['happyhorse-1.1-r2v', ['VIDEO']],
    ['happyhorse-1.0-video-edit', ['VIDEO']],
    ['wan2.6-t2v', ['VIDEO']],
    ['wan2.6-r2v', ['VIDEO']],
    ['wan2.7-t2v', ['VIDEO']],
    ['wan2.7-i2v', ['VIDEO']],
    ['wan2.7-r2v', ['VIDEO']],
    ['wan2.7-videoedit', ['VIDEO']],
    ['cosyvoice-v3-flash', ['AUDIO']],
    ['cosyvoice-v3.5-flash', ['AUDIO']],
    ['qwen-audio-3.0-tts-plus', ['MULTIMODAL']],
    ['fun-asr', ['ASR']],
    ['fun-asr-realtime', ['ASR']],
    ['fun-music-v1', ['MUSIC']],
  ];
  return models.map(([model, capabilities]) => ({ id: `bailian:${model}`, provider: 'BAILIAN_CLI', connectionLabel: '阿里云百炼 CLI', model, capabilities }));
}

function classifyModelCapabilities(model) {
  const value = String(model).toLowerCase();
  if (/embed|rerank/.test(value)) return ['EMBEDDING'];
  if (/asr|paraformer/.test(value)) return ['ASR'];
  if (/music/.test(value)) return ['MUSIC'];
  if (/omni/.test(value)) return ['TEXT', 'VISION', 'MULTIMODAL'];
  if (/\bvl\b|vision/.test(value)) return ['TEXT', 'VISION'];
  if (/tts|cosy|voice|speech/.test(value)) return ['AUDIO'];
  if (/video|wanx|wan\d+\.\d+-(t2v|i2v|r2v|videoedit)|hailuo|seedance/.test(value)) return ['VIDEO'];
  if (/image|flux|z-image|cogview|stable-diffusion|sdxl/.test(value)) return ['IMAGE'];
  if (/code|coder/.test(value)) return ['CODE'];
  if (/reasoner|reasoning|r1/.test(value)) return ['TEXT', 'REASONING'];
  return ['TEXT'];
}

async function fetchAvailableModels(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`模型目录请求失败（HTTP ${response.status}）。`);
  const payload = await response.json();
  const raw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const models = raw.map((item) => typeof item === 'string' ? item : item?.id ?? item?.model_id ?? item?.model).filter((item) => typeof item === 'string' && item.trim());
  if (models.length === 0) throw new Error('接口未返回可选模型。');
  return [...new Set(models)];
}

function resolveTaskRoute(task) {
  const row = database.prepare('SELECT config_json FROM model_task_policies WHERE task = ?').get(task);
  const policy = row ? JSON.parse(row.config_json) : null;
  if (!policy?.provider || !policy?.model) throw new Error('请先在“模型与 API → 任务策略”为热点分析选择已验证模型。');
  if (policy.provider === 'BAILIAN_CLI') {
    const bailianRow = database.prepare('SELECT config_json, api_key_encrypted FROM bailian_cli_settings WHERE setting_id = ?').get('default');
    if (!bailianRow) throw new Error('热点分析绑定的百炼 CLI 已移除。');
    const config = JSON.parse(bailianRow.config_json);
    if (config.status !== 'READY') throw new Error('热点分析绑定的百炼 CLI 尚未验证通过。');
    return { provider: 'BAILIAN_CLI', connectionLabel: '阿里云百炼 CLI', model: policy.model, apiKey: safeStorage.decryptString(bailianRow.api_key_encrypted) };
  }
  const connectionRow = database.prepare('SELECT config_json, api_key_encrypted FROM model_connections WHERE id = ?').get(policy.connectionId);
  if (!connectionRow) throw new Error('热点分析绑定的外部 API 连接已移除。');
  const config = JSON.parse(connectionRow.config_json);
  if (config.status !== 'READY') throw new Error('热点分析绑定的外部 API 尚未验证通过。');
  return { provider: 'EXTERNAL_API', connectionLabel: config.label, model: policy.model, baseUrl: config.baseUrl, apiKey: safeStorage.decryptString(connectionRow.api_key_encrypted) };
}

async function executeTextRoute(route, system, prompt) {
  if (route.provider === 'BAILIAN_CLI') {
    const raw = await runBailianCli(['text', 'chat', '--model', route.model, '--system', system, '--message', prompt, '--max-tokens', '500', '--temperature', '0.2', '--output', 'json'], route.apiKey);
    const payload = JSON.parse(raw);
    const content = payload?.choices?.[0]?.message?.content ?? payload?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回可用的分析结果。');
    return { content, usage: extractUsage(payload) };
  }
  const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${route.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: route.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 500 }),
  });
  if (!response.ok) throw new Error(`外部 API 调用失败（HTTP ${response.status}）。`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回可用的分析结果。');
  return { content, usage: extractUsage(payload) };
}

function extractUsage(payload) {
  const usage = payload?.usage ?? {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens);
  return { inputTokens: Number.isFinite(inputTokens) ? inputTokens : undefined, outputTokens: Number.isFinite(outputTokens) ? outputTokens : undefined };
}

function writeUsageLog({ task, route, status, started, requestChars, responseChars, usage, error }) {
  database.prepare(`INSERT INTO api_usage_logs (id, task, provider, connection_label, model, status, started_at, duration_ms, request_chars, response_chars, input_tokens, output_tokens, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, task, route.provider, route.connectionLabel, route.model, status, new Date(started).toISOString(), Date.now() - started, requestChars, responseChars, usage?.inputTokens ?? null, usage?.outputTokens ?? null, error ?? null);
}

function usageSummary() {
  const total = database.prepare(`SELECT COUNT(*) AS total_calls, SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_calls, SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) AS failed_calls, SUM(COALESCE(input_tokens, 0)) AS input_tokens, SUM(COALESCE(output_tokens, 0)) AS output_tokens FROM api_usage_logs`).get();
  const today = database.prepare(`SELECT COUNT(*) AS today_calls FROM api_usage_logs WHERE date(started_at, 'localtime') = date('now', 'localtime')`).get();
  return { totalCalls: Number(total.total_calls ?? 0), todayCalls: Number(today.today_calls ?? 0), successCalls: Number(total.success_calls ?? 0), failedCalls: Number(total.failed_calls ?? 0), inputTokens: Number(total.input_tokens ?? 0), outputTokens: Number(total.output_tokens ?? 0) };
}

function mapUsageLog(row) {
  return { id: row.id, task: row.task, provider: row.provider, connectionLabel: row.connection_label, model: row.model, status: row.status, startedAt: row.started_at, durationMs: row.duration_ms, requestChars: row.request_chars, responseChars: row.response_chars, inputTokens: row.input_tokens ?? undefined, outputTokens: row.output_tokens ?? undefined, error: row.error ?? undefined };
}

function validateModelInput(input) {
  if (!input || typeof input !== 'object') throw new Error('模型配置无效。');
  const id = typeof input.id === 'string' && input.id ? input.id : `model-${Date.now()}`;
  const baseUrl = String(input.baseUrl || '').replace(/\/$/, '');
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || !input.provider) throw new Error('请填写供应商和接口地址。');
  return { id, provider: String(input.provider), label: String(input.label || input.provider), baseUrl, model: '', purposes: [], status: 'UNTESTED' };
}

function validateBailianInput(input) {
  if (!input || typeof input !== 'object') throw new Error('百炼 CLI 配置无效。');
  const scopes = new Set(['AUTO', 'TEXT', 'IMAGE', 'AUDIO', 'VIDEO']);
  if (!scopes.has(input.scope)) throw new Error('请选择有效的能力范围。');
  return { scope: input.scope };
}

function localTime() { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }

function bailianCliScript() { return path.join(app.getAppPath(), 'node_modules', 'bailian-cli', 'dist', 'bailian.mjs'); }

async function getBailianStatus() {
  const row = database.prepare('SELECT config_json FROM bailian_cli_settings WHERE setting_id = ?').get('default');
  const config = row ? JSON.parse(row.config_json) : { scope: 'AUTO', status: 'UNCONFIGURED' };
  const script = bailianCliScript();
  if (!fs.existsSync(script)) return { installed: false, configured: Boolean(row), scope: config.scope ?? 'AUTO', status: 'ERROR', lastTestedAt: config.lastTestedAt, lastError: '应用内置的百炼 CLI 未找到。' };
  try {
    const version = (await runBailianCli(['--version'])).trim();
    return { installed: true, version, configured: Boolean(row), scope: config.scope ?? 'AUTO', status: row ? (config.status ?? 'UNCONFIGURED') : 'UNCONFIGURED', lastTestedAt: config.lastTestedAt, lastError: config.status === 'ERROR' ? (config.lastError || '检查没有返回具体原因。请关闭后重新启动桌面端，再执行检查。') : config.lastError };
  } catch (error) {
    return { installed: false, configured: Boolean(row), scope: config.scope ?? 'AUTO', status: 'ERROR', lastTestedAt: config.lastTestedAt, lastError: error instanceof Error ? error.message : '百炼 CLI 无法启动。' };
  }
}

function runBailianCli(args, apiKey) {
  const script = bailianCliScript();
  if (!fs.existsSync(script)) return Promise.reject(new Error('应用内置的百炼 CLI 未找到。'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(apiKey ? { DASHSCOPE_API_KEY: apiKey } : {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    const limit = 1024 * 1024;
    const append = (current, chunk) => (current.length + chunk.length > limit ? current : current + chunk);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()); });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 30_000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else if (timedOut) reject(new Error('百炼 CLI 启动检查超时（30 秒）。请检查本机网络与安全软件。'));
      else reject(new Error((stderr || stdout || `百炼 CLI 退出，错误码 ${code}`).replace(/\s+/g, ' ').trim()));
    });
  });
}

async function validateBailianApiKey(apiKey) {
  const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models';
  let response;
  try {
    response = await fetch(endpoint, {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知网络错误';
    throw new Error(`无法访问百炼模型目录：${message}`);
  }
  if (response.ok) return;
  let detail = '';
  try {
    const payload = await response.json();
    const code = typeof payload?.code === 'string' ? payload.code : '';
    const message = typeof payload?.message === 'string' ? payload.message : '';
    detail = [code, message].filter(Boolean).join('：');
  } catch { /* The HTTP status is enough when the gateway has no JSON error body. */ }
  throw new Error(`百炼模型目录请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
}

function startIntelligenceScheduler() {
  intelligenceScheduler = setInterval(() => { void refreshDueSources(); }, 60_000);
  void refreshDueSources();
}

async function refreshDueSources() {
  const row = database.prepare('SELECT payload_json FROM workspace_state WHERE workspace_id = ?').get('local-owner');
  if (!row) return;
  const state = JSON.parse(row.payload_json);
  const sources = (state.sources ?? []).filter((source) => source.enabled && isDue(source));
  if (sources.length === 0) return;
  const settled = await Promise.allSettled(sources.map(collectRss));
  const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const existing = state.intelligence ?? [];
  const collected = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  state.intelligence = [...collected.filter((item) => !existing.some((current) => current.title === item.title && current.source === item.source)), ...existing];
  state.sources = (state.sources ?? []).map((source) => {
    const index = sources.findIndex((item) => item.id === source.id);
    if (index < 0) return source;
    const result = settled[index];
    return result.status === 'fulfilled' ? { ...source, lastSyncedAt: now, lastError: undefined } : { ...source, lastError: result.reason instanceof Error ? result.reason.message : '采集失败' };
  });
  database.prepare('UPDATE workspace_state SET payload_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?').run(JSON.stringify(state), 'local-owner');
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('intelligence:updated', state.intelligence);
}

function isDue(source) {
  if (!source.lastSyncedAt) return true;
  const [hour, minute] = String(source.lastSyncedAt).split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return true;
  const previous = new Date(); previous.setHours(hour, minute, 0, 0);
  if (previous > new Date()) previous.setDate(previous.getDate() - 1);
  return Date.now() - previous.valueOf() >= Math.max(5, source.refreshMinutes ?? 60) * 60_000;
}

async function collectRss(source) {
  if (!source || source.type !== 'RSS' || typeof source.url !== 'string') throw new Error('仅支持有效的 RSS 源。');
  const url = new URL(source.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('RSS 地址必须使用 HTTP 或 HTTPS。');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ContentEngine/0.1 RSS Reader' } });
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  const xml = await response.text();
  if (xml.length > 2_000_000) throw new Error('RSS 响应超过 2MB。');
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml);
  const rawItems = asArray(parsed?.rss?.channel?.item ?? parsed?.feed?.entry).slice(0, 60);
  const includeKeywords = sourceKeywords(source, 'includeKeywords');
  const excludeKeywords = sourceKeywords(source, 'excludeKeywords');
  return rawItems.map((entry, index) => ({
    id: `rss-${source.id}-${Date.now()}-${index}`,
    title: text(entry.title) || '未命名资讯',
    summary: clip(text(entry.description) || text(entry.summary) || text(entry.content) || '该资讯暂无摘要。', 280),
    category: source.category || '未分类',
    source: source.name,
    publishedAt: formatTime(text(entry.pubDate) || text(entry.published) || text(entry.updated)),
    heat: 0,
    trust: source.trust || '待核验',
    captureMethod: 'RSS',
    url: entryUrl(entry),
  })).filter((item) => matchesSourceRule(item, includeKeywords, excludeKeywords, source.language));
}

function sourceKeywords(source, field) {
  const configured = Array.isArray(source?.[field]) ? source[field].map((item) => String(item).trim()).filter(Boolean) : [];
  if (configured.length) return configured;
  if (field !== 'includeKeywords') return [];
  const host = (() => { try { return new URL(source?.url).hostname; } catch { return ''; } })();
  if (/36kr\.com|ithome\.com/.test(host)) return ['AI', '人工智能', '大模型', '模型', '机器人', '芯片'];
  if (/technologyreview\.com/.test(host)) return ['AI', 'artificial intelligence', 'model', 'robot', 'OpenAI', 'Google'];
  if (/hnrss\.org/.test(host)) return ['AI', 'artificial intelligence', 'LLM', 'model', 'OpenAI', 'Google'];
  return [];
}

function matchesSourceRule(item, includeKeywords, excludeKeywords, language) {
  const haystack = `${item.title} ${item.summary}`.toLocaleLowerCase();
  const normalizedInclude = includeKeywords.map((item) => item.toLocaleLowerCase());
  const normalizedExclude = excludeKeywords.map((item) => item.toLocaleLowerCase());
  if (normalizedInclude.length && !normalizedInclude.some((keyword) => haystack.includes(keyword))) return false;
  if (normalizedExclude.some((keyword) => haystack.includes(keyword))) return false;
  const detected = detectLanguage(`${item.title} ${item.summary}`);
  item.language = detected;
  return language !== 'ZH' || detected === 'zh' ? language !== 'EN' || detected === 'en' : false;
}

function detectLanguage(value) {
  if (/[\u3400-\u9fff]/.test(value)) return 'zh';
  if (/[a-z]/i.test(value)) return 'en';
  return 'other';
}

async function previewPublicLink(rawUrl) {
  let url = await validatePublicUrl(rawUrl);
  if (url.hostname.toLowerCase() === 'mp.weixin.qq.com' && /\/mp\/wappoc_appmsgcaptcha/i.test(url.pathname)) {
    throw new Error('这是微信的人机验证页，不是文章正文。请在浏览器完成验证后，复制地址栏中的公众号文章链接；程序不会绕过验证码。');
  }
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetchPublicWeb(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'ContentEngine/0.1 Link Clip' } }, '读取链接');
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('链接跳转缺少目标地址。');
    url = await validatePublicUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`读取链接失败：${response?.status ?? '网络错误'}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('该链接不是可读取的网页。');
  const html = await response.text();
  if (html.length > 1_000_000) throw new Error('网页内容超过 1MB，无法剪藏。');
  const title = htmlMeta(html, 'og:title') || htmlMeta(html, 'twitter:title') || htmlTitle(html) || '未命名文章';
  const summary = htmlMeta(html, 'og:description') || htmlMeta(html, 'description') || '';
  return { url: url.toString(), title: clip(text(title), 240), summary: clip(text(summary), 500), source: sourceNameForUrl(url) };
}

async function fetchPublicWeb(url, options, action) {
  try {
    // 走 Chromium 网络栈，桌面端会继承系统代理与证书配置。
    return await net.fetch(url, options);
  } catch (error) {
    const cause = error && typeof error === 'object' ? error.cause : undefined;
    const detail = cause && typeof cause === 'object' && typeof cause.code === 'string' ? cause.code : error instanceof Error ? error.message : '未知网络错误';
    throw new Error(`${action}无法连接网络（${detail}）。请检查网络、代理或安全软件后重试。`);
  }
}

async function validatePublicUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length > 2_000) throw new Error('请输入有效的公开网页链接。');
  const url = new URL(rawUrl.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含账号信息的 HTTP(S) 公开链接。');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('不允许读取本机或局域网链接。');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('不允许读取本机或局域网链接。');
  return url;
}

function isPrivateAddress(address) {
  const value = address.toLowerCase();
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function htmlMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*>`, 'i').exec(html)?.[0];
  const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? content.replace(/&quot;/gi, '"').replace(/&#39;/g, "'") : '';
}

function htmlTitle(html) { return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''; }

function sourceNameForUrl(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'mp.weixin.qq.com') return '公众号文章';
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'X';
  if (host.includes('toutiao.com')) return '今日头条';
  if (host.includes('cctv.com')) return '央视频';
  return host.replace(/^www\./, '');
}

async function searchWebCandidates(input) {
  const row = database.prepare('SELECT api_key_encrypted FROM web_search_settings WHERE setting_id = ?').get('tavily');
  if (!row) throw new Error('请先在“网页搜索”保存 Tavily API Key。');
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!query || query.length > 300) throw new Error('请输入 1 到 300 个字符的搜索词。');
  const domains = Array.isArray(input?.domains) ? input.domains.filter((item) => typeof item === 'string' && item.length < 120).slice(0, 5) : [];
  const apiKey = safeStorage.decryptString(row.api_key_encrypted);
  const response = await fetchPublicWeb('https://api.tavily.com/search', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, topic: 'news', search_depth: 'basic', max_results: 10, include_domains: domains.length ? domains : undefined }) }, 'Tavily 搜索');
  if (response.status === 401) throw new Error('Tavily Key 无效、已撤销，或未开通搜索权限。请在设置中重新保存有效 Key。');
  if (response.status === 403) throw new Error('Tavily 拒绝了当前请求。请检查 Key 所属项目的权限或地区访问策略。');
  if (response.status === 429) throw new Error('Tavily 调用频率或额度已达上限，请稍后再试。');
  if (!response.ok) throw new Error(`Tavily 搜索失败（HTTP ${response.status}）。请稍后重试。`);
  const payload = await response.json();
  return (Array.isArray(payload?.results) ? payload.results : []).map((result, index) => {
    const url = typeof result?.url === 'string' ? result.url : '';
    let parsed; try { parsed = new URL(url); } catch { return null; }
    return { id: `search-${Date.now()}-${index}`, title: clip(text(String(result?.title ?? '未命名结果')), 240), summary: clip(text(String(result?.content ?? '')), 500), url, source: sourceNameForUrl(parsed), publishedAt: formatTime(String(result?.published_date ?? '')), category: typeof input?.category === 'string' && input.category.trim() ? input.category.trim() : '未分类', heat: 0, trust: '待核验', captureMethod: 'SEARCH', language: detectLanguage(`${result?.title ?? ''} ${result?.content ?? ''}`) };
  }).filter(Boolean);
}

function parseIntelligenceAnalysis(content) {
  if (typeof content !== 'string') throw new Error('百炼没有返回可解析的分析结果。');
  const candidate = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(candidate); } catch { throw new Error('百炼返回格式不符合预期，请重试。'); }
  const summary = String(value?.summary ?? '').trim();
  const suggestedAngle = String(value?.suggestedAngle ?? '').trim();
  const heat = Number(value?.heat);
  if (!summary || !suggestedAngle || !Number.isFinite(heat)) throw new Error('百炼分析结果不完整，请重试。');
  return { summary: clip(summary, 120), heat: Math.max(0, Math.min(100, Math.round(heat))), suggestedAngle: clip(suggestedAngle, 60), factsToVerify: Array.isArray(value.factsToVerify) ? value.factsToVerify.map((item) => clip(String(item), 100)).filter(Boolean).slice(0, 3) : [] };
}

function entryUrl(entry) {
  const link = entry?.link;
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) return link.find((item) => typeof item === 'string' || item?.['@_href'])?.['@_href'] ?? link.find((item) => typeof item === 'string');
  return link?.['@_href'];
}

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function text(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]+>/g, ' ').replace(/&#(x[\da-f]+|\d+);?/gi, (_match, entity) => {
    const code = String(entity).toLowerCase().startsWith('x') ? Number.parseInt(entity.slice(1), 16) : Number.parseInt(entity, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
  }).replace(/&(amp|quot|apos|lt|gt);/gi, (_match, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[String(entity).toLowerCase()]).replace(/\s+/g, ' ').trim();
}
function clip(value, length) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '刚刚' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date); }

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: '内容引擎',
    backgroundColor: '#fffdf7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    window.loadURL(devServer);
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  initialiseDatabase();
  registerIpc();
  startIntelligenceScheduler();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (intelligenceScheduler) clearInterval(intelligenceScheduler);
  database?.close();
});
