export const VISUAL_PLAN_VERSION = 4;

const platformLabels = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
  ZHIHU: '知乎',
  WEIBO: '微博',
};

const stopWords = new Set([
  '一个', '一些', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '自己', '已经', '还是', '可以', '可能',
  '如何', '为什么', '什么', '没有', '不是', '就是', '进行', '通过', '关于', '以及', '其中', '目前', '今天', '现在',
  '成功', '正式', '首次', '最新', '消息', '新闻', '内容', '文章', '观点', '问题', '我国', '中国',
  '一代', '能力', '提升', '承担', '之间', '送入', '关注', '重点', '实际', '后续', '预定',
]);

const commonConcepts = [
  '中继卫星', '运载火箭', '航天器测控', '数据传输', '数据中继', '卫星发射', '卫星通信', '地面站', '空间站',
  '人工智能', '生成式AI', '大语言模型', '大模型', '自动驾驶', '新能源汽车', '科技创新',
  '资本市场', '货币政策', '股票市场', '上市公司', '电子商务', '国际关系', '社会治理',
  '传统文化', '历史人物', '体育赛事', '影视作品', '公共卫生', '医疗健康', '教育改革',
];

const semanticConceptRules = [
  [/组网/, '卫星组网'], [/测控.*覆盖|覆盖.*测控/, '测控覆盖'], [/工作原理|运行原理|机制/, '工作原理'],
  [/应用|服务能力|使用场景/, '应用场景'], [/天地通信|卫星通信/, '卫星通信'], [/数据.*转发|转发.*数据/, '数据转发'],
  [/空间实验|实验舱|空间站/, '空间实验室'], [/政策/, '政策机制'], [/产业链/, '产业链'], [/供应链/, '供应链'],
  [/增长|下降|变化趋势|同比|环比/, '变化趋势'], [/影响|作用|意义/, '影响关系'], [/流程|步骤|路径/, '工作流程'],
];

const visualTypeLabels = {
  NEWS_PHOTO: '新闻资料图',
  HERO_VISUAL: '人物或物品主视觉',
  CONCEPT_DIAGRAM: '概念示意图',
  SCENE: '场景图',
  MIND_MAP: '思维导图',
  FLOWCHART: '流程图',
  TIMELINE: '时间线',
  COMPARISON: '对比图',
  DATA_CHART: '数据图',
  QUOTE_CARD: '引语卡片',
  INFO_CARD: '信息卡片',
  CHECKLIST_CARD: '清单卡片',
};

const stylePresets = [
  { id: 'FRESH_EDITORIAL', name: '清新杂志', prompt: '清新杂志风格，明亮自然的综合色彩，中文编辑设计感，留白充足，层级克制' },
  { id: 'RETRO_POP', name: '波普怀旧', prompt: '波普怀旧风格，复古印刷质感，马卡龙撞色，几何色块与轻颗粒纹理，清新而不厚重' },
  { id: 'MINIMAL_KNOWLEDGE', name: '极简知识图', prompt: '极简知识图风格，中性底色，少量强调色，结构线清楚，信息密度高但不拥挤' },
  { id: 'TECH_MEDIA', name: '科技媒体', prompt: '科技媒体风格，冷暖综合色彩，精确网格与简洁数据元素，专业但不使用夸张霓虹光效' },
  { id: 'DOCUMENTARY', name: '纪实报道', prompt: '纪实报道风格，自然光与真实材质，低修饰，克制色彩，不摆拍、不伪造新闻现场' },
];

