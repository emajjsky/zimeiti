import test from 'node:test';
import assert from 'node:assert/strict';
import rssService from '../server/services/rss.cjs';
import repository from '../server/services/intelligenceRepository.cjs';
import urlService from '../server/services/urlNormalizer.cjs';
import publicWeb from '../server/services/public-web.cjs';
import tavilyService from '../server/services/tavily.cjs';

const { rssEntryToItem } = rssService;
const { itemDto, normalizeSavedItem, normalizeSourceInput } = repository;
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

test('仓储 DTO 保留最新成功分析，供热点卡片恢复状态', () => {
  const item = itemDto({
    analysis_id: 'analysis-1', selected_platforms: ['WECHAT'], output_json: { timingWindow: 'TODAY' },
    overall_score: 86, decision: 'FOLLOW', analysis_model: 'qwen-plus', analysis_prompt_version: 2,
    analyzed_at: '2026-07-26T10:00:00.000Z',
  });
  assert.equal(item.analysis.id, 'analysis-1');
  assert.equal(item.analysis.decision, 'FOLLOW');
  assert.equal(item.analysis.overallScore, 86);
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

test('来源更新会规范化可编辑字段和刷新频率', () => {
  assert.equal(typeof normalizeSourceInput, 'function');
  assert.deepEqual(normalizeSourceInput({
    name: '  央视新闻  ',
    url: ' https://news.cctv.com/rss/index.xml ',
    category: ' 时政 ',
    includeKeywords: [' 政策 ', ''],
    excludeKeywords: [' 广告 '],
    language: 'ZH',
    enabled: false,
    refreshMinutes: 2,
    trust: '可信',
  }), {
    name: '央视新闻',
    url: 'https://news.cctv.com/rss/index.xml',
    category: '时政',
    includeKeywords: ['政策'],
    excludeKeywords: ['广告'],
    language: 'ZH',
    enabled: false,
    refreshMinutes: 5,
    trust: '可信',
  });
});

test('手工链接与搜索收藏统一规范化为可持久化情报', () => {
  const item = normalizeSavedItem({
    title: '  一条公开资讯  ',
    summary: ' 摘要 ',
    category: ' 科技 ',
    keywords: [' AI ', 'AI', ''],
    source: ' 示例站点 ',
    url: 'https://example.com/news?utm_source=test&id=1#top',
    language: 'zh',
    captureMethod: 'SEARCH',
    trust: '待核验',
    heat: 120,
    publishedAt: '2026-07-28T08:00:00.000Z',
  });

  assert.equal(item.title, '一条公开资讯');
  assert.equal(item.canonicalUrl, 'https://example.com/news?id=1');
  assert.deepEqual(item.keywords, ['AI']);
  assert.equal(item.captureMethod, 'SEARCH');
  assert.equal(item.heat, 100);
  assert.equal(item.publishedAt.toISOString(), '2026-07-28T08:00:00.000Z');
});
