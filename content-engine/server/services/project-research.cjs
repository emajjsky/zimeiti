const { z } = require('zod');

const PROJECT_RESEARCH_ACTION_VERSION = 'project-research-plan:1.0.0';
const PROJECT_RESEARCH_SCOPE = 'AGENT_PLANNER';

const researchBriefSchema = z.object({
  subject: z.string().trim().min(2).max(160),
  directions: z.array(z.string().trim().min(2).max(200)).min(2).max(5),
  keywords: z.array(z.string().trim().min(1).max(80)).min(3).max(12),
  preferredChannels: z.array(z.string().trim().min(2).max(120)).min(2).max(6),
  searchQueries: z.array(z.string().trim().min(2).max(160)).min(1).max(5),
});

const researchPlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(800),
  researchBrief: researchBriefSchema,
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

const RESEARCH_PLAN_TOOL_NAME = 'submit_research_plan';
const researchPlanTool = {
  type: 'function',
  function: {
    name: RESEARCH_PLAN_TOOL_NAME,
    description: '提交结构化项目研究计划。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'summary', 'researchBrief', 'questions', 'claims', 'nextActions'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        summary: { type: 'string', minLength: 1, maxLength: 800 },
        researchBrief: { type: 'object', additionalProperties: false, required: ['subject', 'directions', 'keywords', 'preferredChannels', 'searchQueries'], properties: {
          subject: { type: 'string', minLength: 2, maxLength: 160 },
          directions: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string', minLength: 2, maxLength: 200 } },
          keywords: { type: 'array', minItems: 3, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 80 } },
          preferredChannels: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 2, maxLength: 120 } },
          searchQueries: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 2, maxLength: 160 } },
        } },
        questions: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['question', 'why', 'preferredSources'], properties: {
          question: { type: 'string', minLength: 1, maxLength: 300 }, why: { type: 'string', minLength: 1, maxLength: 300 }, preferredSources: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 160 } },
        } } },
        claims: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['claim', 'priority', 'reason'], properties: {
          claim: { type: 'string', minLength: 1, maxLength: 300 }, priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }, reason: { type: 'string', minLength: 1, maxLength: 300 },
        } } },
        nextActions: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['action', 'purpose', 'target'], properties: {
          action: { type: 'string', enum: ['SEARCH_WEB', 'READ_LINK', 'ASK_USER'] }, purpose: { type: 'string', minLength: 1, maxLength: 300 }, target: { type: 'string', minLength: 1, maxLength: 500 },
        } } },
      },
    },
  },
};

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
    researchBrief: {
      subject: '本次研究的具体主体与事件',
      directions: ['先确认事件本身', '再核验影响正文结论的数字、时间和适用边界'],
      keywords: ['主体名称', '事件名称', '关键指标'],
      preferredChannels: ['第一方正式披露', '可信媒体原始报道'],
      searchQueries: ['主体名称 待核验事实 第一方正式披露'],
    },
    questions: [{ question: '需要回答的问题', why: '为什么需要核验', preferredSources: ['政府或机构官网'] }],
    claims: [{ claim: '需要核验的事实主张', priority: 'HIGH', reason: '对核心结论影响较大' }],
    nextActions: [{ action: 'SEARCH_WEB', purpose: '查找第一方证据', target: '明确的检索目标或关键词' }],
  };
  const system = [
    '你是内容项目的研究编辑，只生成研究计划，不直接写文章，不宣称已经完成网页检索。',
    '没有资料时，必须根据已确认的项目规划提出待回答问题、建议来源和后续动作，不能把常识或推测写成已核验结论。',
    '先形成一份可执行的研究简报，必须明确研究主体、研究方向、核心关键词、优先渠道和查询词。研究方向应回答正文真正缺少什么证据，不能写成“了解背景”“搜索相关信息”等空泛任务。',
    '关键词必须覆盖实体名称、事件名称、关键数字或规则及常见别名。查询词必须同时包含实体名称、待核验事实和来源线索，能够直接用于搜索，不能只写一个宽泛题材词。',
    '优先渠道必须写具体渠道类型并按证据等级排序。财经、IPO、募资和上市选题优先交易所正式公告、招股书、证监会或发行人披露，再到原始媒体报道和可信财经媒体交叉报道；科技产品选题优先产品官方文档、公司公告、监管或研究机构材料，再到可信科技媒体。',
    '每条事实主张必须原子化并可由来源原文直接核对。数字、日期、主体、规则和适用范围不要混在同一条主张里。',
    'nextActions 中的 SEARCH_WEB 目标必须直接取自 researchBrief.searchQueries，最多安排两个自动检索动作。项目原始文章会由系统单独读取，补充检索应优先寻找独立证据。',
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

function researchRunView(row, materialIds = { inputIds: [], referenceIds: [], assetIds: [] }) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    request: row.source_snapshot_json?.request ?? '',
    model: row.model,
    actionVersion: row.action_version_id,
    materialIds,
    materialCount: materialIds.inputIds.length + materialIds.referenceIds.length + materialIds.assetIds.length,
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
  RESEARCH_PLAN_TOOL_NAME,
  researchPlanTool,
  researchBriefSchema,
  researchPlanSchema,
  parseResearchPlan,
  buildResearchPlanPrompt,
  buildResearchPlanRepairPrompt,
  researchRunView,
  researchPlanView,
};
