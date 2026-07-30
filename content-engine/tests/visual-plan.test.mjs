import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisualPlan, mergeVisualPlan } from '../src/domain/visual-plan.mjs';

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

test('旧项目素材会自动映射到新配图方案', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const merged = mergeVisualPlan(generated, null, ['body-id', 'cover-id'], 'cover-id');
  assert.equal(merged[0].assetReferenceId, 'cover-id');
  assert.equal(merged[1].assetReferenceId, 'body-id');
});
