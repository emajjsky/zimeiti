const { z } = require('zod');

const SOURCE_VERIFICATION_SCOPE = 'SOURCE_VERIFICATION';
const SOURCE_VERIFICATION_VERSION = 'source-verification:1.0.0';

const evidenceSchema = z.object({
  sourceId: z.string().uuid().or(z.string().regex(/^source-[\w-]+$/)),
  relation: z.enum(['SUPPORTS', 'CONFLICTS']),
  quote: z.string().trim().min(1).max(500),
  note: z.string().trim().min(1).max(300),
});

const verificationSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  claims: z.array(z.object({
    claim: z.string().trim().min(1).max(300),
    status: z.enum(['VERIFIED', 'SINGLE_SOURCE', 'CONFLICTING', 'NEEDS_REVIEW']),
    explanation: z.string().trim().min(1).max(500),
    evidence: z.array(evidenceSchema).max(12),
  })).min(1).max(12),
});

function parseSourceVerification(content, context) {
  if (typeof content !== 'string') throw new Error('事实核验模型没有返回内容。');
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value;
  try { value = JSON.parse(normalized); }
  catch { throw new Error('事实核验模型返回的不是有效 JSON。'); }
  const output = verificationSchema.parse(value);
  const claims = new Map((context?.claims ?? []).map((item) => [item.claim, item]));
  const sources = new Map((context?.sources ?? []).map((item) => [item.id, item]));
  const outputClaimNames = new Set(output.claims.map((item) => item.claim));
  if (output.claims.length !== claims.size || outputClaimNames.size !== claims.size || output.claims.some((item) => !claims.has(item.claim))) throw new Error('核验结果必须逐条对应研究计划中的主张。');
  return {
    ...output,
    claims: output.claims.map((claim) => {
      const evidence = claim.evidence.map((item) => {
        const source = sources.get(item.sourceId);
        if (!source) throw new Error(`核验结果引用了未选来源：${item.sourceId}。`);
        if (!includesQuote(source.summary, item.quote)) throw new Error(`引用无法在来源摘要中定位：${item.sourceId}。`);
        return { ...item, title: source.title, url: source.url, source: source.source };
      });
      const supportingSources = new Set(evidence.filter((item) => item.relation === 'SUPPORTS').map((item) => item.sourceId));
      const conflictingSources = new Set(evidence.filter((item) => item.relation === 'CONFLICTS').map((item) => item.sourceId));
      if (claim.status === 'VERIFIED' && supportingSources.size < 2) throw new Error('VERIFIED 状态至少两个独立支持来源。');
      if (claim.status === 'VERIFIED' && conflictingSources.size) throw new Error('VERIFIED 状态不能包含冲突证据。');
      if (claim.status === 'SINGLE_SOURCE' && (supportingSources.size !== 1 || conflictingSources.size)) throw new Error('SINGLE_SOURCE 状态必须且只能包含一个支持来源。');
      if (claim.status === 'CONFLICTING' && (!supportingSources.size || !conflictingSources.size)) throw new Error('CONFLICTING 状态必须同时包含支持和冲突证据。');
      return { ...claim, evidence };
    }),
  };
}

