import test from 'node:test';
import assert from 'node:assert/strict';
import { filterIntelligenceItems, matchesIntelligenceQuery } from '../shared/intelligence-filters.mjs';

const item = {
  title: '央行发布季度政策报告',
  summary: '市场关注后续资金价格变化',
  source: '中国人民银行',
  keywords: ['利率', '债券'],
};

test('搜索框匹配持久化关键词', () => {
  assert.equal(matchesIntelligenceQuery(item, '债券'), true);
});

test('搜索框继续匹配标题摘要和来源', () => {
  assert.equal(matchesIntelligenceQuery(item, '央行'), true);
  assert.equal(matchesIntelligenceQuery(item, '资金价格'), true);
  assert.equal(matchesIntelligenceQuery(item, '中国人民银行'), true);
});

test('空查询匹配全部且无关查询不匹配', () => {
  assert.equal(matchesIntelligenceQuery(item, '  '), true);
  assert.equal(matchesIntelligenceQuery(item, '篮球'), false);
});

test('选择单一来源后只返回该来源的情报', () => {
  const intelligence = [
    { id: 'cn', title: '中国财经新闻', summary: '国内市场动态', source: '中国新闻网', category: '财经', language: 'zh', publishedAt: '2026-07-25T10:00:00.000Z' },
    { id: 'sec', title: 'SEC News', summary: 'US market update', source: '美国 SEC 新闻稿', category: '财经', language: 'en', publishedAt: '2026-07-23T10:00:00.000Z' },
  ];

  const visible = filterIntelligenceItems(intelligence, {
    source: '美国 SEC 新闻稿',
    category: 'ALL',
    language: 'ALL',
    timeRange: 'MONTH',
    query: '',
  }, Date.parse('2026-07-25T12:00:00.000Z'));

  assert.deepEqual(visible.map((signal) => signal.id), ['sec']);
});

test('来源筛选与卡片统一使用展示来源', () => {
  const intelligence = [
    { id: 'search', title: '检索结果', summary: '公开网页', source: '央视网', captureMethod: 'SEARCH', category: '时政', language: 'zh', publishedAt: '2026-07-25T10:00:00.000Z' },
    { id: 'rss', title: 'RSS 结果', summary: '订阅内容', source: '央视网', captureMethod: 'RSS', category: '时政', language: 'zh', publishedAt: '2026-07-25T10:00:00.000Z' },
  ];

  const visible = filterIntelligenceItems(intelligence, {
    source: '网页检索',
    category: 'ALL',
    language: 'ALL',
    timeRange: 'MONTH',
    query: '',
  }, Date.parse('2026-07-25T12:00:00.000Z'));

  assert.deepEqual(visible.map((signal) => signal.id), ['search']);
});
