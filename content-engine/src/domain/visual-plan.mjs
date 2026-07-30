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
  '中继卫星', '运载火箭', '航天器测控', '数据传输', '数据中继', '卫星发射',
  '人工智能', '生成式AI', '大语言模型', '大模型', '自动驾驶', '新能源汽车', '科技创新',
  '资本市场', '货币政策', '股票市场', '上市公司', '电子商务', '国际关系', '社会治理',
  '传统文化', '历史人物', '体育赛事', '影视作品', '公共卫生', '医疗健康', '教育改革',
];

function clean(value) {
  return String(value ?? '').replace(/[#>*_`~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function conceptsFrom(value) {
  const text = clean(value);
  return commonConcepts.filter((concept) => text.toLowerCase().includes(concept.toLowerCase()));
}

function subjectFromTitle(title) {
  const value = clean(title).replace(/[，。！？：；,.!?:;]+$/g, '');
  const stripped = value.replace(/^(我国|中国)?(?:成功|正式|首次|最新)?(?:完成|实现|发布|推出|发射|上线|宣布|启动|举行)/, '');
  return (stripped.length >= 3 ? stripped : value).slice(0, 28);
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
      if (item.isWordLike && word.length >= 2 && word.length <= 14) segmented.push(word);
    }
  }
  const candidates = unique([...quoted, ...conceptsFrom(text), ...technical, ...segmented])
    .filter((word) => !stopWords.has(word) && !/^\d+$/.test(word));
  return candidates
    .filter((word) => word.length > 4 || !candidates.some((other) => other !== word && other.length > word.length && other.includes(word)))
    .sort((left, right) => right.length - left.length)
    .slice(0, limit);
}

