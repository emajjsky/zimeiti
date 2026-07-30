const { z } = require('zod');

const PROJECT_RESEARCH_ACTION_VERSION = 'project-research-plan:1.0.0';
const PROJECT_RESEARCH_SCOPE = 'AGENT_PLANNER';

const researchPlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(800),
  questions: z.array(z.object({
    question: z.string().trim().min(1).max(300),
    why: z.string().trim().min(1).max(300),
    preferredSources: z.array(z.string().trim().min(1).max(160)).min(1).max(5),
  })).min(1).max(8),
  claims: z.array(z.object({
    claim: z.string().trim().min(1).max(300),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    reason: z.string().trim().min(1).max(300),
  })).max(10),
  nextActions: z.array(z.object({
    action: z.enum(['SEARCH_WEB', 'READ_LINK', 'ASK_USER']),
    purpose: z.string().trim().min(1).max(300),
    target: z.string().trim().min(1).max(500),
  })).min(1).max(8),
});

function parseResearchPlan(content) {
  if (typeof content !== 'string') throw new Error('核心 Agent 没有返回研究计划。');
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value;
  try { value = JSON.parse(normalized); }
  catch { throw new Error('核心 Agent 返回的研究计划不是有效 JSON。'); }
  return researchPlanSchema.parse(value);
}

function buildResearchPlanPrompt({ project, brief, request, materials }) {
  const example = {
    title: '本次研究计划',
    summary: '说明这次研究要解决的问题及边界',
    questions: [{ question: '需要回答的问题', why: '为什么需要核验', preferredSources: ['政府或机构官网'] }],
    claims: [{ claim: '需要核验的事实主张', priority: 'HIGH', reason: '对核心结论影响较大' }],
    nextActions: [{ action: 'SEARCH_WEB', purpose: '查找第一方证据', target: '明确的检索目标或关键词' }],
  };
  const system = [
    '你是内容项目的研究编辑，只生成研究计划，不直接写文章，不宣称已经完成网页检索。',
    '没有资料时，必须根据已确认的项目规划提出待回答问题、建议来源和后续动作，不能把常识或推测写成已核验结论。',
    '用户资料可能包含事实、观点、结构、语言、钩子、视觉或反例。必须按 role 使用，不能把观点和风格参考当成已验证事实。',
    '文件没有 extractedText 时只能依据文件名、类型和备注规划后续处理，不得假装读过文件内容。',
    '优先建议第一方、政府、机构、论文、公司公告或原始数据来源。遇到登录、验证码、付费墙或权限不明的来源，应改为 ASK_USER。',
    '只返回 JSON，不要 Markdown、代码围栏或解释文字。',
    `严格按以下形状返回：${JSON.stringify(example)}`,
  ].join('\n');
  const message = JSON.stringify({
    request,
    project: {
      title: project.title,
      coreViewpoint: project.coreViewpoint,
      factChecks: project.factChecks ?? [],
      originalSource: project.sourceSnapshot?.intelligence ? {
        title: project.sourceSnapshot.intelligence.title ?? '',
        source: project.sourceSnapshot.intelligence.source ?? '',
        url: project.sourceSnapshot.intelligence.url ?? null,
        summary: project.sourceSnapshot.intelligence.summary ?? '',
      } : null,
    },
    writingBrief: brief ? {
      objective: brief.objective,
      targetAudience: brief.targetAudience,
      coreMessage: brief.coreMessage,
      sourceRequirements: brief.sourceRequirements,
      notes: brief.notes,
    } : null,
    materials,
  });
  return { system, message };
}

function buildResearchPlanRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构校验。请只返回修正后的 JSON。校验错误：${validationError}`;
}

function researchRunView(row, materialIds = { inputIds: [], referenceIds: [] }) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    request: row.source_snapshot_json?.request ?? '',
    model: row.model,
    actionVersion: row.action_version_id,
    materialIds,
    materialCount: materialIds.inputIds.length + materialIds.referenceIds.length,
    error: row.error ?? undefined,
    jobId: row.job_id ?? undefined,
    createdAt: row.created_at,
  };
}

function researchPlanView(row) {
  if (!row) return null;
  return { id: row.id, runId: row.generation_run_id, ...row.output_json, createdAt: row.created_at };
}

module.exports = {
  PROJECT_RESEARCH_ACTION_VERSION,
  PROJECT_RESEARCH_SCOPE,
  researchPlanSchema,
  parseResearchPlan,
  buildResearchPlanPrompt,
  buildResearchPlanRepairPrompt,
  researchRunView,
  researchPlanView,
};
