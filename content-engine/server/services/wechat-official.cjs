const { businessError } = require('./business-errors.cjs');

const WECHAT_API_BASE = 'https://api.weixin.qq.com';

function wechatError(payload, fallback) {
  const code = payload?.errcode;
  const message = payload?.errmsg || fallback;
  if (code && code !== 0) return businessError(502, 'WECHAT_OFFICIAL_API_ERROR', `微信接口返回错误：${message}`, { errcode: code, errmsg: payload?.errmsg });
  return businessError(502, 'WECHAT_OFFICIAL_API_ERROR', fallback, payload ?? {});
}

async function readJson(response, fallback) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw wechatError(payload, `${fallback}（HTTP ${response.status}）`);
  if (payload?.errcode && payload.errcode !== 0) throw wechatError(payload, fallback);
  return payload;
}

function assetFilename(asset, fallback) {
  const name = String(asset?.filename || fallback || 'image.png').replace(/[\\/:*?"<>|]/g, '_');
  return name.includes('.') ? name : `${name}.png`;
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
    const form = new FormData();
    form.append('media', new Blob([asset.buffer], { type: asset.mimeType || 'image/png' }), assetFilename(asset, 'article-image.png'));
    const payload = await readJson(await fetchImpl(url, { method: 'POST', body: form }), '上传图文正文图片失败');
    if (!payload.url) throw wechatError(payload, '微信没有返回正文图片 URL');
    return payload.url;
  }

  async function uploadThumb(accessToken, asset) {
    const url = new URL('/cgi-bin/material/add_material', WECHAT_API_BASE);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('type', 'thumb');
    const form = new FormData();
    form.append('media', new Blob([asset.buffer], { type: asset.mimeType || 'image/png' }), assetFilename(asset, 'thumb.png'));
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
      author: publishPackage.account.name,
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

  return { createDraft, testCredential };
}

module.exports = { createWechatOfficialClient };
