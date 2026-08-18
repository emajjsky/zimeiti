const { z } = require('zod');

const OUTLINE_ACTION_VERSION = 'creative-outline:1.1.0';
const OUTLINE_SCOPE = 'CONTENT_WRITING';
const OUTLINE_TEMPLATE_SCOPES = {
  WECHAT: 'CREATIVE_OUTLINE_WECHAT',
  XIAOHONGSHU: 'CREATIVE_OUTLINE_XIAOHONGSHU',
  ZHIHU: 'CREATIVE_OUTLINE_ZHIHU',
  WEIBO: 'CREATIVE_OUTLINE_WEIBO',
};
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

function outlineTemplateScope(platform) {
  const scope = OUTLINE_TEMPLATE_SCOPES[platform];
  if (!scope) throw new Error('当前平台没有接入大纲提示词。');
  return scope;
}

function defaultOutlineTemplate(platform) {
  if (platform === 'XIAOHONGSHU') {
    return '为小红书图文设计大纲。标题需要具体、有阅读动机但不得夸张；结构适合移动端快速阅读，开篇尽快给出利益点或问题冲突，正文按可拆分为图文页的段落推进，结尾给出互动或行动建议。不确定内容列入待核验事实。';
  }
  if (platform === 'ZHIHU') {
    return '为知乎回答设计大纲。先还原问题语境并给出明确结论，再建立事实、原因、案例和边界组成的论证链；标题和章节要服务读者理解，不写空泛态度。不确定内容列入待核验事实。';
  }
  if (platform === 'WEIBO') {
    return '为微博内容设计大纲。优先判断适合单条还是串文，首句承载核心信息或时效钩子，后续按事实、观点和行动建议推进；每一条都要可独立理解，不制造夸张冲突。不确定内容列入待核验事实。';
  }
  return '为公众号图文设计大纲。标题需要准确具体；结构要有完整的叙事或论证推进，开篇交代问题与阅读价值，正文使用清晰层级展开解释、证据和案例，结尾形成总结或行动建议。不确定内容列入待核验事实。';
}

function buildOutlinePrompt({ project, brief, skills, platform, template, materials = [] }) {
  const businessTemplate = validateOutlineTemplate(template ?? defaultOutlineTemplate(platform));
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
    projectMaterials: materials,
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

module.exports = { OUTLINE_ACTION_VERSION, OUTLINE_SCOPE, OUTLINE_TEMPLATE_SCOPES, outlineTemplateScope, outlineSchema, validateOutlineTemplate, defaultOutlineTemplate, parseOutlineContent, buildOutlinePrompt, buildOutlineRepairPrompt, outlineCandidateView };
