const { z } = require('zod');

const SIMPLIFIED_RESEARCH_WORKFLOW_VERSION = 'project-research-workflow:1.0.0';
const WORKFLOW_MAX_AUTOMATIC_SOURCE_ACTIONS = 2;

const materialContextSchema = z.object({
  userContent: z.array(z.object({ id: z.string(), title: z.string(), body: z.string().nullable(), kind: z.string() })),
  creativeReferences: z.array(z.object({ id: z.string(), title: z.string(), role: z.string() })),
  visualAssets: z.array(z.object({ id: z.string(), title: z.string(), role: z.string() })),
  verificationCandidates: z.array(z.object({ id: z.string(), title: z.string(), role: z.string() })),
});

const researchResultSchema = z.object({
  summary: z.string(),
  researchBrief: z.object({
    subject: z.string(),
    directions: z.array(z.string()),
    keywords: z.array(z.string()),
    preferredChannels: z.array(z.string()),
    searchQueries: z.array(z.string()),
  }),
  facts: z.array(z.object({ claim: z.string(), status: z.enum(['VERIFIED', 'SINGLE_SOURCE']), explanation: z.string(), evidence: z.array(z.unknown()) })),
  cautions: z.array(z.object({ claim: z.string(), status: z.enum(['SINGLE_SOURCE', 'CONFLICTING', 'NEEDS_REVIEW']), explanation: z.string(), evidence: z.array(z.unknown()) })),
  angles: z.array(z.string()),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().nullable(), source: z.string() })),
  materialContext: materialContextSchema,
  process: z.object({
    phase: z.literal('COMPLETE'),
    sourceCount: z.number().int().nonnegative(),
    verificationStatus: z.enum(['COMPLETE', 'PARTIAL', 'FAILED']).optional(),
    verificationMessage: z.string().optional(),
  }),
});

function classifyMaterials(materials) {
  const output = { userContent: [], creativeReferences: [], visualAssets: [], verificationCandidates: [] };
  for (const material of Array.isArray(materials) ? materials : []) {
    if (!material?.id) continue;
    const title = String(material.title ?? '未命名资料');
    if (material.kind) {
      output.userContent.push({ id: material.id, title, body: material.body ?? null, kind: String(material.kind) });
      continue;
    }
    const role = String(material.role ?? 'FACT');
    if (role === 'VISUAL') output.visualAssets.push({ id: material.id, title, role });
    else if (role === 'FACT') output.verificationCandidates.push({ id: material.id, title, role });
    else output.creativeReferences.push({ id: material.id, title, role });
  }
  return output;
}

function workflowSourceActions(plan) {
  const actions = Array.isArray(plan?.nextActions) ? plan.nextActions : [];
  let automaticCount = 0;
  return actions.filter((action) => {
    if (!['SEARCH_WEB', 'READ_LINK'].includes(action?.action)) return true;
    automaticCount += 1;
    return automaticCount <= WORKFLOW_MAX_AUTOMATIC_SOURCE_ACTIONS;
  });
}

function workflowSourceActionsForProject(plan, project) {
  const actions = workflowSourceActions(plan);
  const origin = project?.sourceSnapshot?.intelligence;
  const url = typeof origin?.url === 'string' && /^https?:\/\//i.test(origin.url) ? origin.url : '';
  if (!url) return actions;
  if (actions.some((action) => action?.action === 'READ_LINK' && action.target === url)) return actions;
  return [{ action: 'READ_LINK', purpose: '读取项目原始资讯', target: url }, ...actions].slice(0, WORKFLOW_MAX_AUTOMATIC_SOURCE_ACTIONS);
}

function projectOriginalSource(project) {
  const origin = project?.sourceSnapshot?.intelligence;
  const url = typeof origin?.url === 'string' && /^https?:\/\//i.test(origin.url) ? origin.url : '';
  const title = String(origin?.title ?? '').trim();
  const summary = String(origin?.summary ?? '').trim();
  if (!url || !title || !summary) return null;
  return {
    title,
    url,
    source: String(origin?.source ?? new URL(url).hostname).trim(),
    summary,
    publishedAt: origin?.publishedAt ?? null,
    relevanceScore: 1,
    language: /[\u3400-\u9fff]/.test(`${title}${summary}`) ? 'ZH' : 'EN',
  };
}

