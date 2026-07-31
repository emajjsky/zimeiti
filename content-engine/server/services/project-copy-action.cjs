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

const PLATFORM_WRITING_RULES = {
  WECHAT: [
    '写成适合手机阅读的完整公众号文章，使用短段落和自然的小标题。',
    '开篇直接建立读者关心的问题、场景或反差，正文形成完整论证，结尾回收核心判断。',
    '不写新闻通稿、百科词条、模板化互动或 Markdown 标记。',
  ],
  XIAOHONGSHU: [
    '首屏给出明确阅读价值，使用短段落和高信息密度的图文结构。',
    '不虚构个人体验，不堆砌 emoji，不强迫点赞收藏。',
  ],
  ZHIHU: [
    '先回答问题，再展开论证、证据、边界和必要的反例。',
    '保留问题语境，不照搬公众号口吻，不用态度替代论证。',
  ],
  WEIBO: [
    '核心信息或观点前置，根据篇幅写成单条、长微博或可独立阅读的串文。',
    '压缩重复表达，不照搬小红书分段话术。',
  ],
};

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

function copyActionPersistenceMode(action) {
  if (!COPY_ACTIONS.includes(action)) throw new Error('未知的文案动作。');
  return action === 'GENERATE_DRAFT' ? 'ACCEPTED' : 'CANDIDATE';
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

function compactStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function evidenceSourceIds(fact) {
  const direct = compactStrings(fact?.sourceIds);
  const evidence = (Array.isArray(fact?.evidence) ? fact.evidence : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    return [item.sourceId, item.source_id, ...(Array.isArray(item.sourceIds) ? item.sourceIds : [])];
  });
  return compactStrings([...direct, ...evidence]);
}

function authorMaterialView(material) {
  const rawKind = String(material?.kind ?? '').toUpperCase();
  const kind = ['DRAFT', 'OPINION', 'EXPERIENCE'].includes(rawKind) ? rawKind : null;
  const content = String(material?.body ?? material?.content ?? '').trim();
  if (!kind || !content) return null;
  return { id: String(material.id), kind, content };
}

function buildWritingPacket(snapshot, preparedResearch = null) {
  const research = preparedResearch ?? snapshot.researchContext ?? {};
  const verifiedFacts = Array.isArray(research.verifiedFacts) ? research.verifiedFacts : Array.isArray(research.facts) ? research.facts : [];
  const cautions = Array.isArray(research.cautions) ? research.cautions : [];
  const projectPlanning = snapshot.project?.planning ?? {};
  const lockedTitle = String(projectPlanning.title ?? snapshot.project?.title ?? snapshot.currentContent?.title ?? '').trim();
  if (!lockedTitle) throw new Error('项目规划缺少已确认标题。');

  const materialCandidates = [
    ...(Array.isArray(snapshot.materials) ? snapshot.materials : []),
    ...(Array.isArray(research.userContent) ? research.userContent : []),
    ...(Array.isArray(research.materialContext?.userContent) ? research.materialContext.userContent : []),
  ];
  const authorMaterials = materialCandidates.map(authorMaterialView).filter(Boolean)
    .filter((item, index, items) => index === items.findIndex((other) => other.id === item.id));
  const creativeReferences = (Array.isArray(research.creativeReferences) ? research.creativeReferences : Array.isArray(research.materialContext?.creativeReferences) ? research.materialContext.creativeReferences : [])
    .map((item, index) => {
      const purpose = ['ANGLE', 'STRUCTURE', 'STYLE'].includes(item?.purpose) ? item.purpose : item?.role === 'STYLE' ? 'STYLE' : item?.role === 'ANGLE' ? 'ANGLE' : 'STRUCTURE';
      const summary = String(item?.summary ?? item?.title ?? '').trim();
      return summary ? { id: String(item?.id ?? `reference-${index + 1}`), purpose, summary } : null;
    }).filter(Boolean);
  const verifiedClaims = verifiedFacts
    .filter((item) => typeof item === 'string' || !item?.status || item.status === 'VERIFIED')
    .map((item, index) => ({
      id: String(typeof item === 'object' && item?.id ? item.id : `claim-${index + 1}`),
      claim: String(typeof item === 'string' ? item : item?.claim ?? '').trim(),
      sourceIds: typeof item === 'string' ? [] : evidenceSourceIds(item),
    })).filter((item) => item.claim);
  const accountVoice = compactStrings([
    snapshot.accountVoice?.name,
    snapshot.accountVoice?.offset,
    ...Object.values(snapshot.accountVoice?.rules ?? {}).flatMap((value) => Array.isArray(value) ? value : [value]),
  ]);
  const skillInstructions = (Array.isArray(snapshot.skills) ? snapshot.skills : [])
    .map((skill) => String(skill?.version?.instructions ?? skill?.instructions ?? '').trim()).filter(Boolean);

  return {
    projectId: String(snapshot.projectId ?? snapshot.project?.id ?? ''),
    platform: snapshot.platform,
    lockedTitle,
    subject: String(projectPlanning.category ?? snapshot.project?.category ?? '').trim(),
    contentType: String(snapshot.brief?.contentType ?? snapshot.project?.contentType ?? '图文内容').trim(),
    audience: String(snapshot.brief?.targetAudience ?? projectPlanning.targetAudience ?? '').trim(),
    objective: String(snapshot.brief?.objective ?? projectPlanning.objective ?? '').trim(),
    coreMessage: String(snapshot.brief?.coreMessage ?? projectPlanning.coreMessage ?? snapshot.project?.coreViewpoint ?? '').trim(),
    targetLength: String(snapshot.brief?.lengthTarget ?? '').trim(),
    platformRules: PLATFORM_WRITING_RULES[snapshot.platform] ?? [],
    accountVoice,
    articleTone: String(snapshot.brief?.notes ?? snapshot.accountVoice?.offset ?? '').trim(),
    skillInstructions,
    authorMaterials,
    verifiedClaims,
    creativeReferences,
    forbiddenClaims: compactStrings(cautions.map((item) => typeof item === 'string' ? item : item?.claim)),
  };
}

