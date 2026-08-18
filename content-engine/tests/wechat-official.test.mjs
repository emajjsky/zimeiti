import assert from 'node:assert/strict';
import test from 'node:test';

import { createWechatOfficialClient, normalizeWechatImage } from '../server/services/wechat-official.cjs';

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('微信草稿图片在上传边界统一转换为受支持的 JPEG，封面满足缩略图体积限制', async () => {
  const articleImage = await normalizeWechatImage({ buffer: onePixelPng, mimeType: 'image/png', filename: 'cover.png' });
  const thumb = await normalizeWechatImage({ buffer: onePixelPng, mimeType: 'image/png', filename: 'cover.png' }, { thumb: true });

  assert.equal(articleImage.mimeType, 'image/jpeg');
  assert.equal(articleImage.filename, 'cover.jpg');
  assert.deepEqual([...articleImage.buffer.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(thumb.mimeType, 'image/jpeg');
  assert.equal(thumb.filename, 'thumb.jpg');
  assert.ok(thumb.buffer.length <= 64 * 1024);
});

test('微信 IP 白名单错误转换为可执行的配置提示', async () => {
  const client = createWechatOfficialClient({
    fetchImpl: async () => new Response(JSON.stringify({
      errcode: 40164,
      errmsg: 'invalid ip 183.225.3.189 ipv6 ::ffff:183.225.3.189, not in whitelist rid:abc',
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    () => client.testCredential({ appId: 'wx123456', appSecret: 'secret123456' }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, 'WECHAT_IP_NOT_WHITELISTED');
      assert.match(error.message, /183\.225\.3\.189/);
      assert.match(error.message, /IP 白名单/);
      assert.deepEqual(error.details.whitelistIps, ['183.225.3.189']);
      assert.equal(error.details.observedIpv6, '::ffff:183.225.3.189');
      return true;
    },
  );
});

test('璇诲彇鍏紬鍙锋枃绔犳暟鎹娇鐢ㄦ寚瀹氭棩鏈熻寖鍥村苟杩斿洖鏂囩珷鍒楄〃', async () => {
  const requests = [];
  const client = createWechatOfficialClient({
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      requests.push({ pathname: url.pathname, body: init?.body ? JSON.parse(init.body) : null });
      if (url.pathname === '/cgi-bin/token') return new Response(JSON.stringify({ access_token: 'token' }), { headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/datacube/getarticlesummary') return new Response(JSON.stringify({ list: [{ title: '文章 A', int_page_read_count: 120, int_page_read_user: 90, like_count: 8 }] }), { headers: { 'content-type': 'application/json' } });
      throw new Error(`unexpected request: ${url.pathname}`);
    },
  });

  const rows = await client.articleSummary({ credential: { appId: 'wx123456', appSecret: 'secret123456' }, beginDate: '2026-08-07', endDate: '2026-08-07' });
  assert.deepEqual(rows, [{ title: '文章 A', int_page_read_count: 120, int_page_read_user: 90, like_count: 8 }]);
  assert.deepEqual(requests, [
    { pathname: '/cgi-bin/token', body: null },
    { pathname: '/datacube/getarticlesummary', body: { begin_date: '2026-08-07', end_date: '2026-08-07' } },
  ]);
});

test('新增公众号草稿不把内部发布账号名称错误映射为文章作者', async () => {
  let draftPayload = null;
  const client = createWechatOfficialClient({
    fetchImpl: async (input, init) => {
      const pathname = new URL(input).pathname;
      if (pathname === '/cgi-bin/token') return new Response(JSON.stringify({ access_token: 'token' }), { headers: { 'content-type': 'application/json' } });
      if (pathname === '/cgi-bin/material/add_material') return new Response(JSON.stringify({ media_id: 'thumb-media-id' }), { headers: { 'content-type': 'application/json' } });
      if (pathname === '/cgi-bin/draft/add') {
        draftPayload = JSON.parse(init.body);
        return new Response(JSON.stringify({ media_id: 'draft-media-id' }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected request: ${pathname}`);
    },
  });

  const result = await client.createDraft({
    credential: { appId: 'wx123456', appSecret: 'secret123456' },
    publishPackage: {
      title: '测试文章标题',
      body: '这是正文摘要。',
      html: '<p>这是正文。</p>',
      coverAssetId: 'cover-asset-id',
      account: { name: '爱搭智能体的二师兄·官方' },
    },
    assets: [{ assetId: 'cover-asset-id', buffer: onePixelPng, mimeType: 'image/png', filename: 'cover.png' }],
  });

  assert.equal(result.mediaId, 'draft-media-id');
  assert.deepEqual(draftPayload, {
    articles: [{
      title: '测试文章标题',
      digest: '这是正文摘要。',
      content: '<p>这是正文。</p>',
      thumb_media_id: 'thumb-media-id',
      show_cover_pic: 1,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }],
  });
});
test('微信数据统计接口未授权时返回明确的权限提示', async () => {
  const client = createWechatOfficialClient({
    fetchImpl: async () => new Response(JSON.stringify({ errcode: 48001, errmsg: 'api unauthorized rid:abc' }), { headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    () => client.articleSummary({ credential: { appId: 'wx123456', appSecret: 'secret123456' }, beginDate: '2026-08-07', endDate: '2026-08-07' }),
    (error) => error.code === 'WECHAT_API_UNAUTHORIZED' && error.statusCode === 409 && /数据统计权限/.test(error.message),
  );
});
