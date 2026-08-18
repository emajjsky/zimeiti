const { decrypt } = require('../crypto.cjs');
const { query } = require('../db.cjs');
const { sourceName } = require('./public-web.cjs');
const { classifyIntelligence } = require('./intelligenceClassifier.cjs');
const { externalFetch } = require('./network.cjs');
const crypto = require('node:crypto');

async function searchTavily(workspaceId, input) {
  const row = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'TAVILY']);
  if (!row.rowCount) throw new Error('请先在设置中保存 Tavily Key。');
  const apiKey = decrypt(row.rows[0].encrypted_secret);
  const queryText = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!queryText || queryText.length > 300) throw new Error('请输入 1 到 300 个字符的搜索词。');
  const domains = Array.isArray(input?.domains) ? input.domains.filter((item) => typeof item === 'string' && item.length < 120).slice(0, 5) : [];
  let response;
  try {
    response = await externalFetch('https://api.tavily.com/search', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: queryText, topic: 'news', search_depth: 'basic', max_results: 10, include_domains: domains.length ? domains : undefined }) });
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
      const item = tavilyResultToItem(result, input, crypto.randomUUID());
      return item ? [item] : [];
    } catch { return []; }
  });
}

async function searchTavilyImages(workspaceId, queryText) {
  const row = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'TAVILY']);
  if (!row.rowCount) return [];
  const apiKey = decrypt(row.rows[0].encrypted_secret);
  const normalized = typeof queryText === 'string' ? queryText.trim() : '';
  if (normalized.length < 2 || normalized.length > 120) return [];
  let response;
  try {
    response = await externalFetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: normalized,
        topic: 'general',
        search_depth: 'basic',
        max_results: 5,
        include_images: true,
        include_image_descriptions: true,
      }),
    });
  } catch (error) {
    throw new Error(`Tavily 图片搜索无法连接：${error instanceof Error ? error.message : '网络错误'}`);
  }
  if (response.status === 401) throw new Error('Tavily Key 无效或未开通图片搜索权限。');
  if (response.status === 429) throw new Error('Tavily 图片搜索额度或频率已达上限。');
  if (!response.ok) throw new Error(`Tavily 图片搜索返回 HTTP ${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload?.images) ? payload.images : []).flatMap((image, index) => {
    const url = typeof image === 'string' ? image : String(image?.url ?? '');
    if (!/^https?:\/\//i.test(url)) return [];
    const description = typeof image === 'object' ? String(image?.description ?? '').trim() : '';
    return [{
      id: `tavily-${index}-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`,
      title: (description || `网页候选图 ${index + 1}`).slice(0, 200),
      thumbnailUrl: url,
      imageUrl: url,
      sourceUrl: url,
      license: '使用前确认版权与授权',
      attribution: 'Tavily 网页图片检索',
      copyrightStatus: 'PENDING',
    }];
  }).slice(0, 12);
}

function tavilyResultToItem(result, input, id = crypto.randomUUID()) {
  const url = new URL(String(result?.url ?? ''));
  const title = String(result?.title ?? '').trim();
  if (!title) return null;
  const summary = String(result?.content ?? '').trim().slice(0, 500);
  const classification = classifyIntelligence({ title, summary, fallbackCategory: String(input?.category || '其它').trim() || '其它' });
  const relevanceScore = Number(result?.score);
  return { id, title, summary, url: url.toString(), source: sourceName(url), category: classification.category, keywords: classification.keywords, publishedAt: result?.published_date || new Date().toISOString(), relevanceScore: Number.isFinite(relevanceScore) ? relevanceScore : undefined, heat: 0, trust: '待核验', captureMethod: 'SEARCH', language: /[\u3400-\u9fff]/.test(`${title} ${summary}`) ? 'zh' : 'en' };
}

module.exports = { searchTavily, searchTavilyImages, tavilyResultToItem };