function sourceMatchesProject(result, project) {
  const terms = projectSubjectTerms(project);
  if (!terms.length) return true;
  const haystack = `${String(result?.title ?? '')} ${String(result?.summary ?? '')}`.toLowerCase().replace(/\s+/g, '');
  return terms.some((term) => haystack.includes(term));
}

function projectSubjectTerms(project) {
  const title = String(project?.sourceSnapshot?.intelligence?.title ?? project?.title ?? '').trim();
  if (!title) return [];
  const leadingClause = title.split(/[：:，,。！？!?]/, 1)[0]
    .replace(/^(?:最新消息|最新|重磅|突发|今日|刚刚)[：:：\s]*/u, '')
    .trim();
  const entity = leadingClause.split(/(?:上市|发布|宣布|回应|推出|完成|获批|申请|融资|收购|计划|将于|成为|新进展)/u, 1)[0]
    .replace(/[《》“”"'‘’\s]/g, '')
    .toLowerCase();
  const latinTerms = (title.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter((term) => /[a-z]/.test(term));
  return [...new Set(entity.length >= 2 && entity.length <= 24 ? [entity] : latinTerms)];
}

function researchBriefForPlan(plan = {}) {
  const brief = plan.researchBrief ?? {};
  const questions = Array.isArray(plan.questions) ? plan.questions : [];
  const actions = Array.isArray(plan.nextActions) ? plan.nextActions : [];
  return {
    subject: String(brief.subject ?? plan.title ?? '当前内容选题').trim(),
    directions: (Array.isArray(brief.directions) ? brief.directions : questions.map((item) => item?.question)).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5),
    keywords: (Array.isArray(brief.keywords) ? brief.keywords : []).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    preferredChannels: (Array.isArray(brief.preferredChannels) ? brief.preferredChannels : questions.flatMap((item) => item?.preferredSources ?? [])).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6),
    searchQueries: (Array.isArray(brief.searchQueries) ? brief.searchQueries : actions.filter((item) => item?.action === 'SEARCH_WEB').map((item) => item.target)).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5),
  };
}

function buildResearchResult({ plan = {}, sources = [], verification = null, materials = [], allowSingleSource = false, verificationStatus, verificationMessage }) {
  const claims = Array.isArray(verification?.claims) ? verification.claims : (Array.isArray(plan.claims) ? plan.claims.map((item) => ({ claim: item.claim, status: 'NEEDS_REVIEW', explanation: '尚未完成事实核验。', evidence: [] })) : []);
  const usableStatuses = allowSingleSource ? new Set(['VERIFIED', 'SINGLE_SOURCE']) : new Set(['VERIFIED']);
  const facts = claims.filter((item) => usableStatuses.has(item.status));
  const cautions = claims.filter((item) => !usableStatuses.has(item.status));
  const capturedSources = (Array.isArray(sources) ? sources : []).filter((item) => item?.status === 'CAPTURED');

  return researchResultSchema.parse({
    summary: String(verification?.summary ?? plan.summary ?? '研究完成，等待采用。'),
    researchBrief: researchBriefForPlan(plan),
    facts: facts.map((item) => ({ claim: item.claim, status: item.status, explanation: item.explanation, evidence: item.evidence ?? [] })),
    cautions: cautions.map((item) => ({ claim: item.claim, status: item.status ?? 'NEEDS_REVIEW', explanation: item.explanation ?? '尚未确认。', evidence: item.evidence ?? [] })),
    angles: Array.isArray(plan.angles) ? plan.angles.filter((item) => typeof item === 'string') : [],
    sources: capturedSources.map((item) => ({ id: String(item.id), title: String(item.title ?? '未命名来源'), url: item.url ?? null, source: String(item.source ?? '网页来源') })),
    materialContext: classifyMaterials(materials),
    process: {
      phase: 'COMPLETE',
      sourceCount: capturedSources.length,
      ...(verificationStatus ? { verificationStatus } : {}),
      ...(verificationMessage ? { verificationMessage } : {}),
    },
  });
}

module.exports = { SIMPLIFIED_RESEARCH_WORKFLOW_VERSION, WORKFLOW_MAX_AUTOMATIC_SOURCE_ACTIONS, researchResultSchema, classifyMaterials, workflowSourceActions, workflowSourceActionsForProject, projectOriginalSource, sourceMatchesProject, researchBriefForPlan, buildResearchResult };
