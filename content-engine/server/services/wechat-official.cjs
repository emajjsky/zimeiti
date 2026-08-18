const { businessError } = require('./business-errors.cjs');
const sharp = require('sharp');

const WECHAT_API_BASE = 'https://api.weixin.qq.com';

function wechatError(payload, fallback) {
  const code = payload?.errcode;
  const message = payload?.errmsg || fallback;
  if (/invalid ip\s+([^\s,]+)(?:\s+ipv6\s+([^\s,]+))?.*not in whitelist/i.test(message)) {
    const [, ipv4, ipv6] = message.match(/invalid ip\s+([^\s,]+)(?:\s+ipv6\s+([^\s,]+))?/i) ?? [];
    const whitelistIps = ipv4 ? [ipv4] : ipv6 ? [ipv6] : [];
    return businessError(502, 'WECHAT_IP_NOT_WHITELISTED', `微信公众号接口拒绝了服务器出口 IP。请将 ${whitelistIps.join('、')} 加入公众号后台的 IP 白名单后重新测试连接。`, { errcode: code, errmsg: payload?.errmsg, whitelistIps, observedIpv6: ipv6 ?? null });
  }
  if (code && code !== 0) return businessError(502, 'WECHAT_OFFICIAL_API_ERROR', `微信接口返回错误：${message}`, { errcode: code, errmsg: payload?.errmsg });
  return businessError(502, 'WECHAT_OFFICIAL_API_ERROR', fallback, payload ?? {});
}

async function readJson(response, fallback) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw wechatError(payload, `${fallback}（HTTP ${response.status}）`);
  if (payload?.errcode === 48001 || /api unauthorized/i.test(payload?.errmsg ?? '')) throw businessError(409, 'WECHAT_API_UNAUTHORIZED', '当前公众号开发者凭证无权访问文章数据统计接口。请在微信公众平台确认账号类型、认证状态和数据统计权限。', { errcode: payload.errcode, errmsg: payload.errmsg });
  if (payload?.errcode && payload.errcode !== 0) throw wechatError(payload, fallback);
  return payload;
}

async function normalizeWechatImage(asset, { thumb = false } = {}) {
  const source = Buffer.from(asset?.buffer ?? []);
  if (!source.length) throw businessError(400, 'WECHAT_IMAGE_EMPTY', '微信草稿图片内容为空。');
  const baseName = String(asset?.filename || (thumb ? 'thumb' : 'article-image'))
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.[^.]+$/, '') || (thumb ? 'thumb' : 'article-image');
  const maxBytes = thumb ? 64 * 1024 : 1024 * 1024;
  const widths = thumb ? [900, 700, 500, 400] : [1600, 1200, 900];
  const qualities = thumb ? [82, 72, 60, 48, 36] : [88, 76, 64];
  let best = null;
  for (const width of widths) {
    for (const quality of qualities) {
      const buffer = await sharp(source).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
      best = buffer;
      if (buffer.length <= maxBytes) return { buffer, mimeType: 'image/jpeg', filename: `${thumb ? 'thumb' : baseName}.jpg` };
    }
  }
  if (best && best.length <= maxBytes) return { buffer: best, mimeType: 'image/jpeg', filename: `${thumb ? 'thumb' : baseName}.jpg` };
  throw businessError(400, thumb ? 'WECHAT_THUMB_TOO_LARGE' : 'WECHAT_IMAGE_TOO_LARGE', thumb ? '封面图片压缩后仍超过微信缩略图 64KB 限制，请更换图片。' : '正文图片压缩后仍超过微信图片 1MB 限制，请更换图片。');
}

