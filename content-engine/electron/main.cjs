const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
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
  });
}

function validateModelInput(input) {
  if (!input || typeof input !== 'object') throw new Error('模型配置无效。');
  const id = typeof input.id === 'string' && input.id ? input.id : `model-${Date.now()}`;
  const baseUrl = String(input.baseUrl || '').replace(/\/$/, '');
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || !input.model || !input.provider) throw new Error('请填写供应商、地址和模型名称。');
  return { id, provider: String(input.provider), label: String(input.label || input.provider), baseUrl, model: String(input.model), purposes: Array.isArray(input.purposes) ? input.purposes : [], status: 'UNTESTED' };
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
  const rawItems = asArray(parsed?.rss?.channel?.item ?? parsed?.feed?.entry).slice(0, 30);
  return rawItems.map((entry, index) => ({
    id: `rss-${source.id}-${Date.now()}-${index}`,
    title: text(entry.title) || '未命名资讯',
    summary: clip(text(entry.description) || text(entry.summary) || text(entry.content) || '该资讯暂无摘要。', 280),
    category: source.category || '未分类',
    source: source.name,
    publishedAt: formatTime(text(entry.pubDate) || text(entry.published) || text(entry.updated)),
    heat: 50,
    trust: source.trust || '待核验',
  }));
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
