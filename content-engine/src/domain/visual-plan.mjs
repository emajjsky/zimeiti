export const VISUAL_PLAN_VERSION = 2;

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
  CONCEPT_DIAGRAM: '概念示意图',
  SCENE: '场景图',
  DATA_CHART: '数据图',
  QUOTE_CARD: '引语卡片',
  INFO_CARD: '信息卡片',
};

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
  const informative = sections.filter((section) => conceptsFrom(section).some((concept) => !['卫星发射', '运载火箭'].includes(concept)) || /原理|机制|数据|应用|服务|影响|关系|趋势|流程|组网|覆盖/.test(section));
  const clauseDetails = clauses.filter((section) => /原理|机制|数据|应用|服务|影响|关系|趋势|流程|组网|覆盖|通信|测控/.test(section));
  return unique([...informative, ...clauseDetails, ...sections, coreMessage, subject]);
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

function visualTypeFor(section, role, platform) {
  if (role === 'COVER' || role === 'MAIN') return /发射|发布|启动|开幕|获奖|夺冠|上映/.test(section) ? 'NEWS_PHOTO' : 'SCENE';
  if (/\d+(?:\.\d+)?%|同比|环比|数据变化|趋势/.test(section)) return 'DATA_CHART';
  if (/原理|机制|关系|流程|链路|中继|测控|组网|覆盖/.test(section)) return 'CONCEPT_DIAGRAM';
  if (/引述|表示|认为|说[:：]/.test(section)) return 'QUOTE_CARD';
  if (platform === 'XIAOHONGSHU' || /清单|步骤|对比|要点/.test(section)) return 'INFO_CARD';
  return 'SCENE';
}

function promptFor({ platform, title, focus, role, purpose, visualType, avoidConcepts }) {
  const platformLabel = platformLabels[platform] ?? '图文平台';
  const roleLabel = role === 'COVER' ? '封面' : role === 'CARD' ? '图文卡片' : role === 'MAIN' ? '主图' : '正文插图';
  const avoid = avoidConcepts.length ? `不要重复表现：${avoidConcepts.join('、')}。` : '';
  return `为${platformLabel}内容《${title}》制作一张${roleLabel}。视觉类型：${visualTypeLabels[visualType]}。核心画面：${focus}。表达目的：${purpose}。${visualStyle(platform, role)}。${avoid}画面真实、准确、干净，光线自然，细节清晰；只生成视觉素材，不在图片内生成文字、Logo、二维码或水印。涉及新闻事件时采用概念视觉，不伪造新闻现场，不虚构具体机构标识。`;
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
  plan.push({
    id: `${platform.toLowerCase()}-cover`, role: coverRole,
    title: coverRole === 'MAIN' ? '微博主图' : '文章封面', placement: '发布首图', purpose: coverPurpose,
    visualType: coverType, focus: coverFocus, avoidConcepts: [], searchQueries: coverQueries,
    prompt: promptFor({ platform, title, focus: coverFocus, role: coverRole, purpose: coverPurpose, visualType: coverType, avoidConcepts: [] }),
    negativePrompt: '文字、水印、Logo、二维码、低清晰度、错误标识、畸形结构、夸张光效',
    size: sizeFor(platform, coverRole), assetReferenceId: null,
  });

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
    plan.push({
      id: `${platform.toLowerCase()}-${role.toLowerCase()}-${index}`, role,
      title: platform === 'XIAOHONGSHU' ? `图文卡片 ${index}` : `正文插图 ${index}`,
      placement, purpose, visualType, focus, avoidConcepts, searchQueries,
      prompt: promptFor({ platform, title, focus, role, purpose, visualType, avoidConcepts }),
      negativePrompt: unique(['文字', '水印', 'Logo', '二维码', '低清晰度', '错误标识', '畸形结构', '夸张光效', ...avoidConcepts]).join('、'),
      size: sizeFor(platform, role), assetReferenceId: null,
    });
  }
  return plan;
}

export function mergeVisualPlan(generated, persisted, legacyAssetIds = [], legacyCoverId = null, persistedVersion = 0) {
  if (Array.isArray(persisted) && persistedVersion >= VISUAL_PLAN_VERSION) return persisted;
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