function replaceImageSource(html, assetId, url) {
  const escaped = String(assetId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html
    .replace(new RegExp(`src="/api/v1/assets/${escaped}/content"`, 'g'), `src="${url}"`)
    .replace(new RegExp(`src='/api/v1/assets/${escaped}/content'`, 'g'), `src="${url}"`);
}

function createWechatOfficialClient({ fetchImpl = fetch } = {}) {
  async function getAccessToken({ appId, appSecret }) {
    const url = new URL('/cgi-bin/token', WECHAT_API_BASE);
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    const payload = await readJson(await fetchImpl(url), '获取公众号 access_token 失败');
    if (!payload.access_token) throw wechatError(payload, '微信没有返回 access_token');
    return payload.access_token;
  }

  async function uploadArticleImage(accessToken, asset) {
    const url = new URL('/cgi-bin/media/uploadimg', WECHAT_API_BASE);
    url.searchParams.set('access_token', accessToken);
    const normalized = await normalizeWechatImage(asset);
    const form = new FormData();
    form.append('media', new Blob([normalized.buffer], { type: normalized.mimeType }), normalized.filename);
    const payload = await readJson(await fetchImpl(url, { method: 'POST', body: form }), '上传图文正文图片失败');
    if (!payload.url) throw wechatError(payload, '微信没有返回正文图片 URL');
    return payload.url;
  }

  async function uploadThumb(accessToken, asset) {
    const url = new URL('/cgi-bin/material/add_material', WECHAT_API_BASE);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('type', 'thumb');
    const normalized = await normalizeWechatImage(asset, { thumb: true });
    const form = new FormData();
    form.append('media', new Blob([normalized.buffer], { type: normalized.mimeType }), normalized.filename);
    const payload = await readJson(await fetchImpl(url, { method: 'POST', body: form }), '上传草稿封面素材失败');
    if (!payload.media_id) throw wechatError(payload, '微信没有返回封面 thumb_media_id');
    return payload.media_id;
  }

  async function addDraft(accessToken, article) {
    const url = new URL('/cgi-bin/draft/add', WECHAT_API_BASE);
    url.searchParams.set('access_token', accessToken);
    const payload = await readJson(await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: [article] }),
    }), '新增公众号草稿失败');
    if (!payload.media_id) throw wechatError(payload, '微信没有返回草稿 media_id');
    return payload.media_id;
  }

  async function getArticleSummary(accessToken, { beginDate, endDate }) {
    const url = new URL('/datacube/getarticlesummary', WECHAT_API_BASE);
    url.searchParams.set('access_token', accessToken);
    const payload = await readJson(await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ begin_date: beginDate, end_date: endDate }),
    }), '读取公众号文章数据失败');
    return Array.isArray(payload.list) ? payload.list : [];
  }

  async function createDraft({ credential, publishPackage, assets }) {
    const accessToken = await getAccessToken(credential);
    const coverAsset = assets.find((asset) => asset.assetId === publishPackage.coverAssetId) ?? assets[0];
    if (!coverAsset) throw businessError(400, 'WECHAT_DRAFT_COVER_REQUIRED', '自动导入公众号草稿箱需要至少一张封面图。');
    const thumbMediaId = await uploadThumb(accessToken, coverAsset);
    let content = publishPackage.html;
    let uploadedImageCount = 0;
    for (const asset of assets) {
      if (asset.assetId === coverAsset.assetId) continue;
      const imageUrl = await uploadArticleImage(accessToken, asset);
      content = replaceImageSource(content, asset.assetId, imageUrl);
      uploadedImageCount += 1;
    }
    const mediaId = await addDraft(accessToken, {
      title: publishPackage.title,
      digest: publishPackage.body.replace(/<[^>]+>/g, '').slice(0, 120),
      content,
      thumb_media_id: thumbMediaId,
      show_cover_pic: 1,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    });
    return { mediaId, thumbMediaId, uploadedImageCount };
  }

  async function testCredential(credential) {
    await getAccessToken(credential);
    return { ok: true };
  }

  async function articleSummary({ credential, beginDate, endDate }) {
    const accessToken = await getAccessToken(credential);
    return getArticleSummary(accessToken, { beginDate, endDate });
  }

  return { articleSummary, createDraft, testCredential };
}

module.exports = { createWechatOfficialClient, normalizeWechatImage };
