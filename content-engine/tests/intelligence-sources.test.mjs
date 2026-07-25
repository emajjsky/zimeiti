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

test('辅助渠道包含五个合规入口及其能力', () => {
  assert.deepEqual(catalog.assisted.map((item) => item.id), ['WEIBO', 'TOUTIAO', 'CCTV', 'X', 'WECHAT']);
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
