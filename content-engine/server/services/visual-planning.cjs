const { z } = require('zod');

const VISUAL_PLANNING_SCOPE = 'WECHAT_VISUAL_PLANNING';
const VISUAL_PLANNING_OPERATION = 'WECHAT_VISUAL_PLANNING';
const VISUAL_PLANNING_PROMPT_VERSION = '2.0.0';
const VISUAL_PLANNING_TOOL_NAME = 'submit_visual_plan';

const platformNames = {
  WECHAT: '公众号',
};

const visualPlanImageLimits = Object.freeze({ WECHAT: 12 });

function validateVisualPlanImageCount(platform, imageCount) {
  const limit = visualPlanImageLimits[platform];
  if (!limit) throw new Error(`不支持的平台：${platform}`);
  if (!Number.isInteger(imageCount) || imageCount < 0) throw new Error('配图数量必须是非负整数。');
  if (imageCount > limit) throw new Error(`${platformNames[platform]}最多保存 ${limit} 张图片。`);
}

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
const contentBlockSchema = z.object({
  label: z.string().trim().min(2).max(40),
  detail: z.string().trim().min(6).max(180),
});

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
  contentBlocks: z.array(contentBlockSchema).max(6),
}).superRefine((item, context) => {
  if (item.generationMode === 'INFOGRAPHIC' && item.contentBlocks.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['contentBlocks'],
      message: '信息图必须包含至少一个图内信息块',
    });
  }
});

const visualPlanSchema = z.object({
  strategy: z.string().trim().min(8).max(500),
  items: z.array(plannedItemSchema).min(1).max(12),
});

const visualPlanningTool = Object.freeze({
  type: 'function',
  function: {
    name: VISUAL_PLANNING_TOOL_NAME,
    description: '提交一套完整的公众号配图方案，或按任务要求提交单张图片的重策划结果。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['strategy', 'items'],
      properties: {
        strategy: { type: 'string', minLength: 8, maxLength: 500, description: '一句话说明整套图片如何服务文章叙事，不能写空泛设计口号。' },
        items: {
          type: 'array', minItems: 1, maxItems: 12,
          items: {
            type: 'object', additionalProperties: false,
            required: ['role', 'title', 'placement', 'purpose', 'visualType', 'focus', 'searchQueries', 'generationMode', 'informationPoints', 'sourceExcerpt', 'contentBlocks'],
            properties: {
              role: { type: 'string', enum: role.options, description: '图片在公众号方案中的角色。完整方案只能是首项 COVER、其余 BODY。' },
              title: { type: 'string', minLength: 2, maxLength: 80, description: '用户可读的具体图片名称。' },
              placement: { type: 'string', minLength: 2, maxLength: 160, description: '图片应插入正文的准确段落或句子之后。' },
              purpose: { type: 'string', minLength: 8, maxLength: 300, description: '说明为什么正文需要这张图以及它承担的阅读任务。' },
              visualType: { type: 'string', enum: visualType.options, description: '与正文信息关系匹配的视觉类型。' },
              focus: { type: 'string', minLength: 8, maxLength: 300, description: '画面中具体可见的主体、动作、关系和场景。' },
              searchQueries: { type: 'array', minItems: 2, maxItems: 4, description: '能搜索到画面内容的具体短语，不得包含模板、排版、图标、PPT 等设计形式词。', items: { type: 'string', minLength: 2, maxLength: 60 } },
              generationMode: { type: 'string', enum: generationMode.options, description: '照片、场景和主视觉使用 ILLUSTRATION；结构关系图使用 INFOGRAPHIC。' },
              informationPoints: { type: 'array', minItems: 1, maxItems: 6, description: '图片必须准确传达且能由正文支持的具体信息。', items: { type: 'string', minLength: 4, maxLength: 100 } },
              sourceExcerpt: { type: 'string', minLength: 8, maxLength: 1200, description: '支持本图的正文原句或忠实摘要。' },
              contentBlocks: {
                type: 'array', maxItems: 6,
                items: {
                  type: 'object', additionalProperties: false, required: ['label', 'detail'],
                  properties: { label: { type: 'string', minLength: 2, maxLength: 40 }, detail: { type: 'string', minLength: 6, maxLength: 180 } },
                },
              },
            },
          },
        },
      },
    },
  },
});

