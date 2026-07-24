const { XMLParser } = require('fast-xml-parser');
const { validatePublicUrl, sourceName } = require('./public-web.cjs');

async function refreshRss(sources) {
  const enabled = Array.isArray(sources) ? sources.filter((source) => source?.enabled && source?.type === 'RSS') : [];
  const settled = await Promise.allSettled(enabled.map(collectRss));
  const items = [];
  const results = settled.map((result, index) => {
    const source = enabled[index];
    if (result.status === 'fulfilled') { items.push(...result.value); return { sourceId: source.id, ok: true, count: result.value.length }; }
    return { sourceId: source.id, ok: false, count: 0, error: result.reason instanceof Error ? result.reason.message : '采集失败。' };
  });
  return { items, results };
}

async function collectRss(source) {
  const url = await validatePublicUrl(source.url);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'ContentEngine/1.0 RSS Reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error(`RSS 请求失败（HTTP ${response.status}）。`);
  const xml = await response.text();
  if (xml.length > 2_000_000) throw new Error('RSS 响应超过 2MB。');
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(xml);
  const entries = asArray(parsed?.rss?.channel?.item ?? parsed?.feed?.entry).slice(0, 60);
  const include = keywords(source.includeKeywords); const exclude = keywords(source.excludeKeywords);
  return entries.map((entry, index) => {
    const title = clean(entry?.title); const summary = clean(entry?.description ?? entry?.summary ?? entry?.content ?? ''); const combined = `${title} ${summary}`;
    const link = linkFor(entry); if (!title || !match(combined, include, exclude) || !languageMatches(combined, source.language)) return null;
    return { id: `rss-${source.id}-${Date.now()}-${index}`, title: title.slice(0, 240), summary: summary.slice(0, 500), category: source.category || '未分类', source: source.name || sourceName(url), publishedAt: formatTime(entry?.pubDate ?? entry?.published ?? entry?.updated), heat: 0, trust: source.trust || '待核验', url: link || undefined, captureMethod: 'RSS', language: detectLanguage(combined) };
  }).filter(Boolean);
}

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function clean(value) { return String(typeof value === 'object' && value ? value['#text'] ?? '' : value ?? '').replace(/<[^>]+>/g, ' ').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function linkFor(entry) { const link = Array.isArray(entry?.link) ? entry.link.find((item) => item?.['@_href']) : entry?.link; return typeof link === 'object' ? link?.['@_href'] ?? '' : String(link ?? ''); }
function keywords(value) { return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : []; }
function match(value, include, exclude) { const lower = value.toLowerCase(); return (!include.length || include.some((word) => lower.includes(word))) && !exclude.some((word) => lower.includes(word)); }
function detectLanguage(value) { if (/[\u3400-\u9fff]/.test(value)) return 'zh'; if (/[a-z]/i.test(value)) return 'en'; return 'other'; }
function languageMatches(value, language) { return !language || language === 'ALL' || (language === 'ZH' && detectLanguage(value) === 'zh') || (language === 'EN' && detectLanguage(value) === 'en'); }
function formatTime(value) { const date = new Date(String(value ?? '')); return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString(); }

module.exports = { refreshRss };
