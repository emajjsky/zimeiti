const { decrypt } = require('../crypto.cjs');
const { query } = require('../db.cjs');
const { sourceName } = require('./public-web.cjs');

async function searchTavily(workspaceId, input) {
  const row = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'TAVILY']);
  if (!row.rowCount) throw new Error('请先在设置中保存 Tavily Key。');
  const apiKey = decrypt(row.rows[0].encrypted_secret);
  const queryText = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!queryText || queryText.length > 300) throw new Error('请输入 1 到 300 个字符的搜索词。');
  const domains = Array.isArray(input?.domains) ? input.domains.filter((item) => typeof item === 'string' && item.length < 120).slice(0, 5) : [];
  let response;
  try {
    response = await fetch('https://api.tavily.com/search', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: queryText, topic: 'news', search_depth: 'basic', max_results: 10, include_domains: domains.length ? domains : undefined }) });
  } catch (error) {
    throw new Error(`Tavily 无法连接网络：${error instanceof Error ? error.message : '未知网络错误'}。`);
  }
  if (response.status === 401) throw new Error('Tavily Key 无效、已撤销，或未开通搜索权限。');
  if (response.status === 403) throw new Error('Tavily 拒绝当前请求，请检查权限或地区访问策略。');
  if (response.status === 429) throw new Error('Tavily 额度或调用频率已达上限。');
  if (!response.ok) throw new Error(`Tavily 搜索失败（HTTP ${response.status}）。`);
  const payload = await response.json();
  return (Array.isArray(payload?.results) ? payload.results : []).flatMap((result) => {
    try {
      const url = new URL(String(result?.url ?? ''));
      const title = String(result?.title ?? '').trim();
      if (!title) return [];
      return [{ id: crypto.randomUUID(), title, summary: String(result?.content ?? '').trim().slice(0, 500), url: url.toString(), source: sourceName(url), category: String(input?.category || '未分类').trim() || '未分类', publishedAt: result?.published_date || null, heat: 0, trust: '待核验', captureMethod: 'SEARCH', language: /[\u3400-\u9fff]/.test(`${title} ${result?.content ?? ''}`) ? 'zh' : 'en' }];
    } catch { return []; }
  });
}

const crypto = require('node:crypto');
module.exports = { searchTavily };
