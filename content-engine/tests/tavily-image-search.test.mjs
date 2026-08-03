import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeImageSearchResult, searchImagesWithFallback, searchWikimediaImages } = require('../server/services/image-search.cjs');

test('配图搜索优先复用已配置的 Tavily 图片能力并保留版权提醒', () => {
  const service = fs.readFileSync(new URL('../server/services/tavily.cjs', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(service, /include_images: true/);
  assert.match(service, /include_image_descriptions: true/);
  assert.match(service, /使用前确认版权与授权/);
  assert.match(api, /searchTavilyImages\(workspace\.id, input\.q\)/);
  assert.match(api, /searchImagesWithFallback/);
  assert.match(api, /searchWikimediaImages\(input\.q\)/);
  assert.match(service, /copyrightStatus: 'PENDING'/);
});

test('图片搜索等待优先来源完成，只有空结果或失败才调用开放图库', async () => {
  const calls = [];
  const primaryResult = { id: 'primary-1', title: '真实工作场景', thumbnailUrl: 'https://example.com/thumb.jpg', imageUrl: 'https://example.com/image.jpg', sourceUrl: 'https://example.com/source', license: '待确认', attribution: 'Tavily', copyrightStatus: 'PENDING' };
  const preferred = await searchImagesWithFallback('创作者整理研究资料', {
    searchPrimary: async () => { calls.push('primary'); return [primaryResult]; },
    searchFallback: async () => { calls.push('fallback'); return []; },
  });
  assert.equal(preferred.provider, 'Tavily 图片搜索');
  assert.deepEqual(calls, ['primary']);

  calls.length = 0;
  const fallbackResult = { ...primaryResult, id: 'fallback-1', copyrightStatus: 'OPEN_LICENSE' };
  const fallback = await searchImagesWithFallback('创作者整理研究资料', {
    searchPrimary: async () => { calls.push('primary'); return []; },
    searchFallback: async () => { calls.push('fallback'); return [fallbackResult]; },
  });
  assert.equal(fallback.provider, 'Wikimedia Commons');
  assert.deepEqual(calls, ['primary', 'fallback']);
});

test('搜索结果在导入前统一标题长度和版权状态', () => {
  const result = normalizeImageSearchResult({
    id: 'candidate-1',
    title: `<b>${'很长的候选图片标题'.repeat(40)}</b>`,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    imageUrl: 'https://example.com/image.jpg',
    sourceUrl: 'https://example.com/source',
    license: '使用前确认版权与授权',
    attribution: '网页图片检索',
  });
  assert.equal(result.title.length, 200);
  assert.equal(result.copyrightStatus, 'PENDING');
  assert.doesNotMatch(result.title, /<b>/);
});

test('Wikimedia 搜索结果明确标记开放许可并生成可导入标题', async () => {
  const longTitle = `File:${'卫星通信资料图片'.repeat(40)}.jpg`;
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ query: { pages: [{ pageid: 7, title: longTitle, imageinfo: [{ url: 'https://commons.example/full.jpg', thumburl: 'https://commons.example/thumb.jpg', descriptionurl: 'https://commons.example/page', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, Artist: { value: '<b>作者</b>' } } }] }] } }),
  });
  const [result] = await searchWikimediaImages('卫星通信', fetchImpl);
  assert.equal(result.title.length, 200);
  assert.equal(result.copyrightStatus, 'OPEN_LICENSE');
  assert.equal(result.attribution, '作者');
});
