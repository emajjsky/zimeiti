import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { buildVisualPlanningPrompt, buildVisualPlanningOmniPrompt, visualPlanningRichContent, parseVisualPlanningContent, mergePlannedItems, compileVisualPlan, validateVisualPlanImageCount, VISUAL_PLANNING_TOOL_NAME } = require('../server/services/visual-planning.cjs');

test('配图策划 Worker 使用同一次 Omni 富内容调用，不再走文本工具调用', () => {
  const source = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function executeVisualPlanning');
  const end = source.indexOf('\nasync function updateSimplifiedResearchPhase', start);
  const workerSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(workerSource, /buildVisualPlanningOmniPrompt/);
  assert.match(workerSource, /visualPlanningRichContent/);
  assert.match(workerSource, /buildRichContentOmniArgs/);
  assert.equal((workerSource.match(/runBailianCli/g) ?? []).length, 1);
  assert.doesNotMatch(workerSource, /textRunner\.runText/);
});

test('配图策划通过持久化任务异步执行，请求入口不直接等待百炼 CLI', () => {
  const source = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const routeStart = source.indexOf("app.post('/api/v1/creative/projects/:projectId/visual/plan'");
  const routeEnd = source.indexOf('\nfunction generatedImageMime', routeStart);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(routeSource, /visual_planning_runs/);
  assert.match(routeSource, /VISUAL_PLANNING/);
  assert.match(routeSource, /reply\.code\(202\)/);
  assert.doesNotMatch(routeSource, /runBailianCli/);
});

test('配图策划归一化模型常见的视觉类型和结构字段', () => {
  const parsed = parseVisualPlanningContent(JSON.stringify({
    strategy: '以封面建立主题识别，用正文图片解释信息关系。',
    items: [{
      role: 'cover',
      title: '主题封面',
      placement: '文章开头',
      purpose: '建立主题识别并交代核心场景',
      visualType: 'editorial illustration',
      focus: '编辑视角的真实工作台场景，突出内容创作过程',
      searchQueries: ['内容创作者 工作台 编辑场景'],
      generationMode: 'illustration',
      informationPoints: ['内容创作者正在组织文章素材'],
      sourceExcerpt: '创作者把文字、图片和资料组织为完整文章。',
      contentBlocks: [],
    }],
  }), { platform: 'WECHAT', quantityMode: 'AUTO', singleItem: true, expectedRole: 'COVER' });

  assert.equal(parsed.items[0].role, 'COVER');
  assert.equal(parsed.items[0].visualType, 'HERO_VISUAL');
  assert.equal(parsed.items[0].generationMode, 'ILLUSTRATION');
});

const item = (role, title, placement) => ({
  role,
  title,
  placement,
  purpose: '帮助普通读者理解中继卫星如何扩大航天器测控覆盖范围',
  visualType: role === 'COVER' ? 'HERO_VISUAL' : 'CONCEPT_DIAGRAM',
  focus: '中继卫星位于航天器与地面站之间，转发测控指令和业务数据',
  searchQueries: ['中继卫星 地面站 通信', '航天器 数据中继 传输'],
  generationMode: role === 'COVER' ? 'ILLUSTRATION' : 'INFOGRAPHIC',
  informationPoints: ['航天器把数据发送给中继卫星', '中继卫星把数据转发到地面站'],
  sourceExcerpt: '中继卫星承担航天器与地面站之间的数据转发任务，能够扩展测控覆盖范围。',
  contentBlocks: [
    { label: '航天器', detail: '产生测控与业务数据' },
    { label: '中继卫星', detail: '在轨接收并转发数据' },
    { label: '地面站', detail: '接收数据并发送控制指令' },
  ],
});

