const { lookup } = require('node:dns/promises');
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
  const text = htmlContentText(page.html);
  if (text.length < 120) throw new Error('网页没有可用于提炼的文章正文。请确认链接是公开文章页，而不是列表、登录页或图片页。');
  return { ...preview, text: text.slice(0, 30_000) };
}

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
  return buildPublicPreview(url, title, summary);
}

function buildPublicPreview(url, rawTitle, rawSummary) {
  const title = clean(rawTitle).slice(0, 240);
  const summary = clean(rawSummary).slice(0, 500);
  const classification = classifyIntelligence({ title, summary, fallbackCategory: '其它' });
  return { url: url.toString(), title, summary, source: sourceName(url), category: classification.category, keywords: classification.keywords };
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

module.exports = { clipPublicLink, readPublicArticle, fetchPublicPage, buildPublicPreviewFromHtml, sourceName, validatePublicUrl, assertWechatArticleUrl, buildPublicPreview };
