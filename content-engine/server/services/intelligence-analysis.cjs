const { z } = require('zod');

const ANALYSIS_SCOPE = 'INTELLIGENCE_ANALYSIS';
const MAX_TEMPLATE_LENGTH = 12_000;
const templateVariables = ['title', 'summary', 'source', 'publishedAt', 'category', 'keywords', 'primaryTopics', 'accountPositioning', 'targetAudience', 'platforms'];
const weights = { timeliness: 20, accountFit: 25, contentValue: 25, spreadPotential: 15, feasibilityAndSafety: 15 };

const scoreReason = z.object({ score: z.number().int().min(0).max(100), reason: z.string().trim().min(1).max(240) });
const analysisSchema = z.object({
  decisionReason: z.string().trim().min(1).max(500),
  timingWindow: z.enum(['TODAY', 'THREE_DAYS', 'ONE_WEEK', 'EVERGREEN']),
  dimensions: z.object({
    timeliness: scoreReason,
    accountFit: scoreReason,
    contentValue: scoreReason,
    spreadPotential: scoreReason,
    feasibilityAndSafety: scoreReason,
  }),
  angles: z.array(z.object({ title: z.string().trim().min(1).max(120), coreViewpoint: z.string().trim().min(1).max(400), targetAudience: z.string().trim().min(1).max(160) })).max(3),
  platforms: z.array(z.object({ platform: z.enum(['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL']), fitScore: z.number().int().min(0).max(100), recommendedFormat: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(240) })),
  factsToVerify: z.array(z.string().trim().min(1).max(300)).max(5),
  risks: z.array(z.string().trim().min(1).max(300)).max(5),
});

function calculateOverallScore(dimensions) {
  return Math.round(Object.entries(weights).reduce((total, [key, weight]) => total + dimensions[key].score * weight / 100, 0));
}

function decisionForScore(score) {
  if (score >= 75) return 'FOLLOW';
  if (score >= 55) return 'WATCH';
  return 'SKIP';
}

function validateAnalysisOutput(value, selectedPlatforms) {
  const output = analysisSchema.parse(value);
  const expected = [...new Set(selectedPlatforms)].sort();
  const received = output.platforms.map((item) => item.platform).sort();
  if (expected.length !== received.length || expected.some((item, index) => item !== received[index])) throw new Error('模型返回的平台与本次勾选平台不一致。');
  return output;
}

function validateTemplate(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('提示词不能为空。');
  if (body.length > MAX_TEMPLATE_LENGTH) throw new Error(`提示词不能超过 ${MAX_TEMPLATE_LENGTH.toLocaleString('en-US')} 个字符。`);
  const variables = [...body.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]);
  const unknown = variables.find((name) => !templateVariables.includes(name));
  if (unknown) throw new Error(`存在未知变量：{{${unknown}}}。`);
  return body.trim();
}

function defaultTemplate() {
  return '请根据资讯内容、账号定位、目标受众和目标平台进行热点分析。重点说明时效、匹配度、内容价值、传播潜力和可执行风险；不确定的事实必须写入待核验项。';
}

function buildAnalysisPrompt({ template, item, profile, platforms }) {
  const businessTemplate = validateTemplate(template);
  const context = {
    title: item.title,
    summary: item.summary,
    source: item.source,
    publishedAt: item.publishedAt,
    category: item.category,
    keywords: item.keywords ?? [],
    primaryTopics: profile.primaryTopics ?? [],
    accountPositioning: profile.accountPositioning ?? '',
    targetAudience: profile.targetAudience ?? '',
    platforms,
  };
  const system = [
    '你是内容热点分析助手，只依据给定资讯和上下文提出建议，不得编造事实或来源。',
    '必须只返回 JSON，不要 Markdown 或解释文字。',
    'JSON 必须包含 decisionReason、timingWindow、dimensions、angles、platforms、factsToVerify、risks。',
    'dimensions 必须包含 timeliness、accountFit、contentValue、spreadPotential、feasibilityAndSafety，每项有 0-100 整数 score 和简短 reason。',
    'platforms 必须且只能覆盖本次选择的平台。angles 最多 3 条，factsToVerify 与 risks 各最多 5 条。',
  ].join('\n');
  return { system, message: JSON.stringify({ businessTemplate, context }) };
}

module.exports = { ANALYSIS_SCOPE, MAX_TEMPLATE_LENGTH, templateVariables, weights, calculateOverallScore, decisionForScore, validateAnalysisOutput, validateTemplate, defaultTemplate, buildAnalysisPrompt };