function buildFinishedCopyPrompt(packet, template) {
  const businessTemplate = String(template ?? '').trim();
  if (!businessTemplate) throw new Error('正文生成提示词不能为空。');
  return {
    system: [
      '你是内容项目的主笔编辑。请在一次写作中交付可直接进入编辑器的最终成稿。',
      '先在内部完成选题理解、结构设计、事实边界检查、平台适配和语言检查，再输出结果。',
      '只输出最终正文，不输出标题、解释、构思过程、检查清单、字段名、代码围栏或其他附加内容。',
      '标题已经锁定，正文必须承接该标题，不得另起标题或改变选题。',
      'verifiedClaims 是唯一可作为确定外部事实使用的研究结论；authorMaterials 中的内容按作者草稿、观点或经历处理。',
      'forbiddenClaims 不得写成确定事实，也不得借助模型已有知识补写具体日期、数字、引语、人物经历或产品能力。',
      '遵守平台规则、账号声音、本篇语气和 Skill 指令；避免套话、虚假权威、夸张承诺、生硬互动和 AI 模板感。',
      '成稿必须完整，不得留下待补充、待核验、建议修改或下一步处理等内部工作痕迹。',
    ].join('\n'),
    message: JSON.stringify({ businessTemplate, writingPacket: packet }),
  };
}

