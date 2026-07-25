import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../shared/intelligence-sources.json', import.meta.url), 'utf8'));

test('自动来源 URL 唯一并覆盖至少八个题材', () => {
  const sources = catalog.automatic.flatMap((group) => group.sources);
  const urls = sources.map((source) => source.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(new Set(sources.map((source) => source.category)).size >= 8);
  assert.ok(sources.length >= 14);
});

test('自动来源均使用 HTTP(S) 且没有通用源关键词过滤', () => {
  const sources = catalog.automatic.flatMap((group) => group.sources);
  for (const source of sources) {
    assert.match(source.url, /^https?:\/\//);
    assert.equal(source.includeKeywords, undefined);
  }
});

test('国际财经自动源只包含已核验的官方 RSS', () => {
  const group = catalog.automatic.find((item) => item.id === 'international-finance');
  assert.deepEqual(group, {
    id: 'international-finance',
    label: '国际财经',
    sources: [
      { name: '美联储新闻稿', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: '财经', language: 'EN' },
      { name: '美国 SEC 新闻稿', url: 'https://www.sec.gov/news/pressreleases.rss', category: '财经', language: 'EN' },
      { name: '欧洲央行新闻稿', url: 'https://www.ecb.europa.eu/rss/press.html', category: '财经', language: 'EN' },
    ],
  });
});

test('辅助渠道包含七个合规入口及其能力', () => {
  assert.deepEqual(catalog.assisted.map((item) => item.id), ['WEIBO', 'TOUTIAO', 'CCTV', 'X', 'WECHAT', 'FINANCE_MEDIA', 'FINANCE_OFFICIAL']);
  for (const channel of catalog.assisted) {
    assert.ok(channel.domains.length > 0);
    assert.equal(channel.supportsClip, true);
    assert.equal(channel.supportsSearch, true);
  }
});

test('央视网渠道同时覆盖主站与新闻域名', () => {
  const cctv = catalog.assisted.find((item) => item.id === 'CCTV');
  assert.deepEqual(cctv.domains, ['cctv.com', 'news.cctv.com']);
});

test('财经媒体通过主动限定域名搜索接入', () => {
  const channel = catalog.assisted.find((item) => item.id === 'FINANCE_MEDIA');
  assert.deepEqual(channel, {
    id: 'FINANCE_MEDIA',
    label: '财经媒体',
    domains: ['finance.qq.com', 'new.qq.com', 'finance.sina.com.cn', '10jqka.com.cn', 'eastmoney.com', 'cls.cn'],
    defaultCategory: '财经',
    supportsClip: true,
    supportsSearch: true,
  });
});

test('官方财经公告通过主动限定域名搜索接入', () => {
  const channel = catalog.assisted.find((item) => item.id === 'FINANCE_OFFICIAL');
  assert.ok(channel, '缺少 FINANCE_OFFICIAL 渠道');
  assert.equal(channel.defaultCategory, '财经');
  assert.deepEqual(channel.domains, [
    'pbc.gov.cn', 'stats.gov.cn', 'csrc.gov.cn', 'safe.gov.cn',
    'sse.com.cn', 'szse.cn', 'bse.cn', 'hkex.com.hk', 'hkexnews.hk',
    'alibabagroup.com', 'tencent.com',
  ]);
});
