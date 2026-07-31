const { z } = require('zod');

const VISUAL_PLANNING_SCOPE = 'AGENT_PLANNER';
const VISUAL_PLANNING_FALLBACK_SCOPE = 'CONTENT_WRITING';
const VISUAL_PLANNING_OPERATION = 'VISUAL_PLANNING';

const platformNames = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
  ZHIHU: '知乎',
  WEIBO: '微博',
};

const styleNames = {
  FRESH_EDITORIAL: '清新编辑', BUSINESS_EDITORIAL: '商业编辑', SWISS_GRID: '瑞士网格', DOCUMENTARY: '纪实摄影',
  CINEMATIC_DOCUMENTARY: '电影纪实', MONO_EDITORIAL: '黑白编辑', NEWSPAPER_EDITORIAL: '报刊编辑', LIFESTYLE_PHOTO: '生活方式摄影',
  MINIMAL_KNOWLEDGE: '极简知识', DATA_VISUAL: '数据可视化', BLUEPRINT_DIAGRAM: '蓝图图解', HAND_DRAWN_NOTES: '手绘笔记',
  CONSULTING_REPORT: '咨询报告', SCIENCE_ATLAS: '科学图谱', RETRO_POP: '清新波普怀旧', MACARON_CARTOON: '马卡龙卡通', PAPER_COLLAGE: '纸张拼贴',
  FLAT_GEOMETRIC: '扁平几何', SOFT_3D: '柔和三维', PENCIL_SKETCH: '铅笔速写', PIXEL_RETRO: '像素复古', NEW_CHINESE: '新中式',
  INK_WASH: '水墨留白', GUOCHAO_POSTER: '国潮海报', WOODCUT_PRINT: '木刻版画', TECH_MEDIA: '科技媒体', CYBER_TECH: '清透赛博', INDUSTRIAL_MEDIA: '工业纪实',
};

const visualType = z.enum(['NEWS_PHOTO', 'HERO_VISUAL', 'CONCEPT_DIAGRAM', 'SCENE', 'MIND_MAP', 'FLOWCHART', 'TIMELINE', 'COMPARISON', 'DATA_CHART', 'QUOTE_CARD', 'INFO_CARD', 'CHECKLIST_CARD']);
const role = z.enum(['COVER', 'BODY', 'CARD', 'MAIN']);
const generationMode = z.enum(['ILLUSTRATION', 'INFOGRAPHIC']);
const size = z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']);

const plannedItemSchema = z.object({
  role,
  title: z.string().trim().min(2).max(80),
  placement: z.string().trim().min(2).max(160),
  purpose: z.string().trim().min(8).max(300),
  visualType,
  focus: z.string().trim().min(8).max(300),
  searchQueries: z.array(z.string().trim().min(2).max(60)).min(2).max(4),
  generationMode,
  informationPoints: z.array(z.string().trim().min(4).max(100)).min(1).max(6),
  sourceExcerpt: z.string().trim().min(8).max(1_200),
  contentBlocks: z.array(z.object({
    label: z.string().trim().min(2).max(40),
    detail: z.string().trim().min(6).max(180),
  })).min(1).max(6),
  prompt: z.string().trim().min(80).max(6_000),
  size,
});

const visualPlanSchema = z.object({
  strategy: z.string().trim().min(8).max(500),
  items: z.array(plannedItemSchema).min(1).max(10),
});

const genericOnly = /^(关键|节点|时间|重点|核心|内容|信息|主题|场景|要点|结论|背景|价值|问题|方法|流程|数据|人物|事件|图片|配图)[一二三四五六七八九十\d\s、，：:.-]*$/;

function assertSpecificPlan(plan) {
  const fields = [];
  for (const [index, item] of plan.items.entries()) {
    fields.push([`第 ${index + 1} 张图的画面任务`, item.purpose], [`第 ${index + 1} 张图的画面内容`, item.focus], [`第 ${index + 1} 张图的正文依据`, item.sourceExcerpt]);
    item.informationPoints.forEach((value, pointIndex) => fields.push([`第 ${index + 1} 张图的信息点 ${pointIndex + 1}`, value]));
    item.contentBlocks.forEach((block, blockIndex) => fields.push([`第 ${index + 1} 张图的内容块 ${blockIndex + 1}`, `${block.label}${block.detail}`]));
    item.searchQueries.forEach((value, queryIndex) => fields.push([`第 ${index + 1} 张图的搜索词 ${queryIndex + 1}`, value]));
  }
  const invalid = fields.find(([, value]) => genericOnly.test(String(value).trim()));
  if (invalid) throw new Error(`${invalid[0]}过于空泛：${invalid[1]}。`);
  return plan;
}