test('配图策划提示词读取完整正文并禁止空泛占位词', () => {
  const prompt = buildVisualPlanningPrompt({
    project: { title: '天链三号01星', planning: { title: '天链三号01星', category: '科技', coreMessage: '解释中继卫星的作用' }, versionTitle: '中继卫星有什么用', versionBody: '中继卫星承担航天器与地面站之间的数据转发任务。' },
    platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 2, styleProfile: { preset: 'RETRO_POP', customPrompt: '薄荷绿边框' }, request: '',
  });
  assert.match(prompt.system, /禁止用“关键、节点、时间/);
  assert.match(prompt.message, /中继卫星承担航天器与地面站之间的数据转发任务/);
  assert.match(prompt.message, /清新波普怀旧/);
  assert.match(prompt.message, /薄荷绿边框/);
  assert.match(prompt.system, /图片内容为主、文字为辅/);
  assert.match(prompt.system, /禁止把模板、矢量、图标/);
  assert.match(prompt.system, /最终生图指令、项目统一艺术方向和图片比例由系统确定性编译/);
  assert.match(prompt.message, /ILLUSTRATION 的 contentBlocks 必须为 \[\]/);
  assert.match(prompt.message, /封面 1 张 \+ 正文插图 2 张/);
  assert.match(prompt.message, /bodyItemCount 不是总数/);
  assert.match(prompt.message, /"totalImageCount":3/);
  assert.equal(prompt.requiredToolName, VISUAL_PLANNING_TOOL_NAME);
  assert.equal(prompt.tools[0].function.name, VISUAL_PLANNING_TOOL_NAME);
  const toolItem = prompt.tools[0].function.parameters.properties.items.items;
  assert.equal(prompt.tools[0].function.parameters.properties.items.minItems, 3);
  assert.equal(prompt.tools[0].function.parameters.properties.items.maxItems, 3);
  assert.ok(!toolItem.required.includes('prompt') && !toolItem.required.includes('size'));
  assert.ok(toolItem.properties.avoidConcepts);
  assert.equal(toolItem.properties.prompt, undefined);
  assert.equal(toolItem.properties.size, undefined);
  assert.match(prompt.system, /必须调用且只能调用一次 submit_visual_plan/);
});

test('多模态配图策划直接返回严格 JSON，不要求 Omni 调用工具', () => {
  const prompt = buildVisualPlanningOmniPrompt({
    project: { title: '标题', planning: {}, versionTitle: '文章标题', versionBody: '完整正文' },
    platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 2, styleProfile: { preset: 'FRESH_EDITORIAL' }, request: '',
  });
  assert.match(prompt.system, /只返回符合结构的 JSON/);
  assert.doesNotMatch(prompt.system, /必须调用且只能调用一次/);
  assert.equal(prompt.tools, undefined);
});

test('配图策划富内容包包含当前正文、正文图片和项目参考素材', () => {
  const content = visualPlanningRichContent({
    draft: { title: '文章标题', body: '完整正文' },
    assets: [
      { kind: 'IMAGE', source: 'C:/uploads/body.png', title: '正文图' },
      { kind: 'VIDEO', source: 'C:/uploads/reference.mp4', title: '参考视频' },
    ],
  });
  assert.equal(content.text.body, '完整正文');
  assert.deepEqual(content.media.map(({ kind, source }) => [kind, source]), [
    ['IMAGE', 'C:/uploads/body.png'],
    ['VIDEO', 'C:/uploads/reference.mp4'],
  ]);
});

test('手动配图数量直接固化在当次工具 Schema，模型无法返回少于契约的项目数', () => {
  const prompt = buildVisualPlanningPrompt({
    project: { title: '数量契约', planning: {}, versionTitle: '数量契约', versionBody: '正文内容足够用于配图策划。' },
    platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 8, styleProfile: { preset: 'FRESH_EDITORIAL' }, request: '',
  });
  const items = prompt.tools[0].function.parameters.properties.items;
  assert.equal(items.minItems, 9);
  assert.equal(items.maxItems, 9);
  assert.match(prompt.system, /恰好包含 9 项/);
});

