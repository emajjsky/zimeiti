import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildTitleRecommendationPrompt, parseTitleRecommendations } = require('../server/services/title-recommendations.cjs');

test('标题建议读取完整成稿和已选媒体线索', () => {
  const prompt = buildTitleRecommendationPrompt({
    draft: { title: '原标题', body: '这是已经完成的公众号正文。' },
    assets: [{ kind: 'IMAGE', title: '正文配图' }],
  });
  assert.match(prompt.message, /这是已经完成的公众号正文/);
  assert.match(prompt.message, /正文配图/);
  assert.match(prompt.system, /忠实于正文/);
});

test('标题建议只接受三到六个结构化候选', () => {
  const valid = { recommendations: [
    { title: '第一个准确具体的标题', angle: '从事实切入' },
    { title: '第二个准确具体的标题', angle: '从用户价值切入' },
    { title: '第三个准确具体的标题', angle: '从变化切入' },
  ] };
  assert.equal(parseTitleRecommendations(JSON.stringify(valid)).length, 3);
  assert.throws(() => parseTitleRecommendations('{"recommendations":[]}'));
  assert.throws(() => parseTitleRecommendations('普通文本'));
});