const visualTemplates = {
  NEWS_PHOTO: [{ id: 'EDITORIAL_CROP', name: '编辑裁切', prompt: '编辑式主体裁切，保留标题安全区' }],
  HERO_VISUAL: [{ id: 'SUBJECT_FOCUS', name: '主体聚焦', prompt: '单一主体聚焦，背景克制，视觉中心明确' }],
  SCENE: [
    { id: 'WIDE_CONTEXT', name: '环境叙事', prompt: '用完整环境交代人物、动作和使用情境' },
    { id: 'CLOSE_ACTION', name: '动作特写', prompt: '聚焦手部、工具或关键动作，背景只保留必要信息' },
  ],
  CONCEPT_DIAGRAM: [{ id: 'RELATION_NETWORK', name: '关系网络', prompt: '中心概念与关联对象通过清晰连线组成关系网络' }],
  MIND_MAP: [
    { id: 'RADIAL_BRANCH', name: '放射分支', prompt: '中心主题向四周展开一级分支，分支层级清晰' },
    { id: 'TREE_BRANCH', name: '树状分支', prompt: '从上到下的树状层级，父子关系明确' },
  ],
  FLOWCHART: [
    { id: 'VERTICAL_STEPS', name: '纵向步骤', prompt: '步骤自上而下排列，用箭头连接，适合手机阅读' },
    { id: 'HORIZONTAL_PROCESS', name: '横向流程', prompt: '步骤从左到右推进，阶段边界清楚' },
  ],
  TIMELINE: [{ id: 'HORIZONTAL_TIMELINE', name: '横向时间线', prompt: '时间节点从左到右排列，年份与事件一一对应' }],
  COMPARISON: [{ id: 'SPLIT_COMPARE', name: '左右对比', prompt: '左右两栏使用相同信息层级，对比项逐行对齐' }],
  DATA_CHART: [{ id: 'EDITORIAL_CHART', name: '编辑图表', prompt: '使用与数据关系匹配的简洁图表，标注单位与来源位置' }],
  QUOTE_CARD: [{ id: 'QUOTE_FOCUS', name: '观点聚焦', prompt: '引语为视觉中心，出处紧邻引语且层级更低' }],
  INFO_CARD: [{ id: 'MODULAR_SUMMARY', name: '模块摘要', prompt: '结论优先，信息点分成独立模块并按阅读顺序排列' }],
  CHECKLIST_CARD: [{ id: 'NUMBERED_CHECKLIST', name: '编号清单', prompt: '行动项使用醒目编号，逐项对齐并保留勾选视觉' }],
};

export function visualStylePresets() {
  return stylePresets.map((item) => ({ ...item }));
}

export function visualTemplatesFor(type) {
  return (visualTemplates[type] ?? visualTemplates.SCENE).map((item) => ({ ...item }));
}