test('母稿配图只接受公众号并限制为十二张', () => {
  assert.doesNotThrow(() => validateVisualPlanImageCount('WECHAT', 12));
  assert.throws(() => validateVisualPlanImageCount('WECHAT', 13), /公众号最多保存 12 张图片/);
  assert.throws(() => validateVisualPlanImageCount('ZHIHU', 1), /不支持的平台/);
  assert.throws(() => validateVisualPlanImageCount('XIAOHONGSHU', 1), /不支持的平台/);
  assert.throws(() => validateVisualPlanImageCount('WEIBO', 1), /不支持的平台/);
});

test('清透赛博风格支持封面一张加正文十一张的公众号方案', () => {
  const prompt = buildVisualPlanningPrompt({
    project: { title: '从Prompt到State：AI协作的下一站', planning: {}, versionTitle: '从Prompt到State：AI协作的下一站', versionBody: '这是一篇完整的公众号正文，用于验证配图策划读取母稿后自主安排插图位置。' },
    platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 11, styleProfile: { preset: 'CYBER_TECH', customPrompt: '' }, request: '',
  });
  assert.match(prompt.message, /清透赛博/);
  assert.match(prompt.message, /封面 1 张 \+ 正文插图 11 张/);
  assert.match(prompt.message, /"totalImageCount":12/);
});

test('自动规划由模型在两到十一张正文图之间决定数量', () => {
  for (const bodyCount of [2, 7, 11]) {
    const items = [item('COVER', '文章封面', '发布首图'), ...Array.from({ length: bodyCount }, (_, index) => item('BODY', `正文插图 ${index + 1}`, `正文第 ${index + 1} 段后`))];
    const parsed = parseVisualPlanningContent(JSON.stringify({ strategy: '按正文信息密度安排封面和不重复的正文图片。', items }), { platform: 'WECHAT', quantityMode: 'AUTO' });
    assert.equal(parsed.items.length, bodyCount + 1);
  }
  const prompt = buildVisualPlanningPrompt({
    project: { title: '自动规划', planning: {}, versionTitle: '自动规划', versionBody: '完整公众号正文用于判断视觉节奏和信息密度。' },
    platform: 'WECHAT', quantityMode: 'AUTO', styleProfile: { preset: 'FRESH_EDITORIAL', customPrompt: '' }, request: '',
  });
  assert.match(prompt.message, /自主选择 2 到 11 张正文插图/);
  assert.match(prompt.message, /"minTotalImageCount":3/);
  assert.match(prompt.message, /"maxTotalImageCount":12/);
});

test('自动规划拒绝零张、一张或十二张正文图以及错误角色顺序', () => {
  const plan = (bodyCount) => ({ strategy: '按正文信息密度安排封面和不重复的正文图片。', items: [item('COVER', '文章封面', '发布首图'), ...Array.from({ length: bodyCount }, (_, index) => item('BODY', `正文插图 ${index + 1}`, `正文第 ${index + 1} 段后`))] });
  assert.throws(() => parseVisualPlanningContent(JSON.stringify(plan(0)), { platform: 'WECHAT', quantityMode: 'AUTO' }), /至少 2 张正文插图/);
  assert.throws(() => parseVisualPlanningContent(JSON.stringify(plan(1)), { platform: 'WECHAT', quantityMode: 'AUTO' }), /至少 2 张正文插图/);
  assert.throws(() => parseVisualPlanningContent(JSON.stringify(plan(12)), { platform: 'WECHAT', quantityMode: 'AUTO' }));
  const wrong = plan(2); wrong.items[1].role = 'COVER';
  assert.throws(() => parseVisualPlanningContent(JSON.stringify(wrong), { platform: 'WECHAT', quantityMode: 'AUTO' }), /第 2 张图角色不正确/);
});

test('手动规划严格匹配用户选择的正文图数量', () => {
  const valid = { strategy: '严格按用户选择安排封面和三张正文插图。', items: [item('COVER', '文章封面', '发布首图'), ...Array.from({ length: 3 }, (_, index) => item('BODY', `正文插图 ${index + 1}`, `正文第 ${index + 1} 段后`))] };
  assert.doesNotThrow(() => parseVisualPlanningContent(JSON.stringify(valid), { platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 3 }));
  assert.throws(() => parseVisualPlanningContent(JSON.stringify(valid), { platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 4 }), /配图数量不正确/);
  assert.throws(() => parseVisualPlanningContent(JSON.stringify(valid), { platform: 'WECHAT', quantityMode: 'MANUAL', bodyItemCount: 1 }), /正文插图数量必须是 2 到 11 张/);
});

