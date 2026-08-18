const { lookup } = require('node:dns/promises');
const cheerio = require('cheerio');
const { classifyIntelligence } = require('./intelligenceClassifier.cjs');
const { readWeChatArticleWithBrowser } = require('./browser-reader.cjs');

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

function assertWechatArticleUrl(rawUrl) {
  let url;
  try { url = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(String(rawUrl ?? '').trim()); }
  catch { throw new Error('请输入有效的公众号文章链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.toLowerCase() !== 'mp.weixin.qq.com' || !/^\/s(?:\/|$)/i.test(url.pathname)) {
    const error = new Error('只支持 mp.weixin.qq.com/s 下的公众号文章链接。');
    error.statusCode = 400;
    error.code = 'LAYOUT_TEMPLATE_SOURCE_UNSUPPORTED';
    throw error;
  }
  return url;
}

async function clipPublicLink(rawUrl) {
  const page = await fetchPublicPage(rawUrl);
  return buildPublicPreviewFromHtml(page.url, page.html);
}

async function readPublicArticle(rawUrl) {
  const page = await fetchPublicPage(rawUrl);
  const preview = buildPublicPreviewFromHtml(page.url, page.html);
  const content = extractPublicArticleContent(page.url, page.html);
  const text = content.plainText;
  if (text.length < 120) throw new Error('网页没有可用于提炼的文章正文。请确认链接是公开文章页，而不是列表、登录页或图片页。');
  return { ...preview, text: text.slice(0, 30_000), blocks: content.blocks, media: content.media };
}

function extractPublicArticleContent(url, html) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const root = $('#js_content').first().length ? $('#js_content').first() : ($('article, main, [role="main"]').first().length ? $('article, main, [role="main"]').first() : $('body'));
  root.find('script,style,noscript,template,form,nav,footer,header').remove();
  const blocks = [];
  const media = [];
  let position = 0;
  const pushText = (type, text, extra = {}) => {
    const value = clean(text);
    if (value) blocks.push({ id: `${type}-${blocks.length + 1}`, type, text: value, sourcePosition: position++, ...extra });
  };
  root.find('h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol,img,video').each((_, element) => {
    const node = $(element);
    const tag = String(element.name || '').toLowerCase();
    if (tag[0] === 'h') pushText('heading', node.text(), { level: Number(tag.slice(1)) });
    else if (tag === 'blockquote') pushText('quote', node.text());
    else if (tag === 'ul' || tag === 'ol') {
      const items = node.children('li').map((__, li) => clean($(li).text())).get().filter(Boolean);
      if (items.length) blocks.push({ id: `list-${blocks.length + 1}`, type: 'list', items, sourcePosition: position++ });
    } else if (tag === 'p') pushText('paragraph', node.text());
    else if (tag === 'img') {
      const source = node.attr('data-src') || node.attr('data-original') || node.attr('data-lazy-src') || node.attr('src');
      if (!source || /^data:/i.test(source)) return;
      let resolvedUrl;
      try { resolvedUrl = new URL(source, url).toString(); } catch { return; }
      if (!/^https?:$/i.test(new URL(resolvedUrl).protocol)) return;
      const candidate = { id: `media-${media.length + 1}`, mediaType: 'IMAGE', sourceUrl: source, resolvedUrl, altText: clean(node.attr('alt') || ''), caption: clean(node.parent('figure').find('figcaption').first().text() || ''), width: parseDimension(node.attr('width')), height: parseDimension(node.attr('height')), position: position++, classification: classifyImageCandidate(node, resolvedUrl) };
      media.push(candidate);
      blocks.push({ id: `image-${blocks.length + 1}`, type: 'image', mediaCandidateId: candidate.id, sourcePosition: candidate.position });
    } else if (tag === 'video') {
      const source = node.attr('src') || node.find('source').first().attr('src');
      if (!source || /^data:/i.test(source)) return;
      let resolvedUrl;
      try { resolvedUrl = new URL(source, url).toString(); } catch { return; }
      if (!/^https?:$/i.test(new URL(resolvedUrl).protocol)) return;
      const candidate = { id: `media-${media.length + 1}`, mediaType: 'VIDEO', sourceUrl: source, resolvedUrl, altText: clean(node.attr('title') || ''), caption: clean(node.parent('figure').find('figcaption').first().text() || ''), width: parseDimension(node.attr('width')), height: parseDimension(node.attr('height')), position: position++, classification: 'CONTENT' };
      media.push(candidate);
      blocks.push({ id: `video-${blocks.length + 1}`, type: 'embed', text: candidate.caption || candidate.altText || '视频素材', mediaCandidateId: candidate.id, sourcePosition: candidate.position });
    }
  });
  if (!blocks.some((block) => ['paragraph', 'heading', 'quote', 'list'].includes(block.type))) pushText('paragraph', root.text());
  const plainText = blocks.filter((block) => block.type !== 'image').flatMap((block) => block.type === 'list' ? block.items : [block.text]).filter(Boolean).join('\n\n');
  return { blocks, media, plainText };
}

