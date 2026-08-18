const WECHAT_COPY_GENERATION_SCOPE = 'WECHAT_COPY_GENERATION';

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

function copyActionVersion(action) {
  if (!COPY_ACTIONS.includes(action)) throw new Error('未知的文案动作。');
  return `project-copy-${action.toLowerCase().replace(/_/g, '-')}:1.0.0`;
}

function copyActionScope(action) {
  if (!COPY_ACTIONS.includes(action)) throw new Error('未知的文案动作。');
  return WECHAT_COPY_GENERATION_SCOPE;
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
  if (!COPY_ACTIONS.includes(action)) throw new Error('未知的文案动作。');
  if (platform !== 'WECHAT') throw new Error('正文创作只支持公众号母稿。');
  return WECHAT_COPY_GENERATION_SCOPE;
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

function normalizeSafetyText(value) {
  return String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
}

function unresolvedClaims(researchContext) {
  return (researchContext?.cautions ?? [])
    .map((item) => typeof item === 'string' ? item : item?.claim)
    .map((claim) => String(claim ?? '').trim())
    .filter((claim) => normalizeSafetyText(claim).length >= 12);
}

function unresolvedClaimRecords(researchContext) {
  const records = (Array.isArray(researchContext?.cautions) ? researchContext.cautions : [])
    .map((item, index) => {
      const claim = String(typeof item === 'string' ? item : item?.claim ?? '').trim();
      if (!claim) return null;
      return {
        id: String(typeof item === 'object' && item?.id ? item.id : `unresolved-claim-${index + 1}`),
        claim,
        status: String(typeof item === 'object' && item?.status ? item.status : 'UNRESOLVED'),
      };
    })
    .filter(Boolean);
  return records.filter((item, index) => index === records.findIndex((other) => other.id === item.id || other.claim === item.claim));
}

function claimMentionIsUncertain(body, claim) {
  const normalizedBody = normalizeSafetyText(body);
  const normalizedClaim = normalizeSafetyText(claim);
  let offset = normalizedBody.indexOf(normalizedClaim);
  if (offset === -1) return false;
  while (offset !== -1) {
    const context = `${normalizedBody.slice(Math.max(0, offset - 24), offset)}${normalizedBody.slice(offset + normalizedClaim.length, offset + normalizedClaim.length + 16)}`;
    if (!/(尚不能确认|无法确认|未能确认|仍待核验|待核实|未经核验|不能当作事实|不应视为事实|说法存疑|有待官方确认)/u.test(context)) return false;
    offset = normalizedBody.indexOf(normalizedClaim, offset + normalizedClaim.length);
  }
  return true;
}

function includesUnresolvedClaim(value, claims) {
  const normalized = normalizeSafetyText(value);
  return claims.some((claim) => {
    const normalizedClaim = normalizeSafetyText(claim);
    if (normalized.includes(normalizedClaim)) return !claimMentionIsUncertain(value, claim);
    // 待复核主张常会被模型改写成一句更短的确定性表述。用足够长的连续片段
    // 拦住这种“删掉限定词后继续当事实写”的情况，避免误伤单个通用术语。
    const minimumPhraseLength = 7;
    let matchedFragments = 0;
    for (let index = 0; index <= normalizedClaim.length - minimumPhraseLength; index += 1) {
      const fragment = normalizedClaim.slice(index, index + minimumPhraseLength);
      if (normalized.includes(fragment) && !claimMentionIsUncertain(value, claim)) {
        matchedFragments += 1;
        if (matchedFragments >= 2) return true;
      }
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
  return COPY_ACTIONS.includes(action) && action !== 'GENERATE_OUTLINE' && action !== 'GENERATE_DRAFT';
}

function isSourceBasedRewriteAction(action) {
  return ['POLISH_EXISTING_DRAFT', 'EXPAND_DRAFT', 'SHORTEN_DRAFT', 'REVISE_SELECTION', 'ADAPT_PLATFORM'].includes(action);
}

function revisionComparisonText(value) {
  return String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
}

function textSimilarity(left, right) {
  const normalizedLeft = revisionComparisonText(left);
  const normalizedRight = revisionComparisonText(right);
  const longest = Math.max(normalizedLeft.length, normalizedRight.length);
  if (!longest) return 1;
  return longestCommonSubsequenceLength(normalizedLeft, normalizedRight) / longest;
}

function assertRevisionChanged(output, action, safetyContext) {
  if (!isRevisionAction(action)) return;
  const current = safetyContext?.selection?.text || safetyContext?.currentContent?.body || '';
  const currentTitle = safetyContext?.currentContent?.title ?? '';
  if (!String(current).trim()) return;
  if (revisionComparisonText(output.body) === revisionComparisonText(current)
    && revisionComparisonText(output.title) === revisionComparisonText(currentTitle)) {
    throw new Error('修改结果与原文一致，请补充更明确的修改要求后重试。');
  }
  if (action === 'RESTRUCTURE_DRAFT' && textSimilarity(output.body, current) >= 0.985) {
    throw new Error('重构结果与原文几乎一致。重构必须重新组织结构、段落顺序或叙事路径。');
  }
}

function assertNoUnresolvedClaimInBody(output, action, safetyContext) {
  if (isSourceBasedRewriteAction(action)) return [];
  const claimsInBody = unresolvedClaims(safetyContext?.researchContext)
    .filter((claim) => includesUnresolvedClaim(output.body, [claim]));
  return claimsInBody;
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
  const kind = ['DRAFT', 'OPINION', 'EXPERIENCE', 'REFERENCE'].includes(rawKind) ? rawKind : null;
  const content = String(material?.body ?? material?.content ?? '').trim();
  if (!kind || !content) return null;
  return { id: String(material.id), kind, content };
}

function supportingMaterialView(material) {
  const kind = String(material?.kind ?? '').toUpperCase();
  const title = String(material?.title ?? '').trim();
  const content = String(material?.body ?? material?.content ?? material?.notes ?? '').trim();
  if (!['NOTE', 'TRANSCRIPT', 'IMAGE', 'VIDEO', 'AUDIO'].includes(kind) || (!title && !content)) return null;
  return { id: String(material.id), kind, title, content };
}

function buildWritingPacket(snapshot, preparedResearch = null) {
  const sourceBasedRewrite = isSourceBasedRewriteAction(snapshot.action);
  const research = preparedResearch ?? snapshot.researchContext ?? {};
  const verifiedFacts = Array.isArray(research.verifiedFacts) ? research.verifiedFacts : Array.isArray(research.facts) ? research.facts : [];
  const cautions = Array.isArray(research.cautions) ? research.cautions : [];
  const singleSourceFacts = verifiedFacts.filter((item) => typeof item === 'object' && item?.status === 'SINGLE_SOURCE');
  const unresolvedRecords = unresolvedClaimRecords({ cautions: [...cautions, ...singleSourceFacts] });
  const projectPlanning = snapshot.project?.planning ?? {};
  const lockedTitle = String(projectPlanning.title ?? snapshot.project?.title ?? snapshot.currentContent?.title ?? '').trim();
  if (!lockedTitle) throw new Error('项目规划缺少已确认标题。');
  // 标题是用户在规划阶段确认的主题边界，不是模型新提出的事实主张。
  // 事实门只约束模型正文新增内容，不能把用户已经确认的工作标题当作错误拦截。

  const materialCandidates = [
    ...(Array.isArray(snapshot.materials) ? snapshot.materials : []),
    ...(Array.isArray(research.userContent) ? research.userContent : []),
    ...(Array.isArray(research.materialContext?.userContent) ? research.materialContext.userContent : []),
  ];
  const authorMaterials = materialCandidates.map(authorMaterialView).filter(Boolean)
    .filter((item, index, items) => index === items.findIndex((other) => other.id === item.id));
  const supportingMaterials = materialCandidates.map(supportingMaterialView).filter(Boolean)
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
  const coreMessageCandidate = String(snapshot.brief?.coreMessage ?? projectPlanning.coreMessage ?? snapshot.project?.coreViewpoint ?? '').trim();
  const safeCoreMessage = !sourceBasedRewrite && includesUnresolvedClaim(coreMessageCandidate, unresolvedRecords.map((item) => item.claim))
    ? ''
    : coreMessageCandidate;

  return {
    projectId: String(snapshot.projectId ?? snapshot.project?.id ?? ''),
    platform: snapshot.platform,
    lockedTitle,
    subject: String(projectPlanning.category ?? snapshot.project?.category ?? '').trim(),
    contentType: String(snapshot.brief?.contentType ?? snapshot.project?.contentType ?? '图文内容').trim(),
    audience: String(snapshot.brief?.targetAudience ?? projectPlanning.targetAudience ?? '').trim(),
    objective: String(snapshot.brief?.objective ?? projectPlanning.objective ?? '').trim(),
    coreMessage: safeCoreMessage,
    targetLength: String(snapshot.brief?.lengthTarget ?? '').trim(),
    platformRules: PLATFORM_WRITING_RULES[snapshot.platform] ?? [],
    accountVoice,
    articleTone: String(snapshot.brief?.notes ?? snapshot.accountVoice?.offset ?? '').trim(),
    skillInstructions,
    authorMaterials,
    supportingMaterials,
    verifiedClaims,
    unresolvedClaims: unresolvedRecords,
    creativeReferences,
    forbiddenClaims: unresolvedRecords.map((item) => item.claim),
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
      'authorMaterials 是正文的主要内容依据；supportingMaterials 包含视频拉片、转写、图片与其他素材说明，必须共同用于理解主题、事实、场景和文章结构。',
      'verifiedClaims 是已完成核验的外部事实；authorMaterials 中的 REFERENCE 是用户主动提供的来源正文，只能依据来源原文表达，不得凭空扩写来源没有的具体事实。',
      'forbiddenClaims 不得写成确定事实，也不得借助模型已有知识补写具体日期、数字、引语、人物经历或产品能力。',
      '遵守平台规则、账号声音、本篇语气和 Skill 指令；避免套话、虚假权威、夸张承诺、生硬互动和 AI 模板感。',
      '成稿必须完整，不得留下待补充、待核验、建议修改或下一步处理等内部工作痕迹。',
    ].join('\n'),
    message: JSON.stringify({ businessTemplate, writingPacket: packet }),
    enableThinking: true,
    contentFormat: 'text',
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

function parseFinishedCopyBody(content, packet, action = 'GENERATE_DRAFT', safetyContext = {}) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回完整正文。');
  const rawBody = content.trim();
  if (/```/.test(rawBody)) throw new Error('正文包含代码围栏，不能保存。');
  if (/^\s*[\[{]/.test(rawBody)) throw new Error('正文返回了结构化对象，不能保存。');
  if (/(qualityReview|factsToVerify|changeSummary|writingPacket|system prompt|系统提示词)/i.test(rawBody)) throw new Error('正文泄漏了内部字段，不能保存。');
  const body = normalizeFinishedCopyBody(rawBody, packet);
  if (body.length < 80) throw new Error('模型返回的正文不完整。');
  if (body.length > 30_000) throw new Error('模型返回的正文超过可保存长度。');
  const output = { title: packet.lockedTitle, body, factsToVerify: [] };
  // 事实边界记录为待核验项，不阻断正文生成；润色、扩写、压缩等动作沿用原文核验清单。
  output.factsToVerify = assertNoUnresolvedClaimInBody(output, action, safetyContext);
  return output;
}

function copyTitleFromContext(safetyContext = {}) {
  return String(
    safetyContext.lockedTitle
      ?? safetyContext.project?.planning?.title
      ?? safetyContext.project?.title
      ?? safetyContext.currentContent?.title
      ?? '',
  ).trim();
}

function revisionChangeSummary(action) {
  return {
    POLISH_EXISTING_DRAFT: '优化措辞、句子节奏和段落衔接，保留原有事实边界。',
    RESTRUCTURE_DRAFT: '重新生成正文，建立新的文章结构和叙事路径。',
    EXPAND_DRAFT: '在已有事实边界内补充解释、论证和阅读场景。',
    SHORTEN_DRAFT: '删除重复表达并压缩篇幅，保留核心判断和必要事实。',
    REVISE_SELECTION: '按选区要求重写正文片段，并保持上下文边界。',
    ADAPT_PLATFORM: '按目标平台表达规则重写正文。',
  }[action] ?? '完成正文修改。';
}

function parseRevisionCopyBody(content, action, safetyContext = {}) {
  if (/^\s*(?:标题|变更说明|正文|待核验)\s*[:：]/mu.test(String(content ?? ''))) {
    throw new Error('修改正文必须只输出正文纯文本，不得输出标题、变更说明或待核验字段。');
  }
  const lockedTitle = copyTitleFromContext(safetyContext);
  if (!lockedTitle) throw new Error('正文任务缺少已确认标题。');
  const output = parseFinishedCopyBody(content, { lockedTitle }, action, safetyContext);
  if (isSourceBasedRewriteAction(action)) {
    output.factsToVerify = mergeFactsToVerify(safetyContext.currentContent?.factsToVerify ?? [], output.factsToVerify);
  }
  assertRevisionChanged(output, action, safetyContext);
  return { ...output, changeSummary: revisionChangeSummary(action) };
}

function copyMaxTokensForLength(lengthTarget) {
  const numbers = String(lengthTarget ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const targetCharacters = numbers.length ? Math.max(...numbers) : 1_500;
  return Math.max(1_800, Math.min(12_000, Math.ceil(targetCharacters * 2)));
}

function actionRevisionRule(action) {
  if (action === 'POLISH_EXISTING_DRAFT') return '本次是润色：保留原有事实、主旨和大体结构，但必须改善措辞、句子节奏、衔接和表达清晰度；不得原样返回当前正文。';
  if (action === 'EXPAND_DRAFT') return '本次是扩写：在事实边界内补充解释、论证层次、读者场景或已有案例细节，正文必须明显比当前正文更充分；不得原样返回当前正文。';
  if (action === 'SHORTEN_DRAFT') return '本次是压缩：删除重复铺陈、合并近似段落、保留核心观点和必要事实，正文必须明显更短更集中；不得原样返回当前正文。';
  if (action === 'RESTRUCTURE_DRAFT') return '本次是重构：按项目主题、Brief、研究结果和 Skill 重新生成一篇完整正文，不是对当前正文做局部改写；不得读取、引用或沿用当前正文的段落、事实表达和叙事路径。';
  if (action === 'REVISE_SELECTION') return '本次只修改用户选中的正文片段：保持未选中内容的上下文边界，输出完整候选正文，但选区必须有明确变化。';
  return '严格执行本次动作，不得原样返回当前正文。';
}

function buildCopyPrompt(snapshot) {
  const sourceBasedRewrite = isSourceBasedRewriteAction(snapshot.action);
  const businessTemplate = snapshot.action === 'GENERATE_OUTLINE' || snapshot.action === 'GENERATE_DRAFT'
    ? String(snapshot.template ?? '').trim()
    : validateRevisionTemplate(snapshot.template ?? defaultRevisionTemplate(snapshot.platform));
  if (!businessTemplate) throw new Error('文案动作提示词不能为空。');
  const researchFacts = Array.isArray(snapshot.researchContext?.verifiedFacts) ? snapshot.researchContext.verifiedFacts : Array.isArray(snapshot.researchContext?.facts) ? snapshot.researchContext.facts : [];
  const singleSourceFacts = researchFacts.filter((item) => typeof item === 'object' && item?.status === 'SINGLE_SOURCE');
  const cautionInput = { cautions: [...(snapshot.researchContext?.cautions ?? []), ...singleSourceFacts] };
  const cautions = unresolvedClaims(cautionInput);
  const cautionRecords = unresolvedClaimRecords(cautionInput);
  const cautionBoundaryRule = !sourceBasedRewrite && cautions.length
    ? `待复核主张禁止写入区：${cautions.map((claim, index) => `${index + 1}. ${claim}`).join('；')}。这些内容不得出现在正文中，也不得换词解释、推演、举例或以“通常”“可能”“待官方确认”等方式继续展开；只能原样保留在 factsToVerify。若它是项目的重要信息缺口，就把文章改为基于已核验事实的阅读判断，不要补写技术背景。`
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
  const outputFormat = snapshot.action === 'GENERATE_OUTLINE'
    ? [
      '只输出纯文本，固定格式如下：',
      '标题候选：',
      '- 标题一',
      '- 标题二',
      '',
      '摘要：',
      '一段简短摘要。',
      '',
      '章节：',
      '1. 章节标题',
      '目的：这一节要完成什么。',
      '要点：',
      '- 要点一',
      '- 要点二',
      '',
      '待核验：',
      '- 事实一',
      '- 事实二',
      '如果没有待核验事项，写“无”。',
    ] : [];
  const effectiveOutputFormat = snapshot.action === 'GENERATE_OUTLINE'
    ? outputFormat
    : [
      '只输出最终正文纯文本，不输出标题、变更说明、待核验列表、JSON、字段名或解释。',
      '服务端会锁定标题并根据正文实际内容计算变更说明与待核验项。',
    ];
  const safeResearchContext = sourceBasedRewrite
    ? { verifiedFacts: [], cautions: [] }
    : {
      verifiedFacts: (Array.isArray(snapshot.researchContext?.verifiedFacts) ? snapshot.researchContext.verifiedFacts : Array.isArray(snapshot.researchContext?.facts) ? snapshot.researchContext.facts : [])
        .map((item, index) => ({
          id: String(typeof item === 'object' && item?.id ? item.id : `verified-claim-${index + 1}`),
          claim: String(typeof item === 'string' ? item : item?.claim ?? '').trim(),
          status: String(typeof item === 'object' && item?.status ? item.status : 'VERIFIED'),
          sourceIds: evidenceSourceIds(item),
        }))
        .filter((item) => item.claim && item.status === 'VERIFIED'),
      cautions: cautionRecords.map(({ id, claim, status }) => ({ id, claim, status })),
    };
  const safetyRules = sourceBasedRewrite
    ? [
      '本次是基于原文的改写动作：以当前正文为事实基线，只执行已确认的润色、扩写、压缩、选区改写或平台适配，不重新研究、复核或判断原文事实，也不要因为研究上下文中的待核验清单阻断改写。',
      '不得凭空新增当前正文没有的具体日期、单位、人数、引语、产品能力或其他事实；只能在保持原意的前提下完成用户要求的表达变换，服务端会继承原文的 factsToVerify。',
    ]
    : [
      '研究上下文中的 verifiedFacts 是唯一可以作为已确认客观事实写入正文的研究结论；cautions 不能改写成确定事实。',
      '不得写入未出现在 verifiedFacts 中的具体日期、单位、人数、引语、会议或产品能力。factsToVerify 与 cautions 中的内容不能被包装为确定事实。',
      ...(snapshot.action === 'RESTRUCTURE_DRAFT'
        ? ['没有 verifiedFacts 时，只能依据用户材料或观点方法重新生成，禁止补充伪具体事实。']
        : ['没有 verifiedFacts 时，只能依据用户材料、当前正文或观点方法写作，禁止补充伪具体事实。']),
      ...(cautionBoundaryRule ? [cautionBoundaryRule] : []),
      'factsToVerify 只列本次候选正文仍直接涉及的待核验事实；不得回填项目历史核验池中的无关条目。保留的待核验事实不得被删掉、弱化或改写为已确认事实。',
    ];
  const system = [
    '你是内容项目的文案编辑，只执行已经确认的单一动作。',
    `本次动作是 ${snapshot.action}，目标平台是 ${snapshot.platform}。`,
    actionRevisionRule(snapshot.action),
    '项目标题、核心观点和目标平台是硬主题边界：文章主体必须服务项目主题、核心观点与平台表达规则。不得用研究资料中的单条事件替换项目主题；与主题不一致的资料只能作为背景，或不使用。',
    ...(sourceBasedRewrite
      ? ['严格依据项目资料、当前正文、选区、内容母版、阶段摘要和 Skill 工作，不得编造数据、引语、来源或人物经历。']
      : ['严格依据项目资料、Writing Brief、研究结果、来源正文、阶段摘要和 Skill 工作重新生成，不得读取当前正文、选区或旧内容母版作为改写底稿。']),
    ...safetyRules,
    ...platformQualityRules,
    '输出前自行检查：标题与正文是否仍服务项目主题；是否有无法追溯的具体事实；是否存在空泛套话或 Markdown 标记。发现任一问题就重写后再输出。',
    ...effectiveOutputFormat,
  ].join('\n');
  const message = JSON.stringify({
    businessTemplate,
    action: snapshot.action,
    request: snapshot.request,
    platform: snapshot.platform,
    project: safeProjectContext(snapshot.project, sourceBasedRewrite ? [] : cautions),
    writingBrief: safeWritingBrief(snapshot.brief, sourceBasedRewrite ? [] : cautions),
    accountVoice: snapshot.accountVoice ? {
      name: snapshot.accountVoice.name,
      version: snapshot.accountVoice.version,
      offset: snapshot.accountVoice.offset,
      rules: snapshot.accountVoice.rules,
    } : null,
    currentContent: sourceBasedRewrite ? (snapshot.currentContent ?? null) : null,
    selection: sourceBasedRewrite ? (snapshot.selection ?? null) : null,
    contentMaster: sourceBasedRewrite ? (snapshot.contentMaster ?? null) : null,
    summaries: snapshot.summaries ?? [],
    skills: (snapshot.skills ?? []).map((skill) => ({
      dimension: skill.dimension,
      name: skill.name,
      version: skill.version?.version,
      instructions: skill.version?.instructions,
    })),
    materials: snapshot.materials ?? [],
    researchContext: safeResearchContext,
  });
  return { system, message, enableThinking: true, contentFormat: 'text' };
}

module.exports = {
  WECHAT_COPY_GENERATION_SCOPE,
  COPY_ACTIONS,
  REVISION_TEMPLATE_SCOPES,
  MAX_REVISION_TEMPLATE_LENGTH,
  copyActionVersion,
  copyActionScope,
  copyActionPersistenceMode,
  resolveCopyAction,
  copyTemplateScope,
  copyPromptTemplateScope,
  mergeFactsToVerify,
  reconcileFactsToVerify,
  unresolvedClaims,
  safeProjectContext,
  safeWritingBrief,
  applyAcceptedCopyToState,
  validateRevisionTemplate,
  defaultRevisionTemplate,
  buildWritingPacket,
  buildFinishedCopyPrompt,
  normalizeFinishedCopyBody,
  parseFinishedCopyBody,
  parseRevisionCopyBody,
  copyMaxTokensForLength,
  buildCopyPrompt,
};
