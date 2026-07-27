const { z } = require('zod');

const OUTLINE_ACTION_VERSION = 'creative-outline:1.1.0';
const OUTLINE_SCOPE = 'CONTENT_WRITING';
const OUTLINE_TEMPLATE_SCOPE = 'CREATIVE_OUTLINE';
const MAX_OUTLINE_TEMPLATE_LENGTH = 12_000;

const outlineSchema = z.object({
  titleOptions: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
  summary: z.string().trim().min(1).max(500),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(240),
    keyPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  })).min(3).max(10),
  factsToVerify: z.array(z.string().trim().min(1).max(300)).max(8),
});

function parseOutlineContent(content) {
  if (typeof content !== 'string') throw new Error('模型没有返回大纲内容。');
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value;
  try { value = JSON.parse(normalized); }
  catch { throw new Error('模型返回的大纲不是有效 JSON。'); }
  return outlineSchema.parse(value);
}

function validateOutlineTemplate(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('生成大纲提示词不能为空。');
  if (body.length > MAX_OUTLINE_TEMPLATE_LENGTH) throw new Error(`生成大纲提示词不能超过 ${MAX_OUTLINE_TEMPLATE_LENGTH.toLocaleString('en-US')} 个字符。`);
  return body.trim();
}

function defaultOutlineTemplate() {
  return '围绕核心表达设计清晰、完整、可执行的大纲。标题应准确具体，章节之间必须有推进关系，每节说明写作目的和关键要点；不确定内容列入待核验事实。';
}

function buildOutlinePrompt({ project, brief, skills, platform, template }) {
  const businessTemplate = validateOutlineTemplate(template ?? defaultOutlineTemplate());
  const example = {
    titleOptions: ['标题方案一', '标题方案二'],
    summary: '大纲采用的叙事和论证思路',
    sections: [
      { heading: '开篇', purpose: '说明本节作用', keyPoints: ['要点一'] },
      { heading: '主体', purpose: '说明本节作用', keyPoints: ['要点一', '要点二'] },
      { heading: '结尾', purpose: '说明本节作用', keyPoints: ['行动建议'] },
    ],
    factsToVerify: ['写作前仍需核验的事实'],
  };
  const system = [
    '你是内容项目的大纲编辑，只生成大纲候选，不撰写完整正文。',
    '严格依据 WritingBrief、项目资料和 Skill 规则工作。不得编造数据、引语、来源或人物经历。',
    'Skill 只约束写法，不能覆盖事实核验、版权和平台合规要求。',
    '只返回 JSON，不要 Markdown、代码围栏或解释文字。',
    '必须包含 titleOptions、summary、sections、factsToVerify。sections 每项必须包含 heading、purpose、keyPoints。',
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
    skillRules: skills.map((skill) => ({ dimension: skill.dimension, name: skill.name, version: skill.version.version, instructions: skill.version.instructions })),
    platform,
  });
  return { system, message };
}

function buildOutlineRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构校验。请只返回修正后的 JSON。校验错误：${validationError}`;
}

function outlineCandidateView(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    platform: row.platform,
    status: row.status,
    selectedTitle: row.selected_title ?? null,
    ...row.output_json,
    model: row.model,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
  };
}

module.exports = { OUTLINE_ACTION_VERSION, OUTLINE_SCOPE, OUTLINE_TEMPLATE_SCOPE, outlineSchema, validateOutlineTemplate, defaultOutlineTemplate, parseOutlineContent, buildOutlinePrompt, buildOutlineRepairPrompt, outlineCandidateView };