function parseDimension(value) { const number = Number.parseInt(String(value ?? ''), 10); return Number.isFinite(number) && number > 0 ? number : null; }
function classifyImageCandidate(node, resolvedUrl) { const hint = `${node.attr('alt') || ''} ${node.attr('class') || ''} ${resolvedUrl}`.toLowerCase(); if (/avatar|author|headimg|portrait/.test(hint)) return 'AVATAR'; if (/logo|brand/.test(hint)) return 'LOGO'; if (/qr|qrcode|二维码/.test(hint)) return 'QR'; if (/ad[sx]?|advert|banner/.test(hint)) return 'AD'; return 'CONTENT'; }

async function fetchPublicPage(rawUrl, { fetchImpl = fetch, validateUrl = validatePublicUrl, browserFetch = readWeChatArticleWithBrowser } = {}) {
  let url = await validateUrl(rawUrl);
  assertNotVerificationPage(url);
  const requestedUrl = url;
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: requestHeaders(url),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('链接跳转缺少目标地址。');
    url = await validateUrl(new URL(location, url).toString());
    if (isWeChatVerificationUrl(url)) return browserFallback(requestedUrl, browserFetch, validateUrl);
    assertNotVerificationPage(url);
  }
  if (!response?.ok) throw new Error(`读取链接失败（HTTP ${response?.status ?? '网络错误'}）。`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('该链接不是可读取的网页。');
  const html = await readTextLimited(response, maxHtmlBytes(url));
  if (isWeChatHost(requestedUrl) && (isWeChatVerificationHtml(html) || !isWeChatArticleHtml(html))) {
    return browserFallback(requestedUrl, browserFetch, validateUrl);
  }
  return { url, html };
}

async function browserFallback(requestedUrl, browserFetch, validateUrl) {
  if (!browserFetch || !isWeChatHost(requestedUrl) || !/^\/s(?:\/|$)/i.test(requestedUrl.pathname)) {
    throwVerificationError();
  }
  let result;
  try {
    result = await browserFetch(requestedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : '浏览器读取失败。';
    throw new Error(`微信轻量读取触发了人机验证，浏览器辅助读取失败：${message}`);
  }
  const finalUrl = await validateUrl(result.url.toString());
  assertNotVerificationPage(finalUrl);
  if (isWeChatVerificationHtml(result.html)) throwVerificationError();
  if (!isWeChatArticleHtml(result.html)) throw new Error('浏览器未读取到公众号文章正文。请确认链接仍然有效，且不是登录或验证页面。');
  if (Buffer.byteLength(result.html, 'utf8') > maxHtmlBytes(finalUrl)) throw new Error('公众号页面内容超过 5MB，无法导入。');
  return { url: finalUrl, html: result.html };
}

function requestHeaders(url) {
  if (isWeChatHost(url)) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };
  }
  return { 'User-Agent': 'ContentEngine/1.0 Link Import', Accept: 'text/html,application/xhtml+xml' };
}

