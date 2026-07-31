const { z } = require('zod');
const { outlineSchema, outlineTemplateScope } = require('./creative-outline.cjs');
const { draftTemplateScope } = require('./creative-draft.cjs');

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
  body: z.string().trim().min(80).max(30_000).refine((value) => !/(\*\*|__|(?:^|\n)\s{0,3}#{1,6}\s+)/m.test(value), '正式文稿不得包含 Markdown 标记。'),
  changeSummary: z.string().trim().min(1).max(500),
  factsToVerify: z.array(z.string().trim().min(1).max(300)).max(20),
});
const copyQualityReviewSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string().trim().min(1).max(500)).max(12),
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
  if (!input.hasBody) return { action: 'GENERATE_DRAFT' };
  return { needsClarification: true, question: '你希望润色、重构、扩写还是压缩当前文案？' };
}

function copyTemplateScope(platform) {
  const scope = REVISION_TEMPLATE_SCOPES[platform];
  if (!scope) throw new Error('当前平台没有接入文案修订提示词。');
  return scope;
}

function copyPromptTemplateScope(action, platform) {
  if (action === 'GENERATE_OUTLINE') return outlineTemplateScope(platform);
  if (action === 'GENERATE_DRAFT') return draftTemplateScope(platform);
  return copyTemplateScope(platform);
}

function mergeFactsToVerify(...groups) {
  return [...new Set(groups.flat().map((fact) => String(fact ?? '').trim()).filter(Boolean))];
}

function normalizedFactClaim(value) {
  return normalizeSafetyText(value).toLowerCase().replace(/[的了]/g, '');
}

function factNumbers(value) {
  return String(value ?? '').match(/\d+(?:\.\d+)?/g) ?? [];
}

function longestCommonSubsequenceLength(left, right) {
  const shorter = [...left];
  const longer = [...right];
  const table = Array(shorter.length + 1).fill(0);
  for (const character of longer) {
    let diagonal = 0;
    for (let index = 1; index <= shorter.length; index += 1) {
      const previous = table[index];
      if (shorter[index - 1] === character) table[index] = diagonal + 1;
      else table[index] = Math.max(table[index], table[index - 1]);
      diagonal = previous;
    }
  }
  return table[shorter.length];
}

function verifiedFactSupports(candidate, verified) {
  const candidateText = normalizedFactClaim(candidate);
  const verifiedText = normalizedFactClaim(verified);
  if (!candidateText || !verifiedText) return false;
  if (candidateText.includes(verifiedText) || verifiedText.includes(candidateText)) return true;
  const verifiedNumbers = factNumbers(verified);
  if (verifiedNumbers.length && verifiedNumbers.join('|') !== factNumbers(candidate).join('|')) return false;
  const shorterLength = Math.min(candidateText.length, verifiedText.length);
  if (shorterLength < 8) return false;
  return longestCommonSubsequenceLength(candidateText, verifiedText) / shorterLength >= 0.82;
}

function reconcileFactsToVerify(factsToVerify, verifiedFacts) {
  const verifiedClaims = (Array.isArray(verifiedFacts) ? verifiedFacts : [])
    .map((item) => typeof item === 'string' ? item : item?.claim)
    .map((claim) => String(claim ?? '').trim())
    .filter(Boolean);
  return mergeFactsToVerify(factsToVerify ?? [])
    .filter((candidate) => !verifiedClaims.some((verified) => verifiedFactSupports(candidate, verified)));
}

function detectVoiceViolations(body, rules = {}) {
  const text = String(body ?? '');
  const issues = [];
  const bannedPhrases = [...new Set([...(rules.bannedPhrases ?? []), '很多人会问', '今天我们就来', '简单来说', '这意味着', '建议点赞收藏', '评论区聊聊'])];
  for (const phrase of bannedPhrases) {
    const index = text.indexOf(phrase);
    if (index !== -1) issues.push({ code: 'BANNED_PHRASE', excerpt: phrase, message: `避免使用套话：${phrase}` });
  }
  if (/^\s*[\p{Extended_Pictographic}\u2600-\u27BF][^\n]{0,28}$/mu.test(text)) {
    issues.push({ code: 'EMOJI_HEADING', excerpt: text.match(/^\s*[^\n]+/m)?.[0] ?? '', message: '不要用 emoji 作为单独小标题。' });
  }
  if (/(建议点赞收藏|评论区聊聊|记得关注|转发给|点赞收藏)/.test(text)) {
    issues.push({ code: 'FORCED_CTA', excerpt: text.match(/(建议点赞收藏|评论区聊聊|记得关注|转发给|点赞收藏)/)?.[0] ?? '', message: '结尾不要强制索要点赞、收藏、评论或转发。' });
  }
  return issues.filter((item, index, entries) => index === entries.findIndex((other) => other.code === item.code));
}

