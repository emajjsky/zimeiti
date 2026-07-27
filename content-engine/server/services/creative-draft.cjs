const { z } = require('zod');

const DRAFT_ACTION_VERSION = 'creative-draft:1.0.0';
const DRAFT_SCOPE = 'CONTENT_WRITING';
const DRAFT_TEMPLATE_SCOPE = 'CREATIVE_DRAFT';
const MAX_DRAFT_TEMPLATE_LENGTH = 12_000;

const draftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(100).max(50_000).refine((value) => !/^\s*#{1,6}\s+/m.test(value), '正文不能包含 Markdown 标题标记。'),
  factsToVerify: z.array(z.string().trim().min(1).max(300)).max(12),
});

function validateDraftTemplate(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('生成初稿提示词不能为空。');
  if (body.length > MAX_DRAFT_TEMPLATE_LENGTH) throw new Error(`生成初稿提示词不能超过 ${MAX_DRAFT_TEMPLATE_LENGTH.toLocaleString('en-US')} 个字符。`);
  return body.trim();
}

function defaultDraftTemplate() {
  return '根据已采用大纲写成完整、可直接编辑的初稿。开篇明确问题，正文完成必要的解释与论证，结尾给出具体行动建议。保持自然表达，避免空泛套话；不得编造事实、数据、案例或来源。';
}

function parseDraftContent(content) {
  if (typeof content !== 'string') throw new Error('模型没有返回初稿内容。');
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value;
  try { value = JSON.parse(normalized); }
  catch { throw new Error('模型返回的初稿不是有效 JSON。'); }
  return draftSchema.parse(value);
}

function buildDraftPrompt({ project, brief, skills, platform, outline, template }) {
  const businessTemplate = validateDraftTemplate(template ?? defaultDraftTemplate());
  const example = { title: '采用后的文章标题', body: '完整正文纯文本，使用自然段落和必要的小标题。', factsToVerify: ['发布前仍需核验的事实'] };
  const system = [
    '你是内容项目的初稿编辑，依据已采用大纲写成完整正文。',
    '严格遵守 WritingBrief、当前平台 Skill 和已采用大纲，不得擅自改变核心观点。',
    '不得编造数据、引语、来源、人物经历或医学、财经等专业结论。不确定内容写入 factsToVerify。',
    'body 必须是完整正文，不得只复述大纲。使用纯文本段落，不要使用 #、##、### 等 Markdown 标题标记。',
    '只返回 JSON，不要代码围栏或解释文字。必须包含 title、body、factsToVerify。',
    `目标平台代码为 ${platform}。严格按以下形状返回：${JSON.stringify(example)}`,
  ].join('\n');
  const message = JSON.stringify({
    businessTemplate,
    project: { title: project.title, coreViewpoint: project.coreViewpoint, factChecks: project.factChecks ?? [] },
    writingBrief: {
      objective: brief.objective,
      targetAudience: brief.targetAudience,
      coreMessage: brief.coreMessage,
      sourceRequirements: brief.sourceRequirements,
      lengthTarget: brief.lengthTarget,
      notes: brief.notes,
    },
    acceptedOutline: {
      selectedTitle: outline.selectedTitle,
      summary: outline.summary,
      sections: outline.sections,
      factsToVerify: outline.factsToVerify,
    },
    skillRules: skills.map((skill) => ({ dimension: skill.dimension, name: skill.name, version: skill.version.version, instructions: skill.version.instructions })),
    platform,
  });
  return { system, message };
}

function buildDraftRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构校验。请只返回修正后的 JSON。校验错误：${validationError}`;
}

function draftCandidateView(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    platform: row.platform,
    outlineCandidateId: row.outline_candidate_id,
    status: row.status,
    ...row.output_json,
    model: row.model,
    promptVersion: row.prompt_version === undefined || row.prompt_version === null ? undefined : Number(row.prompt_version),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
  };
}

module.exports = { DRAFT_ACTION_VERSION, DRAFT_SCOPE, DRAFT_TEMPLATE_SCOPE, draftSchema, validateDraftTemplate, defaultDraftTemplate, parseDraftContent, buildDraftPrompt, buildDraftRepairPrompt, draftCandidateView };