function maxHtmlBytes(url) { return isWeChatHost(url) ? 5_000_000 : 1_000_000; }

async function readTextLimited(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`网页内容超过 ${formatMegabytes(maxBytes)}，无法导入。`);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`网页内容超过 ${formatMegabytes(maxBytes)}，无法导入。`);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`网页内容超过 ${formatMegabytes(maxBytes)}，无法导入。`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function formatMegabytes(bytes) { return `${Math.round(bytes / 1_000_000)}MB`; }
function isWeChatHost(url) { return url.hostname.toLowerCase() === 'mp.weixin.qq.com'; }
function isWeChatVerificationUrl(url) { return isWeChatHost(url) && /\/mp\/wappoc_appmsgcaptcha/i.test(url.pathname); }
function isWeChatVerificationHtml(html) { return /wappoc_appmsgcaptcha|appmsgcaptcha/i.test(html) && !/id=["']js_content["']/i.test(html); }
function isWeChatArticleHtml(html) { return /id=["']js_content["']/i.test(html) && /(?:property|name)=["']og:title["']/i.test(html); }
function assertNotVerificationPage(url) {
  if (isWeChatVerificationUrl(url)) throwVerificationError();
}
function throwVerificationError() { throw new Error('这是微信的人机验证页，不是文章正文。请在浏览器中完成验证后重新提交原始文章链接；系统不会绕过验证码。'); }

function buildPublicPreviewFromHtml(url, html) {
  const title = htmlMeta(html, 'og:title') || htmlMeta(html, 'twitter:title') || htmlTitle(html) || '未命名文章';
  const summary = htmlMeta(html, 'og:description') || htmlMeta(html, 'description') || htmlArticleText(html) || '';
  return buildPublicPreview(url, title, summary, extractPublishedAt(html), extractPublicArticleMetrics(html));
}

function buildPublicPreview(url, rawTitle, rawSummary, publishedAt = null, metrics = null) {
  const title = clean(rawTitle).slice(0, 240);
  const summary = clean(rawSummary).slice(0, 500);
  const classification = classifyIntelligence({ title, summary, fallbackCategory: '其它' });
  return { url: url.toString(), title, summary, source: sourceName(url), category: classification.category, keywords: classification.keywords, publishedAt, ...(metrics ? { metrics } : {}) };
}

const PUBLIC_METRIC_KEYS = {
  readCount: ['read_num', 'read_count', 'readCount', 'int_page_read_count'],
  likeCount: ['like_num', 'like_count', 'likeNum', 'likeCount', 'old_like_num'],
  shareCount: ['share_num', 'share_count', 'shareNum', 'shareCount'],
  favoriteCount: ['add_to_fav_count', 'favorite_count', 'favorite_num', 'fav_num', 'favoriteCount'],
  commentCount: ['comment_count', 'comment_num', 'commentCount'],
};

function extractPublicArticleMetrics(html) {
  const stats = extractAssignedObject(html, ['appmsgstat', 'appmsg_stat', 'articleStats', 'article_stats']);
  const values = {};
  for (const [metric, keys] of Object.entries(PUBLIC_METRIC_KEYS)) values[metric] = extractMetricNumber(stats, html, keys);
  if (!Object.values(values).some((value) => value !== null)) return null;
  return { source: 'PUBLIC_PAGE', ...values, exposureCount: null, playCount: null, followerDelta: null, raw: { parser: 'WECHAT_PUBLIC_PAGE', values } };
}

function extractAssignedObject(html, names) {
  for (const name of names) {
    const marker = new RegExp(`(?:var\\s+|window\\.)?${escapeRegExp(name)}\\s*=`, 'i').exec(html);
    if (!marker) continue;
    const start = html.indexOf('{', marker.index + marker[0].length);
    if (start < 0) continue;
    const objectText = balancedObjectText(html, start);
    if (!objectText) continue;
    try { return JSON.parse(objectText); } catch { /* 继续从标记和 DOM 读取。 */ }
  }
  return {};
}

function balancedObjectText(text, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return '';
}

function extractMetricNumber(stats, html, keys) {
  const keyPattern = keys.map(escapeRegExp).join('|');
  for (const key of keys) {
    const number = parseMetricNumber(stats?.[key]);
    if (number !== null) return number;
  }
  const assigned = new RegExp(`(?:["']?(?:${keyPattern})["']?)\\s*[:=]\\s*["']?([^,}\\n;"']+)`, 'i').exec(html)?.[1];
  const assignedNumber = parseMetricNumber(assigned);
  if (assignedNumber !== null) return assignedNumber;
  const visible = new RegExp(`(?:id|class|data-[\\w-]+)=["'][^"']*(?:${keyPattern})[^"']*["'][^>]*>([\\s\\S]{0,160})<`, 'i').exec(html)?.[1];
  return parseMetricNumber(visible);
}


function parseMetricNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, '');
  const match = text.match(/-?[0-9]+([.][0-9]+)?/);
  if (!match) return null;
  const base = Number(match[0]);
  if (!Number.isFinite(base) || base < 0) return null;
  const multiplier = text.includes(String.fromCharCode(0x4ebf)) ? 100_000_000 : text.includes(String.fromCharCode(0x4e07)) ? 10_000 : 1;
  const result = Math.round(base * multiplier);
  return Number.isSafeInteger(result) ? result : null;
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }

function extractPublishedAt(html) {
  const candidates = [
    htmlMeta(html, 'datePublished'),
    htmlMeta(html, 'article:published_time'),
    /id=["']publish_time["'][^>]*>([^<]+)/i.exec(html)?.[1],
    /\b(?:oriCreateTime|createTime|msgCreateTime|ct)\s*=\s*["']([^"']+)["']/i.exec(html)?.[1],
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    const numeric = /^\d{10}$/.test(candidate) ? Number(candidate) * 1000 : /^\d{13}$/.test(candidate) ? Number(candidate) : NaN;
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(candidate);
    if (Number.isFinite(date.valueOf())) return date.toISOString();
  }
  return null;
}

function sourceName(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'mp.weixin.qq.com') return '公众号文章';
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'X';
  if (host.includes('toutiao.com')) return '今日头条';
  if (host.includes('cctv.com')) return '央视网';
  return host.replace(/^www\./, '');
}

function htmlMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*>`, 'i').exec(html)?.[0];
  return tag && /content=["']([^"']*)["']/i.exec(tag)?.[1] ? /content=["']([^"']*)["']/i.exec(tag)[1] : '';
}

function htmlTitle(html) { return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''; }
function htmlArticleText(html) {
  const weChat = htmlElementInnerById(html, 'js_content');
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  return clean((weChat || article || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' '));
}
function htmlContentText(html) {
  const weChat = htmlElementInnerById(html, 'js_content');
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  return clean((weChat || article || main || body || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(?:p|div|li|h[1-6])>/gi, ' '));
}
function htmlElementInnerById(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opening = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, 'i').exec(html);
  if (!opening) return '';
  const tagName = opening[1];
  const start = opening.index + opening[0].length;
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tags.lastIndex = start;
  let depth = 1;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return html.slice(start, match.index);
  }
  return '';
}
function clean(value) {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);?/gi, (match, entity) => {
      const raw = String(entity);
      const code = raw.toLowerCase().startsWith('x') ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&(nbsp|quot|apos|amp|lt|gt);/gi, (match, entity) => ({ nbsp: ' ', quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' })[String(entity).toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}
function isPrivateAddress(address) { const value = address.toLowerCase(); if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true; if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false; const [a, b] = value.split('.').map(Number); return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }

module.exports = { clipPublicLink, readPublicArticle, fetchPublicPage, buildPublicPreviewFromHtml, extractPublicArticleMetrics, extractPublicArticleContent, sourceName, validatePublicUrl, assertWechatArticleUrl, buildPublicPreview };