function normalizeFinishedCopyBody(content, packet = {}) {
  let body = String(content ?? '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').trim();

  body = body
    .split('\n')
    .map((line) => {
      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return '';
      return line
        .replace(/^\s{0,3}#{1,6}[ \t]+/, '')
        .replace(/^\s{0,3}>[ \t]?/, '')
        .replace(/^\s*[-+*][ \t]+/, '• ')
        .trimEnd();
    })
    .join('\n')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lockedTitle = String(packet.lockedTitle ?? '').trim();
  if (lockedTitle) {
    const lines = body.split('\n');
    const firstContentIndex = lines.findIndex((line) => line.trim());
    if (firstContentIndex !== -1 && lines[firstContentIndex].trim() === lockedTitle) {
      lines.splice(firstContentIndex, 1);
      body = lines.join('\n').replace(/^\s+/, '').trim();
    }
  }

  return body;
}

function parseFinishedCopyBody(content, packet) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回完整正文。');
  const rawBody = content.trim();
  if (/```/.test(rawBody)) throw new Error('正文包含代码围栏，不能保存。');
  if (/^\s*[\[{]/.test(rawBody)) throw new Error('正文返回了结构化对象，不能保存。');
  if (/(qualityReview|factsToVerify|changeSummary|writingPacket|system prompt|系统提示词)/i.test(rawBody)) throw new Error('正文泄漏了内部字段，不能保存。');
  const body = normalizeFinishedCopyBody(rawBody, packet);
  if (body.length < 80) throw new Error('模型返回的正文不完整。');
  if (body.length > 30_000) throw new Error('模型返回的正文超过可保存长度。');
  return { title: packet.lockedTitle, body };
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

function normalizeQualityReviewIssue(issue) {
  if (typeof issue === 'string') return issue.trim();
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return '';
  const preferredKeys = ['problem', 'issue', 'message', 'description', 'reason', 'suggestion'];
  const values = [];
  for (const key of preferredKeys) {
    if (typeof issue[key] === 'string' && issue[key].trim()) values.push(issue[key].trim());
  }
  for (const [key, value] of Object.entries(issue)) {
    if (!preferredKeys.includes(key) && typeof value === 'string' && value.trim()) values.push(value.trim());
  }
  return [...new Set(values)].join('；').slice(0, 500);
}

function parseCopyQualityReview(content) {
  const value = parseJson(content, '质量审稿没有返回结果。', '质量审稿返回的不是有效 JSON。');
  const normalized = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.issues)
    ? { ...value, issues: value.issues.map(normalizeQualityReviewIssue).filter(Boolean) }
    : value;
  return copyQualityReviewSchema.parse(normalized);
}

function parseCopyQualityReviewSafely(content) {
  try {
    return { ...parseCopyQualityReview(content), malformed: false };
  } catch {
    return {
      approved: false,
      issues: ['质量审稿返回格式异常，候选正文已保留，请人工检查。'],
      malformed: true,
    };
  }
}

function candidateQualityReview(review, voiceIssues = []) {
  const issues = [...new Set([
    ...(review.approved ? [] : review.issues),
    ...voiceIssues.map((issue) => typeof issue === 'string' ? issue : issue?.message),
  ].map((issue) => String(issue ?? '').trim()).filter(Boolean))];
  return issues.length
    ? { status: 'NEEDS_REVIEW', issues }
    : { status: 'PASSED', issues: [] };
}

function buildCopyQualityReviewPrompt({ action, platform, output, researchContext, currentContent }) {
  const allowedExistingCautions = preservedExistingCautions(action, { currentContent, researchContext });
  const system = [
    '你是内容事实与质量审稿人，不负责润色，不得使用模型已有知识补全事实。',
    '只允许把 verifiedFacts 中直接支持的内容当作正文事实。cautions 默认是禁止写入区：即使正文使用“通常”“可能”“待确认”等限定语，凡是解释、推演、举例或复述其中主张，都必须拒绝。唯一例外是 allowedExistingCautions：它们来自本次修改前的原稿，可保留但必须同时列在 candidate.factsToVerify；仍不得新增、扩写、推演或包装成确认结论。',
    '审查正文是否存在未获证据支持的技术能力、代际判断、因果影响、数据、人物、机构、时间或应用场景；同时审查是否仍像面向读者的目标平台成稿，而非新闻通稿、百科词条或 Markdown 草稿。',
    `目标平台是 ${platform}。`,
    '只返回 JSON：{"approved":true,"issues":[]}。若不合格，approved 必须为 false，issues 必须是字符串数组，禁止返回对象；每个字符串写出一项可直接用于重写的具体问题。',
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
  copyActionPersistenceMode,
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
  buildWritingPacket,
  buildFinishedCopyPrompt,
  normalizeFinishedCopyBody,
  parseFinishedCopyBody,
  buildCopyPrompt,
  buildCopyRepairPrompt,
  parseCopyQualityReview,
  parseCopyQualityReviewSafely,
  candidateQualityReview,
  buildCopyQualityReviewPrompt,
};
