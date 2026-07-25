const { lookup } = require('node:dns/promises');
const { classifyIntelligence } = require('./intelligenceClassifier.cjs');

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

async function clipPublicLink(rawUrl) {
  let url = await validatePublicUrl(rawUrl);
  if (url.hostname.toLowerCase() === 'mp.weixin.qq.com' && /\/mp\/wappoc_appmsgcaptcha/i.test(url.pathname)) {
    throw new Error('这是微信的人机验证页，不是文章正文。请完成验证后复制公众号文章链接；系统不会绕过验证码。');
  }
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'ContentEngine/1.0 Link Clip' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('链接跳转缺少目标地址。');
    url = await validatePublicUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`读取链接失败（HTTP ${response?.status ?? '网络错误'}）。`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('该链接不是可读取的网页。');
  const html = await response.text();
  if (html.length > 1_000_000) throw new Error('网页内容超过 1MB，无法剪藏。');
  const title = htmlMeta(html, 'og:title') || htmlMeta(html, 'twitter:title') || htmlTitle(html) || '未命名文章';
  const summary = htmlMeta(html, 'og:description') || htmlMeta(html, 'description') || '';
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
function clean(value) { return String(value).replace(/<[^>]+>/g, ' ').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function isPrivateAddress(address) { const value = address.toLowerCase(); if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true; if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false; const [a, b] = value.split('.').map(Number); return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }

module.exports = { clipPublicLink, sourceName, validatePublicUrl, buildPublicPreview };
