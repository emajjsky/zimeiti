import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisualPlan, mergeVisualPlan, VISUAL_PLAN_VERSION } from '../src/domain/visual-plan.mjs';

const article = {
  title: '我国成功发射天链三号01星',
  category: '科技',
  coreMessage: '新一代中继卫星将提升航天器测控与数据传输能力',
  body: '天链三号01星由运载火箭送入预定轨道。\n\n中继卫星承担天地通信与数据中继任务。\n\n本次任务还需要关注公开技术资料与后续应用。',
};

test('公众号配图方案自动包含封面、正文位置、搜索词和生图提示词', () => {
  const plan = buildVisualPlan(article, 'WECHAT');
  assert.ok(plan.length >= 3 && plan.length <= 5);
  assert.equal(plan[0].role, 'COVER');
  assert.equal(plan[0].searchQueries[0], '天链三号01星 发射');
  assert.ok(plan[0].searchQueries.every((query) => query.length <= 60 && !query.includes('新一代中继卫星将提升航天')));
  assert.match(plan[0].prompt, /公众号/);
  assert.match(plan[1].placement, /正文/);
  assert.ok(plan.every((item) => item.searchQueries.length >= 2 && item.prompt.length > 30 && item.size));
  assert.ok(plan.every((item) => item.visualType && item.focus && Array.isArray(item.avoidConcepts)));
  const firstQueries = plan.map((item) => item.searchQueries[0]);
  assert.equal(new Set(firstQueries).size, firstQueries.length);
  assert.notEqual(plan[1].searchQueries[0], plan[0].searchQueries[0]);
  assert.match(plan.slice(1).map((item) => item.searchQueries.join(' ')).join(' '), /中继卫星|数据传输|测控覆盖|卫星组网/);
});

test('渠道长标题不会把钩子句带进配图搜索词', () => {
  const plan = buildVisualPlan({
    ...article,
    title: '天链三号01星发射成功：我是二师兄，带你读懂这颗“太空通信卫星”',
  }, 'WECHAT');
  assert.equal(plan[0].searchQueries[0], '天链三号01星 发射');
  assert.ok(plan.every((item) => item.searchQueries.every((query) => !query.includes('我是二师兄') && !query.includes('带你读懂'))));
});

test('不同平台采用不同的默认配图数量与比例', () => {
  const xiaohongshu = buildVisualPlan(article, 'XIAOHONGSHU');
  const weibo = buildVisualPlan(article, 'WEIBO');
  assert.ok(xiaohongshu.length >= 6 && xiaohongshu.length <= 8);
  assert.ok(xiaohongshu.every((item) => item.size === '3:4'));
  assert.equal(weibo.length, 1);
  assert.equal(weibo[0].role, 'MAIN');
  assert.equal(weibo[0].size, '1:1');
});

test('没有旧方案时只迁移历史封面，正文素材留在项目素材库', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const merged = mergeVisualPlan(generated, null, ['body-id', 'cover-id'], 'cover-id');
  assert.equal(merged[0].assetReferenceId, 'cover-id');
  assert.ok(merged.slice(1).every((item) => item.assetReferenceId === null));
});

test('旧版方案自动升级搜索词并清空正文错误绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const oldPlan = generated.map((item, index) => ({
    ...item,
    searchQueries: ['天链三号01星 发射'],
    assetReferenceId: index === 0 ? 'cover-id' : `body-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, [], null, VISUAL_PLAN_VERSION - 1);
  assert.equal(upgraded[0].assetReferenceId, 'cover-id');
  assert.ok(upgraded.slice(1).every((item) => item.assetReferenceId === null));
  assert.equal(new Set(upgraded.map((item) => item.searchQueries[0])).size, upgraded.length);
});

test('当前版本方案保留用户已经编辑的内容和绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const persisted = generated.map((item, index) => ({ ...item, purpose: `自定义 ${index}`, assetReferenceId: index ? `body-${index}` : 'cover-id' }));
  assert.deepEqual(mergeVisualPlan(generated, persisted, [], null, VISUAL_PLAN_VERSION), persisted);
});