function clean(value) {
  return String(value ?? '').replace(/[#>*_`~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function conceptsFrom(value) {
  const text = clean(value);
  return unique([
    ...commonConcepts.filter((concept) => text.toLowerCase().includes(concept.toLowerCase())),
    ...semanticConceptRules.filter(([pattern]) => pattern.test(text)).map(([, concept]) => concept),
  ]);
}

function subjectFromTitle(title) {
  const headline = clean(title).split(/[：:｜|]/)[0].replace(/[，。！？,.!?]+$/g, '');
  const stripped = headline
    .replace(/^(我国|中国)?(?:成功|正式|首次|最新)?(?:完成|实现|发布|推出|发射|上线|宣布|启动|举行)/, '')
    .replace(/(?:成功)?(?:发射|发布|推出|上线|启动|建成|开放|收购|突破|上映)(?:成功)?$/, '')
    .trim();
  return (stripped.length >= 3 ? stripped : headline).slice(0, 24);
}

function termsFrom(value, limit = 6) {
  const text = clean(value);
  const quoted = [...text.matchAll(/[《“「『](.{2,18}?)[》”」』]/g)].map((match) => match[1]);
  const technical = text.match(/[A-Za-z][A-Za-z0-9+_.-]{1,24}|[\u4e00-\u9fff]{2,8}\d{1,4}[\u4e00-\u9fff]{0,2}/g) ?? [];
  const segmented = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    for (const item of segmenter.segment(text)) {
      const word = clean(item.segment);
      if (item.isWordLike && word.length >= 2 && word.length <= 12) segmented.push(word);
    }
  }
  const candidates = unique([...conceptsFrom(text), ...quoted, ...technical, ...segmented])
    .filter((word) => !stopWords.has(word) && !/^\d+$/.test(word) && !/[，。！？；：,.!?;:]/.test(word));
  return candidates
    .filter((word) => word.length > 4 || !candidates.some((other) => other !== word && other.length > word.length && other.includes(word)))
    .sort((left, right) => conceptsFrom(text).includes(left) === conceptsFrom(text).includes(right) ? right.length - left.length : conceptsFrom(text).includes(left) ? -1 : 1)
    .slice(0, limit);
}

function contentSections(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const sections = [];
  let heading = '';
  let paragraph = [];
  const flush = () => {
    const text = clean([...heading ? [heading] : [], ...paragraph].join(' '));
    if (text.length >= 12) sections.push(text);
    heading = '';
    paragraph = [];
  };
  for (const rawLine of lines) {
    const line = clean(rawLine.replace(/^#{1,6}\s*/, ''));
    if (!line) { flush(); continue; }
    const isHeading = rawLine.trim().startsWith('#') || (line.length <= 26 && !/[。！？]$/.test(line));
    if (isHeading && paragraph.length) flush();
    if (isHeading) heading = line;
    else paragraph.push(line);
  }
  flush();
  return unique(sections);
}

function bodyCandidates(body, subject, coreMessage) {
  const sections = contentSections(body);
  const clauses = sections.flatMap((section) => section.split(/[。！？；]/).map(clean).filter((item) => item.length >= 12));
  return unique([...sections, ...clauses, coreMessage, subject]);
}

function sizeFor(platform, role) {
  if (platform === 'XIAOHONGSHU') return '3:4';
  if (platform === 'WEIBO') return '1:1';
  if (role === 'BODY') return '4:3';
  return '16:9';
}

function visualStyle(platform, role) {
  if (platform === 'XIAOHONGSHU') return role === 'COVER'
    ? '清爽的小红书封面视觉，主体明确，构图有记忆点，顶部和中部保留后期标题区域'
    : '清爽的知识图文卡片视觉，单页只表达一个重点，层级清楚，保留后期排字区域';
  if (platform === 'WEIBO') return '适合微博信息流的方形主视觉，主体突出，缩略图状态仍容易识别';
  if (role === 'COVER') return '克制的中文媒体封面风格，主体突出，横向构图，左侧或上方保留标题区域';
  return '克制的中文媒体正文插图风格，画面服务当前段落，不重复封面画面';
}

function stylePrompt(stylePreset, styleProfile = { preset: 'FRESH_EDITORIAL' }) {
  const resolved = stylePreset && stylePreset !== 'INHERIT' ? stylePreset : styleProfile?.preset ?? 'FRESH_EDITORIAL';
  return stylePresets.find((item) => item.id === resolved)?.prompt ?? stylePresets[0].prompt;
}

function templateFor(type, templatePreset) {
  const templates = visualTemplatesFor(type);
  return templates.find((item) => item.id === templatePreset) ?? templates[0];
}

function visualTypeFor(section, role, platform) {
  if (role === 'COVER' || role === 'MAIN') return /发射|发布|启动|开幕|获奖|夺冠|上映/.test(section) ? 'NEWS_PHOTO' : 'SCENE';
  const years = section.match(/(?:19|20)\d{2}\s*年?/g) ?? [];
  if (years.length >= 2) return 'TIMELINE';
  if (/对比|相比|前者|后者|传统.+(?:新|智能)|(?:方案|方式)\s*[ABＡＢ]/i.test(section)) return 'COMPARISON';
  if (/步骤|流程|路径|第一步|先.+(?:再|然后).+(?:最后|最终)/.test(section)) return 'FLOWCHART';
  if (/组成|分为|分类|体系|模块.+构成|包括.+(?:以及|和|、)/.test(section)) return 'MIND_MAP';
  if (/\d+(?:\.\d+)?(?:%|万|亿|元|倍|人|家|项)|同比|环比/.test(section)) return 'DATA_CHART';
  if (/原理|机制|关系|流程|链路|中继|测控|组网|覆盖/.test(section)) return 'CONCEPT_DIAGRAM';
  if (/引述|表示|认为|说[:：]/.test(section)) return 'QUOTE_CARD';
  if (/清单|要点|注意事项|检查项/.test(section)) return 'CHECKLIST_CARD';
  if (platform === 'XIAOHONGSHU') return 'INFO_CARD';
  return 'SCENE';
}

function defaultGenerationMode(role, visualType) {
  return role === 'CARD' || ['CONCEPT_DIAGRAM', 'MIND_MAP', 'FLOWCHART', 'TIMELINE', 'COMPARISON', 'DATA_CHART', 'QUOTE_CARD', 'INFO_CARD', 'CHECKLIST_CARD'].includes(visualType) ? 'INFOGRAPHIC' : 'ILLUSTRATION';
}

function informationPointsFor(section, focus, purpose) {
  const clauses = clean(section).split(/[。！？；]/).map(clean).filter((item) => item.length >= 6).map((item) => item.slice(0, 72));
  const focusPoints = clean(focus).split(/[、，]/).map(clean).filter(Boolean).map((item) => `重点理解：${item}`);
  return unique([...clauses, ...focusPoints, clean(purpose)]).slice(0, 5);
}

function contentBlocksFor(type, section, focus, purpose) {
  const text = clean(section);
  const clauses = unique(text.split(/[。！？；]/).flatMap((part) => part.split(/(?:，|、|：)/)).map(clean).filter((item) => item.length >= 2 && item.length <= 88));
  if (type === 'TIMELINE') {
    const events = [...text.matchAll(/((?:19|20)\d{2})\s*年?([^，。；]*)/g)].map((match) => ({ label: match[1], detail: clean(match[2]) || '阶段节点' }));
    if (events.length >= 2) return events.slice(0, 6);
  }
  if (type === 'COMPARISON') {
    const sides = text.split(/[；。]/).map(clean).filter(Boolean);
    if (sides.length >= 2) return sides.slice(0, 2).map((detail, index) => ({ label: index ? '方案 B' : '方案 A', detail }));
    const beforeAfter = text.split(/(?:前者|后者)/).map(clean).filter(Boolean);
    if (beforeAfter.length >= 2) return beforeAfter.slice(-2).map((detail, index) => ({ label: index ? '方案 B' : '方案 A', detail }));
  }
  if (type === 'MIND_MAP') {
    const branches = unique([...conceptsFrom(text), ...termsFrom(text, 8), ...clauses]).slice(0, 5);
    return [{ label: '中心主题', detail: clean(focus) }, ...branches.map((detail, index) => ({ label: `分支 ${index + 1}`, detail }))].slice(0, 6);
  }
  if (type === 'FLOWCHART' || type === 'CHECKLIST_CARD') {
    const normalized = text.replace(/(?:第一步|首先|先)/g, '§').replace(/(?:第二步|其次|再)/g, '§').replace(/(?:第三步|然后|接着)/g, '§').replace(/(?:第四步|最后|最终)/g, '§');
    const steps = unique(normalized.split('§').map(clean).filter((item) => item.length >= 2));
    const values = steps.length >= 2 ? steps : clauses;
    return values.slice(0, 6).map((detail, index) => ({ label: `步骤 ${index + 1}`, detail }));
  }
  const points = informationPointsFor(text, focus, purpose);
  return points.map((detail, index) => ({ label: `要点 ${index + 1}`, detail }));
}

function referenceInstruction(references = []) {
  if (!references.length) return '';
  const labels = { COLOR: '色彩', COMPOSITION: '构图', LAYOUT: '排版', TEXTURE: '质感', SUBJECT: '人物或主体特征' };
  const uses = unique(references.flatMap((item) => item.uses ?? []).map((use) => labels[use] ?? ''));
  return uses.length ? `参考图只用于参考${uses.join('、')}，不要照搬其中的文字、标识或完整画面。` : '';
}

function structureInstruction(item) {
  const blocks = (item.contentBlocks ?? []).filter((block) => clean(block.label) && clean(block.detail));
  if (!blocks.length) return '';
  return `结构内容：${blocks.map((block) => `${clean(block.label)}：${clean(block.detail)}`).join('；')}。`;
}

function infographicStyle(platform) {
  if (platform === 'XIAOHONGSHU') return '3:4 竖版高密度知识卡片，适配手机阅读，标题醒目，信息模块自上而下，重点色块清晰，四周留出安全边距';
  if (platform === 'WEIBO') return '1:1 方形信息图，标题与核心结论在缩略图状态仍清晰可读，信息不超过四组';
  if (platform === 'ZHIHU') return '4:3 横版知识图解，理性克制，先结论后解释，适合正文阅读';
  return '公众号正文横版信息图，中文编辑设计感，标题、核心结论与信息点层级清楚，留白充足，适合手机长文阅读';
}

export function buildVisualGenerationSpec(item, context, mode = item.generationMode ?? defaultGenerationMode(item.role, item.visualType), styleProfile = { preset: 'FRESH_EDITORIAL' }) {
  const platform = context.platform;
  const title = clean(context.title) || '未命名内容';
  const platformLabel = platformLabels[platform] ?? '图文平台';
  const roleLabel = item.role === 'COVER' ? '封面' : item.role === 'CARD' ? '图文卡片' : item.role === 'MAIN' ? '主图' : '正文插图';
  const avoid = item.avoidConcepts.length ? `不要重复表现：${item.avoidConcepts.join('、')}。` : '';
  const style = stylePrompt(item.stylePreset, styleProfile);
  const template = templateFor(item.visualType, item.templatePreset);
  const structure = structureInstruction(item);
  const reference = referenceInstruction(item.references);
  if (mode === 'INFOGRAPHIC') {
    const headline = item.role === 'COVER' || item.role === 'MAIN' ? title : clean(item.focus).replace(/、/g, '与');
    const points = (item.informationPoints?.length ? item.informationPoints : informationPointsFor(item.purpose, item.focus, item.purpose)).slice(0, 5);
    const pointText = points.map((point, index) => `${index + 1}. ${point}`).join('；');
    return {
      generationMode: mode,
      prompt: `为${platformLabel}内容《${title}》制作一张${roleLabel}${visualTypeLabels[item.visualType]}。视觉风格：${style}。版式模板：${template.name}，${template.prompt}。${structure}请在图片内准确生成简体中文，并严格使用以下文案：主标题：${headline}；核心结论：${item.purpose}；信息点：${pointText}。平台版式：${infographicStyle(platform)}；阅读顺序明确，字号清晰，留白充足。${reference}${avoid}不得自行添加数据、机构、人物引语或未经正文支持的结论；涉及新闻事件时不伪造新闻现场，不虚构具体机构标识。`,
      negativePrompt: unique(['错别字', '乱码', '拼写错误', '文字变形', '信息拥挤', '层级混乱', '水印', 'Logo', '二维码', '低清晰度', ...item.avoidConcepts]).join('、'),
    };
  }
  return {
    generationMode: mode,
    prompt: `为${platformLabel}内容《${title}》制作一张${roleLabel}${visualTypeLabels[item.visualType]}。视觉风格：${style}。版式模板：${template.name}，${template.prompt}。核心画面：${item.focus}。表达目的：${item.purpose}。${structure}${visualStyle(platform, item.role)}。${reference}${avoid}画面真实、准确、干净，细节清晰；只生成视觉素材，不在图片内生成文字、Logo、二维码或水印。涉及新闻事件时采用概念视觉，不伪造新闻现场，不虚构具体机构标识。`,
    negativePrompt: unique(['文字', '水印', 'Logo', '二维码', '低清晰度', '错误标识', '畸形结构', '夸张光效', ...item.avoidConcepts]).join('、'),
  };
}

export function updateVisualPlanItem(item, patch, context, styleProfile = { preset: 'FRESH_EDITORIAL' }) {
  const visualType = patch.visualType ?? item.visualType;
  const typeChanged = patch.visualType && patch.visualType !== item.visualType;
  const next = {
    ...item,
    ...patch,
    visualType,
    generationMode: patch.generationMode ?? (typeChanged ? defaultGenerationMode(item.role, visualType) : item.generationMode),
    stylePreset: patch.stylePreset ?? item.stylePreset ?? 'INHERIT',
    templatePreset: patch.templatePreset ?? (typeChanged ? visualTemplatesFor(visualType)[0].id : item.templatePreset ?? visualTemplatesFor(visualType)[0].id),
    sourceExcerpt: patch.sourceExcerpt ?? item.sourceExcerpt ?? '',
    contentBlocks: patch.contentBlocks ?? item.contentBlocks ?? contentBlocksFor(visualType, item.sourceExcerpt ?? item.purpose, item.focus, item.purpose),
    references: patch.references ?? item.references ?? [],
  };
  return { ...next, ...buildVisualGenerationSpec(next, context, next.generationMode, styleProfile) };
}

function searchQueriesFor({ title, focus, category, role, visualType }) {
  const subject = subjectFromTitle(title);
  const focusTerms = termsFrom(focus, 8).filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const titleTerms = termsFrom(title, 6).filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const action = title.match(/发射|发布|推出|上线|启动|建成|开放|收购|增长|下降|突破|获奖|夺冠|上映/)?.[0];
  const location = /^(我国|中国)/.test(clean(title)) ? '中国' : '';
  if (role === 'COVER' || role === 'MAIN') {
    return unique([
      unique([subject, action ?? '']).slice(0, 2).join(' '),
      unique([location, subject, ...titleTerms]).slice(0, 3).join(' '),
      unique([category, subject, '主题图片']).slice(0, 3).join(' '),
    ]).filter((query) => query.length >= 2 && query.length <= 60).slice(0, 3);
  }
  const typeSuffix = visualType === 'CONCEPT_DIAGRAM' ? '工作原理' : visualType === 'DATA_CHART' ? '数据图表' : visualType === 'INFO_CARD' ? '知识图解' : '应用场景';
  const primaryTerms = unique(focusTerms).slice(0, 2);
  return unique([
    unique([...primaryTerms, typeSuffix]).slice(0, 3).join(' '),
    unique([focusTerms[0], focusTerms[2], visualType === 'CONCEPT_DIAGRAM' ? '关系示意' : '真实场景']).slice(0, 3).join(' '),
    unique([subject, focusTerms[0], category]).slice(0, 3).join(' '),
  ]).filter((query) => query.length >= 2 && query.length <= 60).slice(0, 3);
}

export function visualPlanCountRange(platform) {
  if (platform === 'WEIBO') return { min: 0, max: 1 };
  if (platform === 'XIAOHONGSHU') return { min: 5, max: 8 };
  if (platform === 'ZHIHU') return { min: 2, max: 4 };
  return { min: 2, max: 5 };
}

function desiredItemCount(platform, body, requestedBodyItemCount) {
  const length = clean(body).length;
  const range = visualPlanCountRange(platform);
  const recommended = platform === 'WEIBO'
    ? 1
    : platform === 'XIAOHONGSHU'
      ? 5 + Math.floor(length / 900)
      : 2 + Math.floor(length / 1200);
  const requested = Number.isFinite(requestedBodyItemCount) ? Math.round(requestedBodyItemCount) : recommended;
  const bodyItemCount = Math.max(range.min, Math.min(range.max, requested));
  return platform === 'WEIBO' ? bodyItemCount : bodyItemCount + 1;
}

function focusFor(section, subject, usedConcepts, index) {
  const candidates = unique([...conceptsFrom(section), ...termsFrom(section, 8)])
    .filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const fresh = candidates.filter((term) => !usedConcepts.has(term));
  const selected = (fresh.length ? fresh : usedConcepts.size ? [] : candidates).slice(0, 3);
  if (selected.length) return selected.join('、');
  return unique([subject, ['工作原理', '应用场景', '影响关系', '发展趋势'][index % 4]]).join('、');
}

export function buildVisualPlan(input, platform, options = {}) {
  const title = clean(input?.title) || '未命名内容';
  const body = String(input?.body ?? '');
  const category = clean(input?.category);
  const coreMessage = clean(input?.coreMessage);
  const subject = subjectFromTitle(title);
  const count = desiredItemCount(platform, body, options.bodyItemCount);
  const plan = [];
  const coverRole = platform === 'WEIBO' ? 'MAIN' : 'COVER';
  const coverPurpose = platform === 'WEIBO' ? '在信息流中快速传达主题并吸引点击' : '概括全文主题并承担首屏识别';
  const coverFocus = unique([subject, ...conceptsFrom(coreMessage), ...termsFrom(coreMessage, 2)]).slice(0, 3).join('、') || subject;
  const coverType = visualTypeFor(title, coverRole, platform);
  const coverQueries = searchQueriesFor({ title, focus: coverFocus, category, role: coverRole, visualType: coverType });
  const coverPurposePoints = informationPointsFor(coreMessage || title, coverFocus, coverPurpose);
  const coverItem = {
    id: `${platform.toLowerCase()}-cover`, role: coverRole,
    title: coverRole === 'MAIN' ? '微博主图' : '文章封面', placement: '发布首图', purpose: coverPurpose,
    visualType: coverType, focus: coverFocus, avoidConcepts: [], searchQueries: coverQueries,
    generationMode: defaultGenerationMode(coverRole, coverType), informationPoints: coverPurposePoints,
    stylePreset: 'INHERIT', templatePreset: visualTemplatesFor(coverType)[0].id,
    sourceExcerpt: clean(coreMessage || title), contentBlocks: contentBlocksFor(coverType, coreMessage || title, coverFocus, coverPurpose), references: [],
    size: sizeFor(platform, coverRole), assetReferenceId: null,
  };
  plan.push({ ...coverItem, ...buildVisualGenerationSpec(coverItem, { platform, title }) });

  const candidates = bodyCandidates(body, subject, coreMessage);
  const usedConcepts = new Set();
  const usedPrimaryQueries = new Set(coverQueries.slice(0, 1));
  for (let index = 1; index < count; index += 1) {
    const role = platform === 'XIAOHONGSHU' ? 'CARD' : 'BODY';
    const section = candidates[Math.min(index - 1, Math.max(0, candidates.length - 1))] || coreMessage || subject;
    const focus = focusFor(section, subject, usedConcepts, index - 1);
    termsFrom(focus, 4).forEach((term) => usedConcepts.add(term));
    const visualType = visualTypeFor(section, role, platform);
    const avoidConcepts = unique([
      /发射|火箭/.test(title) ? '火箭发射现场' : '',
      ...Array.from(usedConcepts).filter((concept) => !focus.includes(concept)).slice(-2),
    ]);
    let searchQueries = searchQueriesFor({ title, focus, category, role, visualType });
    const freshQueries = searchQueries.filter((query) => !usedPrimaryQueries.has(query));
    if (freshQueries.length) searchQueries = [...freshQueries, ...searchQueries.filter((query) => !freshQueries.includes(query))];
    if (searchQueries[0]) usedPrimaryQueries.add(searchQueries[0]);
    const placement = platform === 'XIAOHONGSHU' ? `第 ${index + 1} 页` : `正文第 ${index} 个核心段落后`;
    const purpose = platform === 'XIAOHONGSHU' ? `把“${focus}”拆成一页可快速理解的视觉信息` : `解释“${focus}”，帮助读者理解这一段内容`;
    const informationPoints = informationPointsFor(section, focus, purpose);
    const item = {
      id: `${platform.toLowerCase()}-${role.toLowerCase()}-${index}`, role,
      title: platform === 'XIAOHONGSHU' ? `图文卡片 ${index}` : `正文插图 ${index}`,
      placement, purpose, visualType, focus, avoidConcepts, searchQueries,
      generationMode: defaultGenerationMode(role, visualType), informationPoints,
      stylePreset: 'INHERIT', templatePreset: visualTemplatesFor(visualType)[0].id,
      sourceExcerpt: clean(section), contentBlocks: contentBlocksFor(visualType, section, focus, purpose), references: [],
      size: sizeFor(platform, role), assetReferenceId: null,
    };
    plan.push({ ...item, ...buildVisualGenerationSpec(item, { platform, title }) });
  }
  return plan;
}

export function mergeVisualPlan(generated, persisted, legacyAssetIds = [], legacyCoverId = null, persistedVersion = 0) {
  if (Array.isArray(persisted) && persistedVersion >= VISUAL_PLAN_VERSION) return persisted;
  if (Array.isArray(persisted) && persistedVersion >= 3) {
    const persistedById = new Map(persisted.map((item) => [item.id, item]));
    return generated.map((item) => {
      const previous = persistedById.get(item.id);
      if (!previous) return item;
      const merged = {
        ...item,
        purpose: previous.purpose ?? item.purpose,
        focus: previous.focus ?? item.focus,
        avoidConcepts: previous.avoidConcepts ?? item.avoidConcepts,
        searchQueries: previous.searchQueries ?? item.searchQueries,
        informationPoints: previous.informationPoints ?? item.informationPoints,
        size: previous.size ?? item.size,
        assetReferenceId: previous.assetReferenceId ?? null,
      };
      return updateVisualPlanItem(merged, {}, { platform: item.id.split('-')[0].toUpperCase(), title: generated[0]?.sourceExcerpt || generated[0]?.focus || '未命名内容' });
    });
  }
  if (Array.isArray(persisted) && persistedVersion >= 2) {
    const persistedById = new Map(persisted.map((item) => [item.id, item]));
    return generated.map((item) => {
      const previous = persistedById.get(item.id);
      return previous ? { ...item, size: previous.size ?? item.size, assetReferenceId: previous.assetReferenceId ?? null } : item;
    });
  }
  const persistedCoverId = Array.isArray(persisted)
    ? persisted.find((item) => item.role === 'COVER' || item.role === 'MAIN')?.assetReferenceId
    : null;
  const coverId = persistedCoverId ?? legacyCoverId ?? legacyAssetIds[0] ?? null;
  return generated.map((item) => ({
    ...item,
    assetReferenceId: item.role === 'COVER' || item.role === 'MAIN' ? coverId : null,
  }));
}

export function resizeVisualPlan(generated, current = []) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return generated.map((item) => currentById.get(item.id) ?? item);
}