function applyAcceptedCopyToState(state, input) {
  const nextState = {
    ...state,
    projects: (state.projects ?? []).map((project) => ({
      ...project,
      versions: (project.versions ?? []).map((version) => ({ ...version })),
    })),
  };
  const project = nextState.projects.find((item) => item.id === input.projectId);
  const version = project?.versions.find((item) => item.platform === input.platform);
  if (!project || !version) throw new Error('正式文案版本已不存在，无法采用候选。');
  version.title = input.title;
  version.body = input.body;
  version.status = 'DRAFT';
  version.updatedAt = input.updatedAt;
  project.status = 'WRITING';
  // 首篇正式文案采用后，后续工作转入各渠道版本的确认与适配。
  if (!project.stage || project.stage === 'MASTER_WRITING') project.stage = 'PLATFORM_ADAPTATION';
  project.factChecks = mergeFactsToVerify(project.factChecks ?? [], input.factsToVerify ?? []);
  project.updatedAt = input.updatedAt;
  return { state: nextState, project, version };
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

function normalizeSafetyText(value) {
  return String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
}

function unresolvedClaims(researchContext) {
  return (researchContext?.cautions ?? [])
    .map((item) => typeof item === 'string' ? item : item?.claim)
    .map((claim) => String(claim ?? '').trim())
    .filter((claim) => normalizeSafetyText(claim).length >= 12);
}

function includesUnresolvedClaim(value, claims) {
  const normalized = normalizeSafetyText(value);
  return claims.some((claim) => {
    const normalizedClaim = normalizeSafetyText(claim);
    if (normalized.includes(normalizedClaim)) return true;
    // 待复核主张常会被模型改写成一句更短的确定性表述。用足够长的连续片段
    // 拦住这种“删掉限定词后继续当事实写”的情况，避免误伤单个通用术语。
    const minimumPhraseLength = 7;
    for (let index = 0; index <= normalizedClaim.length - minimumPhraseLength; index += 1) {
      if (normalized.includes(normalizedClaim.slice(index, index + minimumPhraseLength))) return true;
    }
    return false;
  });
}

function safeProjectContext(project, cautions) {
  const planning = project?.planning ?? {};
  const safePlanning = {
    angle: planning.angle,
    title: planning.title,
    timing: planning.timing,
    category: planning.category,
    objective: planning.objective,
    constraints: planning.constraints,
    targetAudience: planning.targetAudience,
    targetPlatforms: planning.targetPlatforms,
  };
  if (planning.coreMessage && !includesUnresolvedClaim(planning.coreMessage, cautions)) safePlanning.coreMessage = planning.coreMessage;
  return {
    id: project?.id,
    title: project?.title,
    planning: safePlanning,
    ...(project?.coreViewpoint && !includesUnresolvedClaim(project.coreViewpoint, cautions) ? { coreViewpoint: project.coreViewpoint } : {}),
  };
}

function safeWritingBrief(brief, cautions) {
  const safe = {
    objective: brief?.objective,
    targetAudience: brief?.targetAudience,
    sourceRequirements: brief?.sourceRequirements,
    lengthTarget: brief?.lengthTarget,
    notes: brief?.notes,
  };
  if (brief?.coreMessage && !includesUnresolvedClaim(brief.coreMessage, cautions)) safe.coreMessage = brief.coreMessage;
  return safe;
}

function isRevisionAction(action) {
  return action !== 'GENERATE_OUTLINE' && action !== 'GENERATE_DRAFT';
}

function preservedExistingCautions(action, safetyContext) {
  if (!isRevisionAction(action)) return [];
  const existingBody = safetyContext?.currentContent?.body ?? '';
  return unresolvedClaims(safetyContext?.researchContext)
    .filter((claim) => includesUnresolvedClaim(existingBody, [claim]));
}

function assertNoUnresolvedClaimInBody(output, action, safetyContext) {
  const allowed = new Set(preservedExistingCautions(action, safetyContext));
  const claimsInBody = unresolvedClaims(safetyContext?.researchContext)
    .filter((claim) => includesUnresolvedClaim(output.body, [claim]));
  for (const claim of claimsInBody) {
    if (!allowed.has(claim)) throw new Error(`正式正文不得把待复核主张写成确定事实：${claim}`);
    // 原稿已有的待核验事实属于可继承元数据，不能依赖模型每次准确回传。
    output.factsToVerify = mergeFactsToVerify(output.factsToVerify, [claim]);
  }
}

function parseCopyOutput(content, action, safetyContext) {
  const value = parseJson(content, '模型没有返回文案内容。', '模型返回的文案不是有效 JSON。');
  if (action === 'GENERATE_OUTLINE') return outlineSchema.parse(value);
  const output = copyOutputSchema.parse(value);
  assertNoUnresolvedClaimInBody(output, action, safetyContext);
  return output;
}

function buildCopyPrompt(snapshot) {
  const businessTemplate = snapshot.action === 'GENERATE_OUTLINE' || snapshot.action === 'GENERATE_DRAFT'
    ? String(snapshot.template ?? '').trim()
    : validateRevisionTemplate(snapshot.template ?? defaultRevisionTemplate(snapshot.platform));
  if (!businessTemplate) throw new Error('文案动作提示词不能为空。');
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
  const cautions = unresolvedClaims(snapshot.researchContext);
  const preservedCautions = preservedExistingCautions(snapshot.action, snapshot);
  const cautionBoundaryRule = cautions.length
    ? isRevisionAction(snapshot.action)
      ? `待复核主张：${cautions.map((claim, index) => `${index + 1}. ${claim}`).join('；')}。本次原稿允许保留的主张：${preservedCautions.length ? preservedCautions.join('；') : '无'}。仅这些原稿已有主张可被保留，系统会自动写入 factsToVerify；不得新增、扩写、推演、举例或把它包装成已确认结论。其余待复核主张仍不得写入正文。`
      : `待复核主张禁止写入区：${cautions.map((claim, index) => `${index + 1}. ${claim}`).join('；')}。这些内容不得出现在正文中，也不得换词解释、推演、举例或以“通常”“可能”“待官方确认”等方式继续展开；只能原样保留在 factsToVerify。若它是项目的重要信息缺口，就把文章改为基于已核验事实的阅读判断，不要补写技术背景。`
    : null;
  const platformQualityRules = snapshot.platform === 'WECHAT'
    ? [
      '公众号正文开篇先写一个读者熟悉的场景、疑问或反差，再交代这条新闻为何值得读；不要把新闻通稿改写成第一段，也不要用“本文将”“对于普通读者来说”等空泛开场。',
      '正文按“发生了什么—为什么与你有关—你该如何理解或行动”推进，使用 3 至 5 个读者能看懂的小标题和短段落。不要写成百科词条、新闻通稿或教科书解释。',
      '纯文本成稿：不得使用 Markdown 标记（例如 **、__、#）。小标题单独成行即可；每段只表达一个意思，避免连续堆砌定义和术语。',
      '如果已核验的内容只足以确认一件新闻事件，而该事件的具体用途、能力或影响仍待复核，文章应转向“如何看懂这条新闻”的解释或判断，不能把待复核的用途扩写成正文主体，更不能据此推演具体应用效果。',
      '结尾必须回到开篇提出的读者问题，给出一个具体、克制的理解框架；不要用“持续关注后续报道”充当结尾。',
    ]
    : snapshot.platform === 'XIAOHONGSHU'
      ? ['小红书正文必须首屏给出可获得的信息或明确结论，短段落推进，避免写成长篇百科说明；纯文本成稿，不得使用 Markdown 标记。']
      : snapshot.platform === 'ZHIHU'
        ? ['知乎正文必须先直接回答问题，再补充论证、边界与例证；纯文本成稿，不得使用 Markdown 标记。']
        : ['微博内容必须先给出核心信息或观点，再判断单条或串文推进；纯文本成稿，不得使用 Markdown 标记。'];
  const system = [
    '你是内容项目的文案编辑，只执行已经确认的单一动作。',
    `本次动作是 ${snapshot.action}，目标平台是 ${snapshot.platform}。`,
    '项目标题、核心观点和目标平台是硬主题边界：文章主体必须服务项目主题、核心观点与平台表达规则。不得用研究资料中的单条事件替换项目主题；与主题不一致的资料只能作为背景，或不使用。',
    '严格依据项目资料、当前正文、选区、内容母版、阶段摘要和 Skill 工作，不得编造数据、引语、来源或人物经历。',
    '研究上下文中的 verifiedFacts 是唯一可以作为已确认客观事实写入正文的研究结论；cautions 不能改写成确定事实。修改已有正文时，只有系统列出的原稿已有主张可原样保留为待核验内容。',
    '不得写入未出现在 verifiedFacts 中的具体日期、单位、人数、引语、会议或产品能力。factsToVerify 与 cautions 中的内容不能被包装为确定事实。没有 verifiedFacts 时，只能依据用户材料、当前正文或观点方法写作，禁止补充伪具体事实。',
    ...(cautionBoundaryRule ? [cautionBoundaryRule] : []),
    'factsToVerify 只列本次候选正文仍直接涉及的待核验事实；不得回填项目历史核验池中的无关条目。保留的待核验事实不得被删掉、弱化或改写为已确认事实。',
    ...platformQualityRules,
    '输出前自行检查：标题与正文是否仍服务项目主题；是否有无法追溯的具体事实；是否存在空泛套话、Markdown 标记或把解释性内容写成通稿。发现任一问题就重写后再输出。',
    '只返回 JSON，不要 Markdown 代码围栏、过程说明或额外字段。',
    `严格按以下形状返回：${JSON.stringify(snapshot.action === 'GENERATE_OUTLINE' ? outlineExample : copyExample)}`,
  ].join('\n');
  const message = JSON.stringify({
    businessTemplate,
    action: snapshot.action,
    request: snapshot.request,
    platform: snapshot.platform,
    project: safeProjectContext(snapshot.project, cautions),
    writingBrief: safeWritingBrief(snapshot.brief, cautions),
    accountVoice: snapshot.accountVoice ? {
      name: snapshot.accountVoice.name,
      version: snapshot.accountVoice.version,
      offset: snapshot.accountVoice.offset,
      rules: snapshot.accountVoice.rules,
    } : null,
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
    researchContext: snapshot.researchContext ?? null,
  });
  return { system, message };
}

function buildCopyRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过结构校验。请只返回修正后的 JSON。校验错误：${validationError}`;
}

function parseCopyQualityReview(content) {
  return copyQualityReviewSchema.parse(parseJson(content, '质量审稿没有返回结果。', '质量审稿返回的不是有效 JSON。'));
}

function candidateQualityReview(review) {
  return review.approved
    ? { status: 'PASSED', issues: [] }
    : { status: 'NEEDS_REVIEW', issues: review.issues };
}

function buildCopyQualityReviewPrompt({ action, platform, output, researchContext, currentContent }) {
  const allowedExistingCautions = preservedExistingCautions(action, { currentContent, researchContext });
  const system = [
    '你是内容事实与质量审稿人，不负责润色，不得使用模型已有知识补全事实。',
    '只允许把 verifiedFacts 中直接支持的内容当作正文事实。cautions 默认是禁止写入区：即使正文使用“通常”“可能”“待确认”等限定语，凡是解释、推演、举例或复述其中主张，都必须拒绝。唯一例外是 allowedExistingCautions：它们来自本次修改前的原稿，可保留但必须同时列在 candidate.factsToVerify；仍不得新增、扩写、推演或包装成确认结论。',
    '审查正文是否存在未获证据支持的技术能力、代际判断、因果影响、数据、人物、机构、时间或应用场景；同时审查是否仍像面向读者的目标平台成稿，而非新闻通稿、百科词条或 Markdown 草稿。',
    `目标平台是 ${platform}。`,
    '只返回 JSON：{"approved":true,"issues":[]}。若不合格，approved 必须为 false，issues 写出可直接用于重写的具体问题。',
  ].join('\n');
  return {
    system,
    message: JSON.stringify({
      candidate: output,
      verifiedFacts: researchContext?.verifiedFacts ?? [],
      cautions: researchContext?.cautions ?? [],
      allowedExistingCautions,
    }),
  };
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
  copyPromptTemplateScope,
  mergeFactsToVerify,
  reconcileFactsToVerify,
  detectVoiceViolations,
  unresolvedClaims,
  safeProjectContext,
  safeWritingBrief,
  applyAcceptedCopyToState,
  validateRevisionTemplate,
  defaultRevisionTemplate,
  parseCopyOutput,
  buildCopyPrompt,
  buildCopyRepairPrompt,
  parseCopyQualityReview,
  candidateQualityReview,
  buildCopyQualityReviewPrompt,
};
