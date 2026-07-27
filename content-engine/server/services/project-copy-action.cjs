const { z } = require('zod');
const { outlineSchema } = require('./creative-outline.cjs');

const COPY_ACTIONS = [
  'GENERATE_OUTLINE',
  'GENERATE_DRAFT',
  'POLISH_EXISTING_DRAFT',
  'RESTRUCTURE_DRAFT',
  'EXPAND_DRAFT',
  'SHORTEN_DRAFT',
  'REVISE_SELECTION',
  'ADAPT_PLATFORM',
];
const REVISION_TEMPLATE_SCOPES = {
  WECHAT: 'CREATIVE_REVISION_WECHAT',
  XIAOHONGSHU: 'CREATIVE_REVISION_XIAOHONGSHU',
  ZHIHU: 'CREATIVE_REVISION_ZHIHU',
  WEIBO: 'CREATIVE_REVISION_WEIBO',
};
const MAX_REVISION_TEMPLATE_LENGTH = 12_000;

const copyOutputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(80).max(30_000),
  changeSummary: z.string().trim().min(1).max(500),
  factsToVerify: z.array(z.string().trim().min(1).max(300)).max(20),
});

function copyActionVersion(action) {
  if (!COPY_ACTIONS.includes(action)) throw new Error('未知的文案动作。');
  return `project-copy-${action.toLowerCase().replace(/_/g, '-')}:1.0.0`;
}

function copyActionScope(action) {
  if (!COPY_ACTIONS.includes(action)) throw new Error('未知的文案动作。');
  return action === 'GENERATE_OUTLINE' || action === 'GENERATE_DRAFT' ? 'CONTENT_WRITING' : 'CONTENT_REWRITE';
}

function conflictQuestion(actions) {
  if (actions.includes('POLISH_EXISTING_DRAFT') && actions.includes('SHORTEN_DRAFT')) return '这次要优先润色表达，还是压缩篇幅？';
  return '这次只执行一个动作。你希望优先完成哪一项？';
}

function resolveCopyAction(input) {
  const request = String(input.request ?? '').trim();
  const selection = typeof input.selection === 'string' ? input.selection.trim() : input.selection?.text?.trim();
  if (selection) return { action: 'REVISE_SELECTION' };

  const matches = [];
  if (/(改成|改写为|转成|适配|发布到).*(公众号|小红书|知乎|微博|串文|长微博)/.test(request)) matches.push('ADAPT_PLATFORM');
  if (/(压缩|缩短|精简|删减|控制在\s*\d+\s*字)/.test(request)) matches.push('SHORTEN_DRAFT');
  if (/(扩写|展开写|补充细节|增加案例|写长)/.test(request)) matches.push('EXPAND_DRAFT');
  if (/(重构|重新组织|调整.*结构|重写.*结构|改变.*结构)/.test(request)) matches.push('RESTRUCTURE_DRAFT');
  if (/(润色|优化表达|改得更自然|表达更自然|语言更自然|改得更清楚)/.test(request)) matches.push('POLISH_EXISTING_DRAFT');
  if (/(生成|写|设计|先做|先出).*(大纲|提纲)|^(大纲|提纲)/.test(request)) matches.push('GENERATE_OUTLINE');
  if (/(写一篇|生成.*正文|完整正文|写成文章|起草|直接写)/.test(request)) matches.push('GENERATE_DRAFT');

  const actions = [...new Set(matches)];
  if (actions.length > 1) return { needsClarification: true, question: conflictQuestion(actions) };
  if (actions.length === 1) {
    const action = actions[0];
    if (!input.hasBody && !['GENERATE_OUTLINE', 'GENERATE_DRAFT'].includes(action)) {
      return { needsClarification: true, question: '请先提供要修改的正文，或改为生成新文案。' };
    }
    return { action };
  }
  return input.hasBody
    ? { needsClarification: true, question: '你希望润色、重构、扩写还是压缩当前文案？' }
    : { needsClarification: true, question: '你希望先生成大纲，还是直接生成完整正文？' };
}

function copyTemplateScope(platform) {
  const scope = REVISION_TEMPLATE_SCOPES[platform];
  if (!scope) throw new Error('当前平台没有接入文案修订提示词。');
  return scope;
}