test('模型方案必须返回平台所需数量和具体内容', () => {
  const parsed = parseVisualPlanningContent(JSON.stringify({
    strategy: '封面建立主题识别，两张正文图分别解释通信关系和应用价值。',
    items: [item('COVER', '文章封面', '发布首图'), item('BODY', '通信关系图', '解释通信关系段落后'), item('BODY', '应用场景图', '说明应用价值段落后')],
  }), { platform: 'WECHAT', bodyItemCount: 2 });
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[1].focus, '中继卫星位于航天器与地面站之间，转发测控指令和业务数据');
});

test('配图方案适配较长搜索上下文和简短图内信息', () => {
  const adaptable = item('BODY', '通信关系图', '正文第一段后');
  adaptable.searchQueries = ['中继卫星与航天器地面站之间的数据中继和测控通信关系真实场景'];
  adaptable.contentBlocks = [{ label: '关系', detail: '图' }];
  assert.doesNotThrow(() => parseVisualPlanningContent(JSON.stringify({ strategy: '保留必要上下文，适配图片搜索和图内标注。', items: [adaptable] }), {
    platform: 'WECHAT', bodyItemCount: 2, singleItem: true,
  }));
});

test('照片和场景图不强制生成图内文字块，信息图必须提供结构化信息', () => {
  const scene = { ...item('BODY', '真实工作场景', '正文第一段后'), visualType: 'SCENE', generationMode: 'ILLUSTRATION', contentBlocks: [] };
  assert.doesNotThrow(() => parseVisualPlanningContent(JSON.stringify({ strategy: '用真实场景承接正文事实并减少图内文字。', items: [scene] }), { platform: 'WECHAT', bodyItemCount: 2, singleItem: true }));

  const infographic = { ...scene, visualType: 'FLOWCHART', generationMode: 'INFOGRAPHIC' };
  assert.throws(
    () => parseVisualPlanningContent(JSON.stringify({ strategy: '用流程关系解释正文中的明确步骤。', items: [infographic] }), { platform: 'WECHAT', bodyItemCount: 2, singleItem: true }),
    /信息图必须包含至少一个图内信息块/,
  );
});

test('配图方案拒绝关键、节点、时间等空泛内容', () => {
  const bad = item('BODY', '通信关系图', '正文第一段后');
  bad.informationPoints = ['关键一二', '节点三四'];
  assert.throws(() => parseVisualPlanningContent(JSON.stringify({ strategy: '按文章顺序解释具体关系。', items: [bad] }), { platform: 'WECHAT', bodyItemCount: 2, singleItem: true }), /过于空泛/);
});

test('配图方案会清洗描述模板和字体的伪搜索词', () => {
  const noisy = item('BODY', '股权结构图', '正文第一段后');
  noisy.searchQueries = ['饼图 图表 极简', '人民币 符号 图标'];
  const parsed = parseVisualPlanningContent(JSON.stringify({ strategy: '用真实主体和场景解释正文。', items: [noisy] }), { platform: 'WECHAT', bodyItemCount: 2, singleItem: true });
  assert.ok(parsed.items[0].searchQueries.length >= 2);
  assert.deepEqual(parsed.items[0].searchQueries, [...new Set(parsed.items[0].searchQueries)]);
  assert.ok(parsed.items[0].searchQueries.every((query) => !/(图表|图标|模板|PPT|排版|字体|风格)/.test(query)));
});

