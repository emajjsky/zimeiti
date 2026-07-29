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
  facts: z.array(z.object({ claim: z.string(), status: z.enum(['VERIFIED', 'SINGLE_SOURCE']), explanation: z.string(), evidence: z.array(z.unknown()) })),
  cautions: z.array(z.object({ claim: z.string(), status: z.enum(['SINGLE_SOURCE', 'CONFLICTING', 'NEEDS_REVIEW']), explanation: z.string(), evidence: z.array(z.unknown()) })),
  angles: z.array(z.string()),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().nullable(), source: z.string() })),
  materialContext: materialContextSchema,
  process: z.object({ phase: z.literal('COMPLETE'), sourceCount: z.number().int().nonnegative() }),
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

function buildResearchResult({ plan = {}, sources = [], verification = null, materials = [], allowSingleSource = false }) {
  const claims = Array.isArray(verification?.claims) ? verification.claims : (Array.isArray(plan.claims) ? plan.claims.map((item) => ({ claim: item.claim, status: 'NEEDS_REVIEW', explanation: '尚未完成事实核验。', evidence: [] })) : []);
  const usableStatuses = allowSingleSource ? new Set(['VERIFIED', 'SINGLE_SOURCE']) : new Set(['VERIFIED']);
  const facts = claims.filter((item) => usableStatuses.has(item.status));
  const cautions = claims.filter((item) => !usableStatuses.has(item.status));
  const capturedSources = (Array.isArray(sources) ? sources : []).filter((item) => item?.status === 'CAPTURED');

  return researchResultSchema.parse({
    summary: String(verification?.summary ?? plan.summary ?? '研究完成，等待采用。'),
    facts: facts.map((item) => ({ claim: item.claim, status: item.status, explanation: item.explanation, evidence: item.evidence ?? [] })),
    cautions: cautions.map((item) => ({ claim: item.claim, status: item.status ?? 'NEEDS_REVIEW', explanation: item.explanation ?? '尚未确认。', evidence: item.evidence ?? [] })),
    angles: Array.isArray(plan.angles) ? plan.angles.filter((item) => typeof item === 'string') : [],
    sources: capturedSources.map((item) => ({ id: String(item.id), title: String(item.title ?? '未命名来源'), url: item.url ?? null, source: String(item.source ?? '网页来源') })),
    materialContext: classifyMaterials(materials),
    process: { phase: 'COMPLETE', sourceCount: capturedSources.length },
  });
}

module.exports = { SIMPLIFIED_RESEARCH_WORKFLOW_VERSION, WORKFLOW_MAX_AUTOMATIC_SOURCE_ACTIONS, researchResultSchema, classifyMaterials, workflowSourceActions, buildResearchResult };
