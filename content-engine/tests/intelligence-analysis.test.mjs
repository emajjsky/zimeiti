import assert from 'node:assert/strict';
import test from 'node:test';

const analysis = await import('../server/services/intelligence-analysis.cjs');

const dimensions = {
  timeliness: { score: 80, reason: '仍处于讨论窗口。' },
  accountFit: { score: 90, reason: '符合账号题材。' },
  contentValue: { score: 70, reason: '有解释空间。' },
  spreadPotential: { score: 60, reason: '具备讨论点。' },
  feasibilityAndSafety: { score: 100, reason: '来源与制作条件完整。' },
};

test('按固定权重计算综合分并返回建议状态', () => {
  assert.equal(analysis.calculateOverallScore(dimensions), 80);
  assert.equal(analysis.decisionForScore(75), 'FOLLOW');
  assert.equal(analysis.decisionForScore(74), 'WATCH');
  assert.equal(analysis.decisionForScore(54), 'SKIP');
});

test('拒绝与用户勾选平台不一致的模型结果', () => {
  assert.throws(() => analysis.validateAnalysisOutput({
    decisionReason: '适合做深度解读。',
    timingWindow: 'TODAY',
    dimensions,
    angles: [],
    platforms: [{ platform: 'WECHAT', fitScore: 80, recommendedFormat: '事件解读', reason: '适合深度表达。' }],
    factsToVerify: [],
    risks: [],
  }, ['XIAOHONGSHU']), /平台/);
});

test('拒绝未知变量和超过上限的业务提示词', () => {
  assert.throws(() => analysis.validateTemplate('分析 {{unknown}}'), /未知变量/);
  assert.throws(() => analysis.validateTemplate('x'.repeat(12_001)), /12,000/);
});
