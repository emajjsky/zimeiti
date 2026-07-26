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

test('从模型返回的代码块中提取并校验结构化分析', () => {
  const payload = {
    decisionReason: '适合跟进。', timingWindow: 'TODAY', dimensions,
    angles: [], platforms: [{ platform: 'WECHAT', fitScore: 85, recommendedFormat: '深度解读', reason: '适合展开。' }], factsToVerify: [], risks: [],
  };
  const result = analysis.parseAnalysisContent(['```json', JSON.stringify(payload), '```'].join('\n'), ['WECHAT']);
  assert.equal(result.decisionReason, '适合跟进。');
  assert.equal(result.platforms[0].platform, 'WECHAT');
});

test('准备分析时要求题材、原文、平台和模型路由完整', () => {
  const input = {
    item: { id: 'item-1', title: '标题', summary: '摘要', source: '来源', url: 'https://example.com', category: 'AI', keywords: [], publishedAt: '2026-07-26T00:00:00.000Z' },
    profile: { primaryTopics: ['AI'], accountPositioning: '', targetAudience: '' },
    platforms: ['WECHAT'],
    template: { id: 'template-1', version: 1, body: '分析 {{title}}' },
    route: { provider: 'BAILIAN_CLI', model: 'qwen-plus' },
  };
  const prepared = analysis.prepareAnalysisInput(input);
  assert.equal(prepared.generalAudienceWarning, true);
  assert.deepEqual(prepared.input.selectedPlatforms, ['WECHAT']);
  assert.throws(() => analysis.prepareAnalysisInput({ ...input, platforms: [] }), /平台/);
});
