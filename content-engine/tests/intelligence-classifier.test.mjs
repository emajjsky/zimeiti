import test from 'node:test';
import assert from 'node:assert/strict';
import classifier from '../server/services/intelligenceClassifier.cjs';

const { classifyIntelligence } = classifier;

const cases = [
  ['AI', 'OpenAI 发布新一代生成式 AI 大模型'],
  ['科技', '国产半导体芯片制造取得新进展'],
  ['财经', '央行公布最新利率与债券政策'],
  ['体育', '中国男篮国际比赛首战获胜'],
  ['娱乐', '春节档电影票房刷新纪录'],
  ['社会', '多地启动极端天气应急救援'],
  ['国际', '联合国召开停火问题紧急会议'],
  ['时政', '国务院发布新的行政法规'],
  ['文化', '博物馆推出非遗与传统文化展览'],
  ['教育', '高校公布高考招生新方案'],
  ['健康', '医院发布心理健康与公共卫生报告'],
  ['汽车', '新能源车企公布智能驾驶新车型'],
];

for (const [category, title] of cases) {
  test(`按文章内容识别${category}`, () => {
    const result = classifyIntelligence({ title, fallbackCategory: '其它' });
    assert.equal(result.category, category);
    assert.ok(result.keywords.length > 0);
  });
}

test('按文章内容识别体育而不是来源默认题材', () => {
  const result = classifyIntelligence({
    title: '中国男篮国际比赛首战获胜',
    summary: '球队在篮球邀请赛中夺得开门红',
    fallbackCategory: '时政',
  });
  assert.equal(result.category, '体育');
  assert.ok(result.keywords.includes('篮球'));
});

test('标题命中权重高于摘要命中', () => {
  const result = classifyIntelligence({
    title: '足球联赛决赛落幕',
    summary: '活动得到学校与高校师生关注',
    fallbackCategory: '其它',
  });
  assert.equal(result.category, '体育');
});

test('英文 AI 只匹配独立单词', () => {
  assert.equal(classifyIntelligence({ title: 'AI agents arrive' }).category, 'AI');
  assert.deepEqual(classifyIntelligence({ title: 'The report said growth continued', fallbackCategory: '财经' }), {
    category: '财经',
    keywords: [],
  });
});

test('最多返回五个真实命中关键词', () => {
  const result = classifyIntelligence({
    title: 'OpenAI、Claude、Qwen、ChatGPT 与 Gemini 推动人工智能大模型发展',
  });
  assert.equal(result.category, 'AI');
  assert.equal(result.keywords.length, 5);
});

test('无规则命中时回退允许的来源默认题材', () => {
  assert.deepEqual(classifyIntelligence({ title: '今日简报', fallbackCategory: '社会' }), {
    category: '社会',
    keywords: [],
  });
});

test('非法回退题材归入其它', () => {
  assert.deepEqual(classifyIntelligence({ title: '今日简报', fallbackCategory: '未分类' }), {
    category: '其它',
    keywords: [],
  });
});