const genericOnly = /^(关键|节点|时间|重点|核心|内容|信息|主题|场景|要点|结论|背景|价值|问题|方法|流程|数据|人物|事件|图片|配图)[一二三四五六七八九十\d\s、，：:.-]*$/;
const searchNoise = /(模板|矢量|图标|字体|字效|排版|版式|PPT|信息卡|知识卡|海报|素材|图表|架构图|示意图|流程图|对比图|框架图|思维导图)/i;

function cleanSearchQuery(value) {
  return String(value ?? '')
    .replace(/(?:模板|排版|PPT|信息卡|知识卡|海报|图标|字体|字效|版式|样式|风格|素材|图表|架构图|示意图|流程图|对比图|框架图|思维导图|封面图|配图|插画|设计)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackSearchQueries(item) {
  const chunks = [item.focus, item.sourceExcerpt, item.purpose, item.title]
    .flatMap((value) => String(value ?? '').split(/[。！？；;，,、\s]+/))
    .map((value) => cleanSearchQuery(value))
    .filter((value) => value.length >= 2 && !genericOnly.test(value));
  return [...new Set(chunks)].slice(0, 4);
}

function normalizeSearchQueries(item) {
  const cleaned = item.searchQueries
    .map((query) => cleanSearchQuery(query))
    .filter((query) => query.length >= 2 && !searchNoise.test(query));
  const merged = [...new Set([...cleaned, ...fallbackSearchQueries(item)])].slice(0, 4);
  return merged.length >= 2 ? merged : item.searchQueries;
}

function assertSpecificPlan(plan) {
  const fields = [];
  for (const [index, item] of plan.items.entries()) {
    fields.push([`第 ${index + 1} 张图的画面任务`, item.purpose], [`第 ${index + 1} 张图的画面内容`, item.focus], [`第 ${index + 1} 张图的正文依据`, item.sourceExcerpt]);
    item.informationPoints.forEach((value, pointIndex) => fields.push([`第 ${index + 1} 张图的信息点 ${pointIndex + 1}`, value]));
    item.contentBlocks.forEach((block, blockIndex) => fields.push([`第 ${index + 1} 张图的内容块 ${blockIndex + 1}`, `${block.label}${block.detail}`]));
    item.searchQueries.forEach((value, queryIndex) => fields.push([`第 ${index + 1} 张图的搜索词 ${queryIndex + 1}`, value]));
    const noisyQuery = item.searchQueries.find((value) => searchNoise.test(value));
    if (noisyQuery) throw new Error(`第 ${index + 1} 张图的搜索词在描述设计形式而不是画面内容：${noisyQuery}。`);
  }
  const invalid = fields.find(([, value]) => genericOnly.test(String(value).trim()));
  if (invalid) throw new Error(`${invalid[0]}过于空泛：${invalid[1]}。`);
  return plan;
}

function stripCodeFence(content) {
  return String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function expectedRoles(platform, bodyItemCount) {
  if (!Number.isInteger(bodyItemCount) || bodyItemCount < 2 || bodyItemCount > 11) throw new Error('正文插图数量必须是 2 到 11 张。');
  validateVisualPlanImageCount(platform, bodyItemCount + 1);
  return ['COVER', ...Array.from({ length: bodyItemCount }, () => 'BODY')];
}

function quantityInstruction(platform, quantityMode, bodyItemCount, singleItem = false) {
  if (singleItem) return { bodyImageCount: null, totalImageCount: 1, exactRoleSequence: ['当前图片角色'], instruction: 'items 数组必须且只能包含 1 项。' };
  if (quantityMode === 'AUTO') {
    return {
      mode: 'AUTO', coverImageCount: 1, minBodyImageCount: 2, maxBodyImageCount: 11, minTotalImageCount: 3, maxTotalImageCount: 12,
      roleRule: '第 1 项必须是 COVER，其余项目必须全部是 BODY',
      instruction: '先根据完整正文的篇幅、段落结构、信息密度和视觉价值，自主选择 2 到 11 张正文插图；封面固定 1 张，总数必须是 3 到 12 张。不要为了凑数重复表达。',
    };
  }
  const roles = expectedRoles(platform, bodyItemCount);
  const bodyName = '正文插图';
  const coverCount = 1;
  return {
    coverImageCount: coverCount,
    bodyImageCount: bodyItemCount,
    totalImageCount: roles.length,
    exactRoleSequence: roles,
    instruction: `items 数组必须恰好包含 ${roles.length} 项：封面 ${coverCount} 张 + ${bodyName} ${bodyItemCount} 张。bodyItemCount 不是总数。`,
  };
}

function parseVisualPlanningContent(content, { platform, quantityMode = 'MANUAL', bodyItemCount, singleItem = false, expectedRole } = {}) {
  if (quantityMode !== 'AUTO' && quantityMode !== 'MANUAL') throw new Error('配图数量模式无效。');
  let value;
  try { value = JSON.parse(stripCodeFence(content)); }
  catch { throw new Error('模型返回的配图方案不是有效 JSON。'); }
  const parsed = visualPlanSchema.parse(value);
  const checked = assertSpecificPlan({
    ...parsed,
    items: parsed.items.map((item) => ({ ...item, searchQueries: normalizeSearchQueries(item) })),
  });
  if (singleItem && checked.items.length !== 1) throw new Error(`单图重策划必须返回 1 张，实际返回 ${checked.items.length} 张。`);
  if (singleItem && expectedRole && checked.items[0]?.role !== expectedRole) {
    throw new Error(`单图重策划必须保持 ${expectedRole} 角色，不能改为 ${checked.items[0]?.role ?? '未知角色'}。`);
  }
  if (!singleItem && quantityMode === 'AUTO') {
    validateVisualPlanImageCount(platform, checked.items.length);
    if (checked.items.length < 3) throw new Error(`自动规划必须包含 1 张封面和至少 2 张正文插图，实际返回 ${checked.items.length} 张。`);
    checked.items.forEach((item, index) => {
      const expectedRole = index === 0 ? 'COVER' : 'BODY';
      if (item.role !== expectedRole) throw new Error(`第 ${index + 1} 张图角色不正确，应为 ${expectedRole}。`);
    });
  }
  if (!singleItem && quantityMode === 'MANUAL') {
    const roles = expectedRoles(platform, bodyItemCount);
    if (checked.items.length !== roles.length) {
      const quantity = quantityInstruction(platform, quantityMode, bodyItemCount, false);
      throw new Error(`配图数量不正确，${quantity.instruction}实际返回 ${checked.items.length} 张。`);
    }
    checked.items.forEach((item, index) => {
      if (item.role !== roles[index]) throw new Error(`第 ${index + 1} 张图角色不正确，应为 ${roles[index]}。`);
    });
  }
  return checked;
}

function buildVisualPlanningPrompt({ project, platform, quantityMode, bodyItemCount, styleProfile, request, currentItem }) {
  const platformName = platformNames[platform] ?? platform;
  const styleName = styleNames[styleProfile?.preset] ?? styleProfile?.preset ?? '清新编辑';
  const singleItem = Boolean(currentItem);
  const roles = singleItem ? [currentItem.role] : quantityMode === 'AUTO' ? ['COVER', 'BODY...'] : expectedRoles(platform, bodyItemCount);
  const quantity = quantityInstruction(platform, quantityMode, bodyItemCount, singleItem);
  const system = [
    '你是资深内容视觉导演。你的工作不是罗列设计参数，而是把已完成正文转成可直接执行的配图方案。',
    '先理解文章叙事和每一段的传播任务，再决定真实场景图、资料图、主体主视觉或确有必要的结构图。整套方案必须以图片内容为主、文字为辅，不能做成文字型 PPT、课程卡片或大段文字海报。',
    '每张图只能完成一个明确任务，必须绑定正文中的具体事实、关系、场景或结论。禁止用“关键、节点、时间、重点、核心、内容、信息”等空词代替具体内容。',
    '只有正文存在明确数据、时间顺序、对比关系或流程时，才能使用数据图、时间线、对比图或流程图；即便如此也应以可视化关系为主，只保留不可缺少的短标签。不得编造任何数据、事实、机构、人物、引语或新闻现场。',
    '搜索词必须描述能在图片中直接看到的主体、动作、地点、器物或真实场景，优先“专有主体 + 可见动作/场景”。每条搜索词不超过 60 个字符。禁止把模板、矢量、图标、字体、排版、PPT、信息卡、知识卡、海报、素材、图表、架构图、示意图、流程图、对比图、框架图、思维导图当作搜索词。不得使用完整句子。抽象关系由 AI 生图表达，不去网页图库搜索 PPT 图。',
    'NEWS_PHOTO、HERO_VISUAL、SCENE 等照片或场景画面应使用 ILLUSTRATION，contentBlocks 必须返回空数组；只有需要在图内表达流程、时间、对比、数据或结构关系时才使用 INFOGRAPHIC，此时 contentBlocks 必须包含 1 至 6 个必要短标签及其准确内容。',
    '你只负责策划画面主体、动作、环境、关系和正文依据。最终生图指令、项目统一艺术方向和图片比例由系统确定性编译，不得在工具参数中自行提交。',
    `必须调用且只能调用一次 ${VISUAL_PLANNING_TOOL_NAME} 提交最终方案；不要输出普通文本、代码围栏、解释或备选方案。`,
  ].join('\n');
  const message = JSON.stringify({
    task: singleItem ? '根据用户意见只重做当前这一张的策划' : '生成完整配图方案',
    submissionTool: VISUAL_PLANNING_TOOL_NAME,
    contentBlockRule: 'ILLUSTRATION 的 contentBlocks 必须为 []；INFOGRAPHIC 的 contentBlocks 必须为 1 至 6 项数组',
    allowedVisualTypes: visualType.options,
    platform: { code: platform, name: platformName },
    requiredRoles: singleItem ? [currentItem.role] : roles,
    quantity,
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
  return { system, message, tools: [visualPlanningTool], requiredToolName: VISUAL_PLANNING_TOOL_NAME };
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
      role: item.role,
      stylePreset: 'INHERIT',
      templatePreset: 'AI_DIRECTED',
      references: Array.isArray(item.references) ? item.references : [],
      assetId: item.assetId ?? null,
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
      assetId: keepAsset ? previous?.assetId ?? null : null,
    };
  });
}

async function compileVisualPlan({ platform, title, items, styleProfile }) {
  const { updateVisualPlanItem } = await import('../../src/domain/visual-plan.mjs');
  return items.map((item) => updateVisualPlanItem(item, {}, { platform, title }, styleProfile));
}

module.exports = {
  VISUAL_PLANNING_SCOPE,
  VISUAL_PLANNING_OPERATION,
  VISUAL_PLANNING_PROMPT_VERSION,
  VISUAL_PLANNING_TOOL_NAME,
  visualPlanningTool,
  visualPlanSchema,
  buildVisualPlanningPrompt,
  parseVisualPlanningContent,
  mergePlannedItems,
  compileVisualPlan,
  validateVisualPlanImageCount,
};