function includesQuote(summary, quote) {
  const normalize = (value) => String(value ?? '').replace(/\s+/g, '').replace(/[，。；：、“”‘’！？,.!?;:'"()（）]/g, '');
  const normalizedQuote = normalize(quote);
  return normalizedQuote.length > 0 && normalize(summary).includes(normalizedQuote);
}

function defaultSourceVerificationTemplate() {
  return '逐条核对主张是否得到来源直接支持，重点检查数字、日期、适用范围、前提条件和来源之间的冲突。证据不足时保留待复核状态。';
}

function validateSourceVerificationTemplate(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('事实核验提示词不能为空。');
  if (value.length > 12_000) throw new Error('事实核验提示词不能超过 12,000 个字符。');
  return value.trim();
}

function buildSourceVerificationPrompt(context) {
  const example = {
    summary: '本次核验结论摘要',
    claims: [{
      claim: '必须与输入主张完全一致',
      status: 'NEEDS_REVIEW',
      explanation: '解释证据是否充分以及冲突点',
      evidence: [{ sourceId: '来源 ID', relation: 'SUPPORTS', quote: '来源摘要中的连续原文', note: '该证据如何支持或冲突' }],
    }],
  };
  const system = [
    '你是内容项目的事实核验编辑，只核验输入中的主张，不写文章。',
    `本次核验侧重点：${validateSourceVerificationTemplate(context.template ?? defaultSourceVerificationTemplate())}`,
    '只能引用本次已选来源，不能使用常识、记忆或未提供的网页内容。',
    'quote 必须逐字摘自对应来源 summary，sourceId 必须使用输入中的 ID。',
    'VERIFIED 需要至少两个独立支持来源；只有一个支持来源时必须为 SINGLE_SOURCE。',
    '支持与冲突证据同时存在时使用 CONFLICTING；证据不足或无法判断时使用 NEEDS_REVIEW。',
    '只返回 JSON，不要返回 Markdown 或解释文字。',
    `严格按以下形状返回：${JSON.stringify(example)}`,
  ].join('\n');
  return { system, message: JSON.stringify({ claims: context.claims, sources: context.sources }) };
}

function buildSourceVerificationRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构或证据校验。只返回修正后的 JSON。校验错误：${validationError}`;
}

function mergeSourceVerificationResults({ claims = [], results = [] }) {
  const usableResults = (Array.isArray(results) ? results : []).filter((item) => item && Array.isArray(item.claims));
  const mergedClaims = (Array.isArray(claims) ? claims : []).map((plannedClaim) => {
    const claim = String(plannedClaim?.claim ?? '').trim();
    const matches = usableResults.flatMap((result) => result.claims.filter((item) => item.claim === claim));
    const evidenceByKey = new Map();
    for (const item of matches.flatMap((match) => match.evidence ?? [])) {
      const key = `${item.sourceId}:${item.relation}:${item.quote}`;
      if (!evidenceByKey.has(key)) evidenceByKey.set(key, item);
    }
    const evidence = [...evidenceByKey.values()];
    const supports = new Set(evidence.filter((item) => item.relation === 'SUPPORTS').map((item) => item.sourceId));
    const conflicts = new Set(evidence.filter((item) => item.relation === 'CONFLICTS').map((item) => item.sourceId));
    let status = 'NEEDS_REVIEW';
    let explanation = matches.find((item) => item.explanation)?.explanation ?? '现有来源未提供足够的直接证据。';
    if (supports.size && conflicts.size) {
      status = 'CONFLICTING';
      explanation = '不同来源对这项主张存在冲突，需要人工判断。';
    } else if (supports.size >= 2) {
      status = 'VERIFIED';
      explanation = `${supports.size} 个独立来源直接支持这项主张。`;
    } else if (supports.size === 1) {
      status = 'SINGLE_SOURCE';
      explanation = '1 个来源直接支持，使用时需要明确注明来源。';
    }
    return { claim, status, explanation, evidence };
  });
  const verified = mergedClaims.filter((item) => item.status === 'VERIFIED').length;
  const singleSource = mergedClaims.filter((item) => item.status === 'SINGLE_SOURCE').length;
  const unresolved = mergedClaims.length - verified - singleSource;
  return {
    summary: `逐来源核验完成：${verified} 条获得多源支持，${singleSource} 条获得单一来源支持，${unresolved} 条仍需补充核验。`,
    claims: mergedClaims,
  };
}

module.exports = {
  SOURCE_VERIFICATION_SCOPE,
  SOURCE_VERIFICATION_VERSION,
  buildSourceVerificationPrompt,
  buildSourceVerificationRepairPrompt,
  defaultSourceVerificationTemplate,
  mergeSourceVerificationResults,
  parseSourceVerification,
  validateSourceVerificationTemplate,
  verificationSchema,
};