test('配图方案在伪搜索词无法清洗成具体内容时仍会拒绝', () => {
  const bad = item('BODY', '模板风格图', '正文第一段后');
  bad.focus = '模板 排版 风格';
  bad.purpose = '模板 排版 风格';
  bad.sourceExcerpt = '模板 排版 风格';
  bad.searchQueries = ['模板 图标 PPT', '排版 字体 风格'];
  assert.throws(() => parseVisualPlanningContent(JSON.stringify({ strategy: '用真实主体和场景解释正文。', items: [bad] }), { platform: 'WECHAT', bodyItemCount: 2, singleItem: true }), /描述设计形式/);
});

test('完整重策划保留已选图片，单图重策划只替换当前项', () => {
  const current = [
    { ...item('COVER', '文章封面', '发布首图'), id: 'wechat-cover', references: [], assetId: '11111111-1111-4111-8111-111111111111' },
    { ...item('BODY', '正文插图 1', '正文第一段后'), id: 'wechat-body-1', references: [], assetId: '22222222-2222-4222-8222-222222222222' },
  ];
  const full = mergePlannedItems({ platform: 'WECHAT', plannedItems: [item('COVER', '文章封面', '发布首图'), item('BODY', '正文插图 1', '正文第一段后')], currentPlan: current });
  assert.deepEqual(full.map((entry) => entry.assetId), current.map((entry) => entry.assetId));
  const replacement = { ...item('BODY', '时间线', '正文第一段后'), purpose: '用三个明确年份解释中继卫星系统建设进度' };
  const single = mergePlannedItems({ platform: 'WECHAT', plannedItems: [replacement], currentPlan: current, currentItemId: 'wechat-body-1' });
  assert.equal(single[0].title, '文章封面');
  assert.equal(single[1].title, '时间线');
  assert.equal(single[1].assetId, current[1].assetId);
});

test('单图重策划拒绝模型改变当前配图角色', () => {
  const wrongRole = JSON.stringify({ strategy: '只调整当前画面的具体主体和场景', items: [item('COVER', '错误封面', '正文第一段后')] });
  assert.throws(() => parseVisualPlanningContent(wrongRole, {
    platform: 'WECHAT',
    quantityMode: 'AUTO',
    singleItem: true,
    expectedRole: 'BODY',
  }), /单图重策划必须保持 BODY 角色/);
});

test('单图合并始终保留原配图角色', () => {
  const current = [
    { ...item('COVER', '封面', '发布首图'), id: 'wechat-cover', assetId: null },
    { ...item('BODY', '正文图', '正文第一段后'), id: 'wechat-body-1', assetId: null },
  ];
  const merged = mergePlannedItems({
    platform: 'WECHAT',
    plannedItems: [item('COVER', '模型误报角色', '正文第一段后')],
    currentPlan: current,
    currentItemId: 'wechat-body-1',
  });
  assert.equal(merged[1].role, 'BODY');
});

test('系统统一编译公众号画幅和整套艺术方向，忽略模型自带比例与提示词', async () => {
  const merged = mergePlannedItems({
    platform: 'WECHAT',
    plannedItems: [
      { ...item('COVER', '文章封面', '发布首图'), size: '1:1', prompt: '模型自行提交的封面提示词' },
      { ...item('BODY', '正文插图 1', '正文第一段后'), size: '3:4', prompt: '模型自行提交的正文提示词' },
    ],
  });
  const compiled = await compileVisualPlan({
    platform: 'WECHAT',
    title: '中继卫星有什么用',
    items: merged,
    styleProfile: { preset: 'CYBER_TECH', customPrompt: '统一使用低饱和青色光线' },
  });
  assert.deepEqual(compiled.map((entry) => entry.size), ['16:9', '4:3']);
  assert.ok(compiled.every((entry) => /项目统一视觉方向/.test(entry.prompt)));
  assert.ok(compiled.every((entry) => !/清透赛博/.test(entry.prompt) && /低饱和青色光线/.test(entry.prompt)));
  assert.ok(compiled.every((entry) => /系列一致性/.test(entry.prompt)));
  assert.ok(compiled.every((entry) => !/模型自行提交/.test(entry.prompt)));
});