function validateRevisionTemplate(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('修改文案提示词不能为空。');
  if (body.length > MAX_REVISION_TEMPLATE_LENGTH) throw new Error(`修改文案提示词不能超过 ${MAX_REVISION_TEMPLATE_LENGTH.toLocaleString('en-US')} 个字符。`);
  return body.trim();
}

function defaultRevisionTemplate(platform) {
  if (platform === 'XIAOHONGSHU') return '修改小红书图文时保留真实经验和搜索关键词，使用适合移动端的短段落与信息单元；标题有阅读动机但不夸张，结尾保持自然互动。';
  if (platform === 'ZHIHU') return '修改知乎回答时保留问题语境并结论前置，检查论证链、证据、反例和边界是否完整；不要用情绪态度替代事实依据。';
  if (platform === 'WEIBO') return '修改微博内容时先判断单条、长微博或串文形态，首句保留核心事实与时效，压缩重复表达，并确保串文每条都能独立理解。';
  return '修改公众号文章时保留作者核心观点和个人表达，改善开篇阅读价值、段落衔接和论证层次；适配移动端长文阅读，不添加未经核验的事实。';
}

function parseJson(content, emptyMessage, invalidMessage) {
  if (typeof content !== 'string') throw new Error(emptyMessage);
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(normalized); }
  catch { throw new Error(invalidMessage); }
}

function parseCopyOutput(content, action) {
  const value = parseJson(content, '模型没有返回文案内容。', '模型返回的文案不是有效 JSON。');
  return action === 'GENERATE_OUTLINE' ? outlineSchema.parse(value) : copyOutputSchema.parse(value);
}

function buildCopyPrompt(snapshot) {
  const businessTemplate = validateRevisionTemplate(snapshot.template ?? defaultRevisionTemplate(snapshot.platform));
  const outlineExample = {
    titleOptions: ['标题方案一'],
    summary: '大纲采用的叙事或论证思路',
    sections: [
      { heading: '开篇', purpose: '建立问题', keyPoints: ['核心要点'] },
      { heading: '主体', purpose: '展开论证', keyPoints: ['核心要点'] },
      { heading: '结尾', purpose: '形成行动', keyPoints: ['核心要点'] },
    ],
    factsToVerify: ['发布前仍需核验的事实'],
  };
  const copyExample = {
    title: '调整后的标题',
    body: '完整正文',
    changeSummary: '本次具体修改内容',
    factsToVerify: ['发布前仍需核验的事实'],
  };
  const system = [
    '你是内容项目的文案编辑，只执行已经确认的单一动作。',
    `本次动作是 ${snapshot.action}，目标平台是 ${snapshot.platform}。`,
    '严格依据项目资料、当前正文、选区、内容母版、阶段摘要和 Skill 工作，不得编造数据、引语、来源或人物经历。',
    '必须保留所有尚未核验的 factsToVerify；不得删掉、弱化或改写为已确认事实。',
    '只返回 JSON，不要 Markdown 代码围栏、过程说明或额外字段。',
    `严格按以下形状返回：${JSON.stringify(snapshot.action === 'GENERATE_OUTLINE' ? outlineExample : copyExample)}`,
  ].join('\n');
  const message = JSON.stringify({
    businessTemplate,
    action: snapshot.action,
    request: snapshot.request,
    platform: snapshot.platform,
    project: snapshot.project,
    writingBrief: snapshot.brief,
    currentContent: snapshot.currentContent ?? null,
    selection: snapshot.selection ?? null,
    contentMaster: snapshot.contentMaster ?? null,
    summaries: snapshot.summaries ?? [],
    skills: (snapshot.skills ?? []).map((skill) => ({
      dimension: skill.dimension,
      name: skill.name,
      version: skill.version?.version,
      instructions: skill.version?.instructions,
    })),
    materials: snapshot.materials ?? [],
  });
  return { system, message };
}

function buildCopyRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构校验。请只返回修正后的 JSON。校验错误：${validationError}`;
}

module.exports = {
  COPY_ACTIONS,
  REVISION_TEMPLATE_SCOPES,
  MAX_REVISION_TEMPLATE_LENGTH,
  copyOutputSchema,
  copyActionVersion,
  copyActionScope,
  resolveCopyAction,
  copyTemplateScope,
  validateRevisionTemplate,
  defaultRevisionTemplate,
  parseCopyOutput,
  buildCopyPrompt,
  buildCopyRepairPrompt,
};
