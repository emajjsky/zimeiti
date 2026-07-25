import test from 'node:test';
import assert from 'node:assert/strict';
import rssService from '../server/services/rss.cjs';
import repository from '../server/services/intelligenceRepository.cjs';
import urlService from '../server/services/urlNormalizer.cjs';
import publicWeb from '../server/services/public-web.cjs';
import tavilyService from '../server/services/tavily.cjs';

const { rssEntryToItem } = rssService;
const { itemDto } = repository;
const { normalizeCanonicalUrl } = urlService;
const { buildPublicPreview } = publicWeb;
const { tavilyResultToItem } = tavilyService;

test('RSS 条目按文章内容分类并返回命中关键词', () => {
  const item = rssEntryToItem(
    { id: 'source-1', name: '综合新闻', category: '时政', trust: '待核验', language: 'ZH' },
    { title: '足球联赛决赛落幕', description: '冠军球队完成逆转', link: 'https://example.com/sports' },
    0,
    1_700_000_000_000,
  );
  assert.equal(item.category, '体育');
  assert.ok(item.keywords.includes('足球'));
});

test('仓储 DTO 返回持久化关键词', () => {
  assert.deepEqual(itemDto({ matched_keywords: ['芯片'] }).keywords, ['芯片']);
  assert.deepEqual(itemDto({}).keywords, []);
});

test('规范化 URL 去除追踪参数、片段并稳定排序查询参数', () => {
  assert.equal(
    normalizeCanonicalUrl('HTTPS://Example.COM:443/a?utm_source=x&b=2&a=1&spm=abc#section'),
    'https://example.com/a?a=1&b=2',
  );
});

test('规范化 URL 保留有意义的重复参数并排序', () => {
  assert.equal(
    normalizeCanonicalUrl('https://example.com/search?tag=b&tag=a&q=AI'),
    'https://example.com/search?q=AI&tag=a&tag=b',
  );
  assert.equal(normalizeCanonicalUrl('not-a-url'), null);
});

test('公开链接预览返回文章分类和关键词', () => {
  const preview = buildPublicPreview(new URL('https://news.cctv.com/a'), '全运会篮球冠军产生', '决赛昨晚落幕');
  assert.equal(preview.category, '体育');
  assert.ok(preview.keywords.includes('篮球'));
});

test('Tavily 结果按内容分类而不是固定使用输入题材', () => {
  const item = tavilyResultToItem(
    { url: 'https://example.com/finance', title: '央行公布最新利率政策', content: '债券市场作出回应', published_date: '2026-07-25T08:00:00Z' },
    { category: '科技' },
    'search-1',
  );
  assert.equal(item.category, '财经');
  assert.ok(item.keywords.includes('央行'));
});