function contentSections(body) {
  const blocks = String(body ?? '').split(/\n\s*\n|\r?\n/).map(clean).filter((item) => item.length >= 12);
  const headings = String(body ?? '').split(/\r?\n/).map((line) => clean(line.replace(/^#{1,6}\s*/, '')))
    .filter((line) => line.length >= 3 && line.length <= 32 && !/[。！？]$/.test(line));
  return unique([...headings, ...blocks.map((block) => block.slice(0, 46))]);
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
  return '克制的中文媒体正文插图风格，画面服务观点，避免无关装饰';
}

function promptFor({ platform, title, focus, role, purpose }) {
  const platformLabel = platformLabels[platform] ?? '图文平台';
  const roleLabel = role === 'COVER' ? '封面' : role === 'CARD' ? '图文卡片' : role === 'MAIN' ? '主图' : '正文插图';
  return `为${platformLabel}内容《${title}》制作一张${roleLabel}。核心画面：${focus}。表达目的：${purpose}。${visualStyle(platform, role)}。画面真实、准确、干净，光线自然，细节清晰；只生成视觉素材，不在图片内生成文字、Logo、二维码或水印。涉及新闻事件时采用概念视觉，不伪造新闻现场，不虚构具体机构标识。`;
}

function searchQueriesFor(title, focus, category, role) {
  const subject = subjectFromTitle(title);
  const titleTerms = termsFrom(title, 8).filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const focusTerms = termsFrom(focus, 8).filter((term) => term !== subject && !subject.includes(term) && !term.includes(subject));
  const action = title.match(/发射|发布|推出|上线|启动|建成|开放|收购|增长|下降|突破|获奖|夺冠|上映/)?.[0];
  const location = /^(我国|中国)/.test(clean(title)) ? '中国' : '';
  const primary = unique([subject, action ?? '', ...titleTerms]).slice(0, 2).join(' ');
  const secondary = unique([location, ...focusTerms]).slice(0, 3).join(' ');
  const tertiaryParts = unique([category, ...focusTerms.slice(2)]).slice(0, 3);
  const tertiary = (tertiaryParts.length >= 2 ? tertiaryParts : unique([category, subject, role === 'COVER' ? '主题图片' : '资料图']).slice(0, 3)).join(' ');
  return unique([
    primary,
    secondary || `${subject} ${role === 'COVER' ? '主题图片' : '资料图'}`,
    tertiary || `${category || subject} ${role === 'COVER' ? '封面素材' : '正文配图'}`,
  ]).filter((query) => query.length >= 2 && query.length <= 60).slice(0, 3);
}

function desiredItemCount(platform, body) {
  const length = clean(body).length;
  if (platform === 'WEIBO') return 1;
  if (platform === 'XIAOHONGSHU') return Math.max(6, Math.min(8, 6 + Math.floor(length / 900)));
  return Math.max(3, Math.min(5, 3 + Math.floor(length / 1200)));
}

export function buildVisualPlan(input, platform) {
  const title = clean(input?.title) || '未命名内容';
  const body = String(input?.body ?? '');
  const category = clean(input?.category);
  const coreMessage = clean(input?.coreMessage);
  const subject = subjectFromTitle(title);
  const sections = contentSections(body);
  const count = desiredItemCount(platform, body);
  const plan = [];
  const coverRole = platform === 'WEIBO' ? 'MAIN' : 'COVER';
  const coverPurpose = platform === 'WEIBO' ? '在信息流中快速传达主题并吸引点击' : '概括全文主题并承担首屏识别';
  const coverFocus = coreMessage || subject;
  plan.push({
    id: `${platform.toLowerCase()}-cover`, role: coverRole,
    title: coverRole === 'MAIN' ? '微博主图' : '文章封面', placement: '发布首图', purpose: coverPurpose,
    searchQueries: searchQueriesFor(title, coverFocus, category, coverRole),
    prompt: promptFor({ platform, title, focus: coverFocus, role: coverRole, purpose: coverPurpose }),
    negativePrompt: '文字、水印、Logo、二维码、低清晰度、错误标识、畸形结构、夸张光效',
    size: sizeFor(platform, coverRole), assetReferenceId: null,
  });
  for (let index = 1; index < count; index += 1) {
    const role = platform === 'XIAOHONGSHU' ? 'CARD' : 'BODY';
    const section = sections[Math.min(index - 1, Math.max(0, sections.length - 1))] || coreMessage || subject;
    const focus = unique([section.includes(subject) ? subject : '', ...conceptsFrom(section), ...termsFrom(section, 5)])
      .filter((term) => term && (term === subject || (!subject.includes(term) && !term.includes(subject))))
      .slice(0, 3).join('、') || section.slice(0, 30);
    const placement = platform === 'XIAOHONGSHU' ? `第 ${index + 1} 页` : `正文第 ${index} 个核心段落后`;
    const purpose = platform === 'XIAOHONGSHU' ? `把“${focus}”拆成一页可快速理解的视觉信息` : `解释“${focus}”，帮助读者理解这一段内容`;
    plan.push({
      id: `${platform.toLowerCase()}-${role.toLowerCase()}-${index}`, role,
      title: platform === 'XIAOHONGSHU' ? `图文卡片 ${index}` : `正文插图 ${index}`,
      placement, purpose,
      searchQueries: searchQueriesFor(title, focus, category, role),
      prompt: promptFor({ platform, title, focus, role, purpose }),
      negativePrompt: '文字、水印、Logo、二维码、低清晰度、错误标识、畸形结构、夸张光效',
      size: sizeFor(platform, role), assetReferenceId: null,
    });
  }
  return plan;
}

export function mergeVisualPlan(generated, persisted, legacyAssetIds = [], legacyCoverId = null) {
  if (Array.isArray(persisted) && persisted.length) return persisted;
  const remaining = legacyAssetIds.filter((id) => id && id !== legacyCoverId);
  return generated.map((item, index) => ({
    ...item,
    assetReferenceId: item.role === 'COVER' || item.role === 'MAIN'
      ? legacyCoverId ?? legacyAssetIds[0] ?? null
      : remaining[index - 1] ?? null,
  }));
}
