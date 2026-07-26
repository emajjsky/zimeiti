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

function parseAnalysisContent(content, selectedPlatforms) {
  if (typeof content !== 'string') throw new Error('模型没有返回分析内容。');
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value;
  try { value = JSON.parse(normalized); }
  catch { throw new Error('模型返回的分析格式无效。'); }
  return validateAnalysisOutput(value, selectedPlatforms);
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
    `timingWindow 只能是 TODAY|THREE_DAYS|ONE_WEEK|EVERGREEN 之一。platforms 必须且只能覆盖本次选择的平台。angles 最多 3 条，factsToVerify 与 risks 各最多 5 条。`,
    '严格按以下 JSON 形状返回。angles 和 platforms 中的每一项必须是对象，不能是字符串：',
    '{"decisionReason":"一句话判断","timingWindow":"TODAY","dimensions":{"timeliness":{"score":0,"reason":"原因"},"accountFit":{"score":0,"reason":"原因"},"contentValue":{"score":0,"reason":"原因"},"spreadPotential":{"score":0,"reason":"原因"},"feasibilityAndSafety":{"score":0,"reason":"原因"}},"angles":[{"title":"角度标题","coreViewpoint":"核心观点","targetAudience":"目标受众"}],"platforms":[{"platform":"WECHAT","fitScore":0,"recommendedFormat":"建议形式","reason":"适配原因"}],"factsToVerify":["待核验事实"],"risks":["风险提示"]}',
  ].join('\n');
  return { system, message: JSON.stringify({ businessTemplate, context }) };
}

function buildAnalysisRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构校验。请只返回修正后的 JSON，不要解释。校验错误如下：${validationError}`;
}

function prepareAnalysisInput({ item, profile, platforms, template, route }) {
  if (!item?.title?.trim() || !item?.summary?.trim() || !item?.source?.trim() || !item?.url?.trim()) throw new Error('资讯缺少标题、摘要、来源或原文链接，暂不能分析。');
  const selectedPlatforms = [...new Set(platforms ?? [])];
  if (!selectedPlatforms.length || selectedPlatforms.some((value) => !['WECHAT', 'XIAOHONGSHU', 'VIDEO_CHANNEL'].includes(value))) throw new Error('请至少选择一个有效的平台。');
  if (!(profile?.primaryTopics ?? []).map((value) => String(value).trim()).filter(Boolean).length) throw new Error('请先在工作空间设置至少一个默认题材。');
  if (!route?.provider || !route?.model?.trim()) throw new Error('请先为热点分析配置可用文本模型。');
  if (!template?.id || !template?.version || !template?.body) throw new Error('热点分析提示词模板不可用。');
  return {
    sourceSnapshot: { item, profile },
    input: { selectedPlatforms, template: { id: template.id, version: template.version, body: template.body }, route: { provider: route.provider, connectionId: route.connectionId ?? null, model: route.model } },
    generalAudienceWarning: !String(profile.accountPositioning ?? '').trim() || !String(profile.targetAudience ?? '').trim(),
  };
}

function createTemplateStore({ query }) {
  async function latest(workspaceId, scope = ANALYSIS_SCOPE) {
    const result = await query('SELECT id, workspace_id, scope, version, body, source, created_at FROM prompt_template_versions WHERE workspace_id = $1 AND scope = $2 ORDER BY version DESC LIMIT 1', [workspaceId, scope]);
    return result.rows[0] ?? null;
  }

  async function insert(workspaceId, scope, body, source) {
    const current = await latest(workspaceId, scope);
    const version = (current?.version ?? 0) + 1;
    const result = await query('INSERT INTO prompt_template_versions (workspace_id, scope, version, body, source) VALUES ($1, $2, $3, $4, $5) RETURNING id, workspace_id, scope, version, body, source, created_at', [workspaceId, scope, version, body, source]);
    return result.rows[0];
  }

  return {
    async get(workspaceId, scope = ANALYSIS_SCOPE) {
      return (await latest(workspaceId, scope)) ?? insert(workspaceId, scope, defaultTemplate(), 'DEFAULT');
    },
    async save(workspaceId, scope, body) {
      return insert(workspaceId, scope, validateTemplate(body), 'CUSTOM');
    },
    async reset(workspaceId, scope = ANALYSIS_SCOPE) {
      return insert(workspaceId, scope, defaultTemplate(), 'DEFAULT');
    },
  };
}

module.exports = { ANALYSIS_SCOPE, MAX_TEMPLATE_LENGTH, templateVariables, weights, calculateOverallScore, decisionForScore, validateAnalysisOutput, parseAnalysisContent, validateTemplate, defaultTemplate, buildAnalysisPrompt, buildAnalysisRepairPrompt, prepareAnalysisInput, createTemplateStore };
