import assert from 'node:assert/strict';
import test from 'node:test';
import publicWeb from '../server/services/public-web.cjs';

const wechatUrl = 'https://mp.weixin.qq.com/s/dZywm0B_aElUCYIAPEy5uA';

test('公众号文章使用浏览器请求环境并允许读取大于 1MB 的页面', async () => {
  assert.equal(typeof publicWeb.fetchPublicPage, 'function');
  const articleHtml = `
    <meta property="og:title" content="公众号测试文章" />
    <div id="js_content"><p>这是用于生成摘要的公众号正文内容。</p></div>
    <script>${'x'.repeat(1_100_000)}</script>
  `;

  const result = await publicWeb.fetchPublicPage(wechatUrl, {
    validateUrl: async (value) => new URL(value),
    fetchImpl: async (_url, options) => {
      const userAgent = options.headers['User-Agent'];
      if (!userAgent.includes('Mozilla/5.0')) {
        return new Response('', {
          status: 302,
          headers: { location: 'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=test' },
        });
      }
      return new Response(articleHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });

  assert.equal(result.url.toString(), wechatUrl);
  assert.equal(result.html, articleHtml);
});

test('public article metrics are extracted for the review ledger', () => {
  const preview = publicWeb.buildPublicPreviewFromHtml(
    new URL(wechatUrl),
    `<meta property="og:title" content="metric article" />
      <meta property="article:published_time" content="2026-08-08T09:35:00+08:00" />
      <div id="js_content"><p>article content for public metric extraction</p></div>
      <script>var appmsgstat = {"read_num":1234,"like_num":247,"share_num":886,"add_to_fav_count":82,"comment_count":2};</script>`,
  );

  assert.deepEqual(preview.metrics, {
    source: 'PUBLIC_PAGE',
    readCount: 1234,
    likeCount: 247,
    shareCount: 886,
    favoriteCount: 82,
    commentCount: 2,
    exposureCount: null,
    playCount: null,
    followerDelta: null,
    raw: { parser: 'WECHAT_PUBLIC_PAGE', values: { readCount: 1234, likeCount: 247, shareCount: 886, favoriteCount: 82, commentCount: 2 } },
  });
});

test('公众号文章重定向到人机验证页时立即停止读取', async () => {
  assert.equal(typeof publicWeb.fetchPublicPage, 'function');
  let fetchCount = 0;

  await assert.rejects(
    publicWeb.fetchPublicPage(wechatUrl, {
      validateUrl: async (value) => new URL(value),
      browserFetch: null,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response('', {
          status: 302,
          headers: { location: 'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=test' },
        });
      },
    }),
    /人机验证页/,
  );

  assert.equal(fetchCount, 1);
});

test('公众号轻量请求触发验证页时使用隔离浏览器读取正文', async () => {
  assert.equal(typeof publicWeb.fetchPublicPage, 'function');
  let fetchCount = 0;
  let browserCount = 0;
  const articleHtml = '<meta property="og:title" content="浏览器读取文章" /><div id="js_content"><p>浏览器读取到的正文。</p></div>';

  const result = await publicWeb.fetchPublicPage(wechatUrl, {
    validateUrl: async (value) => new URL(value),
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response('', {
        status: 302,
        headers: { location: 'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=test' },
      });
    },
    browserFetch: async (url) => {
      browserCount += 1;
      return { url, html: articleHtml };
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(browserCount, 1);
  assert.equal(result.url.toString(), wechatUrl);
  assert.equal(result.html, articleHtml);
});

test('公众号返回 200 异常页但没有正文容器时也使用隔离浏览器', async () => {
  let browserCount = 0;
  const articleHtml = '<meta property="og:title" content="浏览器读取文章" /><div id="js_content"><p>浏览器读取到的正文。</p></div>';

  const result = await publicWeb.fetchPublicPage(wechatUrl, {
    validateUrl: async (value) => new URL(value),
    fetchImpl: async () => new Response('<html><title>微信公众平台</title><p>环境异常</p></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
    browserFetch: async (url) => {
      browserCount += 1;
      return { url, html: articleHtml };
    },
  });

  assert.equal(browserCount, 1);
  assert.equal(result.html, articleHtml);
});

test('公众号文章在 description 为空时从正文生成摘要', () => {
  assert.equal(typeof publicWeb.buildPublicPreviewFromHtml, 'function');
  const preview = publicWeb.buildPublicPreviewFromHtml(
    new URL(wechatUrl),
    `
      <meta property="og:title" content="公众号测试文章" />
      <meta name="description" content="" />
      <div id="js_content">
        <section><div class="cover-image"></div></section>
        <section>
          <p>第一段用于说明事件背景。</p>
          <p>第二段包含值得收藏的详细信息。</p>
        </section>
      </div>
    `,
  );

  assert.equal(preview.title, '公众号测试文章');
  assert.match(preview.summary, /第一段用于说明事件背景/);
  assert.match(preview.summary, /第二段包含值得收藏的详细信息/);
  assert.equal(preview.source, '公众号文章');
});