function stripCodeFence(content) {
  return String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function expectedRoles(platform, bodyItemCount) {
  if (platform === 'WEIBO') return bodyItemCount === 0 ? [] : ['MAIN'];
  return [platform === 'XIAOHONGSHU' ? 'COVER' : 'COVER', ...Array.from({ length: bodyItemCount }, () => platform === 'XIAOHONGSHU' ? 'CARD' : 'BODY')];
}

function parseVisualPlanningContent(content, { platform, bodyItemCount, singleItem = false } = {}) {
  let value;
  try { value = JSON.parse(stripCodeFence(content)); }
  catch { throw new Error('模型返回的配图方案不是有效 JSON。'); }
  const parsed = assertSpecificPlan(visualPlanSchema.parse(value));
  const expected = singleItem ? 1 : expectedRoles(platform, bodyItemCount).length;
  if (parsed.items.length !== expected) throw new Error(`配图数量不正确，应返回 ${expected} 张，实际返回 ${parsed.items.length} 张。`);
  if (!singleItem) {
    const roles = expectedRoles(platform, bodyItemCount);
    parsed.items.forEach((item, index) => {
      if (item.role !== roles[index]) throw new Error(`第 ${index + 1} 张图角色不正确，应为 ${roles[index]}。`);
    });
  }
  return parsed;
}

function buildVisualPlanningPrompt({ project, platform, bodyItemCount, styleProfile, request, currentItem }) {
  const platformName = platformNames[platform] ?? platform;
  const styleName = styleNames[styleProfile?.preset] ?? styleProfile?.preset ?? '清新编辑';
  const singleItem = Boolean(currentItem);
  const roles = expectedRoles(platform, bodyItemCount);
  const system = [
    '你是资深内容视觉导演。你的工作不是罗列设计参数，而是把已完成正文转成可直接执行的配图方案。',
    '先理解文章叙事和每一段的传播任务，再决定真实场景图、资料图、结构图、数据图、时间线、对比图或信息卡片。',
    '每张图只能完成一个明确任务，必须绑定正文中的具体事实、关系、场景或结论。禁止用“关键、节点、时间、重点、核心、内容、信息”等空词代替具体内容。',
    '只有正文存在明确数据、时间顺序、对比关系或流程时，才能使用数据图、时间线、对比图或流程图。不得编造任何数据、事实、机构、人物、引语或新闻现场。',
    '搜索词必须是可用于公开图库或搜索引擎的具体中文短语，不得使用完整句子。',
    'prompt 是直接交给图片模型的最终中文指令，必须写清主体、动作或结构、信息层级、构图、项目风格、平台比例和准确的图内文案。不要单独输出负面提示词字段。',
    '只返回 JSON，不要代码围栏、解释或备选方案。',
  ].join('\n');
  const message = JSON.stringify({
    task: singleItem ? '根据用户意见只重做当前这一张的策划' : '生成完整配图方案',
    outputShape: {
      strategy: '一句话说明整套图片如何服务文章',
      items: [{ role: 'COVER|BODY|CARD|MAIN', title: '用户可读的图片名称', placement: '准确插入位置', purpose: '为什么需要这张图', visualType: '允许的视觉类型代码', focus: '具体要画什么或展示什么', searchQueries: ['具体搜索词1', '具体搜索词2'], generationMode: 'ILLUSTRATION|INFOGRAPHIC', informationPoints: ['图片必须传达的具体信息'], sourceExcerpt: '对应正文原句或准确摘要', contentBlocks: [{ label: '图内信息标题', detail: '具体内容' }], prompt: '可直接交给图片模型的完整指令', size: '平台比例' }],
    },
    allowedVisualTypes: visualType.options,
    platform: { code: platform, name: platformName },
    requiredRoles: singleItem ? [currentItem.role] : roles,
    bodyItemCount,
    project: {
      title: project.planning?.title || project.title,
      category: project.planning?.category,
      coreMessage: project.planning?.coreMessage || project.coreViewpoint,
      articleTitle: project.versionTitle,
      articleBody: project.versionBody,
    },
    projectVisualStyle: {
      preset: styleProfile?.preset ?? 'FRESH_EDITORIAL',
      name: styleName,
      userRequirement: styleProfile?.customPrompt ?? '',
    },
    userRequest: request || (singleItem ? '保持正文事实不变，重新给出更具体、更可执行的单图方案。' : '根据正文自动完成策划。'),
    currentItem: currentItem ? {
      role: currentItem.role,
      placement: currentItem.placement,
      purpose: currentItem.purpose,
      focus: currentItem.focus,
      sourceExcerpt: currentItem.sourceExcerpt,
    } : null,
  });
  return { system, message };
}

function buildVisualPlanningRepairPrompt(system, validationError) {
  return `${system}\n上一次输出未通过校验。请修正具体性、数量、角色和 JSON 结构，只返回完整 JSON。校验错误：${validationError}`;
}

function itemId(platform, item, index) {
  if (item.role === 'COVER' || item.role === 'MAIN') return `${platform.toLowerCase()}-cover`;
  return `${platform.toLowerCase()}-${item.role.toLowerCase()}-${index}`;
}

function mergePlannedItems({ platform, plannedItems, currentPlan = [], currentItemId, keepAssignedAssets = true }) {
  const current = Array.isArray(currentPlan) ? currentPlan : [];
  if (currentItemId) {
    const replacement = plannedItems[0];
    return current.map((item) => item.id === currentItemId ? {
      ...item,
      ...replacement,
      id: item.id,
      stylePreset: 'INHERIT',
      templatePreset: 'AI_DIRECTED',
      references: Array.isArray(item.references) ? item.references : [],
      assetReferenceId: item.assetReferenceId ?? null,
    } : item);
  }
  return plannedItems.map((item, zeroIndex) => {
    const index = item.role === 'COVER' || item.role === 'MAIN' ? 0 : zeroIndex;
    const previous = current.find((candidate) => candidate.role === item.role && (candidate.id === itemId(platform, item, index) || candidate.title === item.title)) ?? current[zeroIndex];
    const keepAsset = keepAssignedAssets || item.role === 'COVER' || item.role === 'MAIN';
    return {
      ...item,
      id: itemId(platform, item, index),
      avoidConcepts: [],
      stylePreset: 'INHERIT',
      templatePreset: 'AI_DIRECTED',
      references: Array.isArray(previous?.references) ? previous.references : [],
      assetReferenceId: keepAsset ? previous?.assetReferenceId ?? null : null,
    };
  });
}

module.exports = {
  VISUAL_PLANNING_SCOPE,
  VISUAL_PLANNING_FALLBACK_SCOPE,
  VISUAL_PLANNING_OPERATION,
  visualPlanSchema,
  buildVisualPlanningPrompt,
  buildVisualPlanningRepairPrompt,
  parseVisualPlanningContent,
  mergePlannedItems,
};
