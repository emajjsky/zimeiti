import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesIntelligenceQuery } from '../shared/intelligence-filters.mjs';

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
