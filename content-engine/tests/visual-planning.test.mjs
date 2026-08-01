import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildVisualPlanningPrompt, buildVisualPlanningRepairPrompt, parseVisualPlanningContent, mergePlannedItems, validateVisualPlanImageCount } = require('../server/services/visual-planning.cjs');

const item = (role, title, placement) => ({
  role,
  title,
  placement,
  purpose: '帮助普通读者理解中继卫星如何扩大航天器测控覆盖范围',
  visualType: role === 'COVER' ? 'HERO_VISUAL' : 'CONCEPT_DIAGRAM',
  focus: '中继卫星位于航天器与地面站之间，转发测控指令和业务数据',
  searchQueries: ['中继卫星 地面站 通信', '航天器 数据中继 示意图'],
  generationMode: role === 'COVER' ? 'ILLUSTRATION' : 'INFOGRAPHIC',
  informationPoints: ['航天器把数据发送给中继卫星', '中继卫星把数据转发到地面站'],
  sourceExcerpt: '中继卫星承担航天器与地面站之间的数据转发任务，能够扩展测控覆盖范围。',
  contentBlocks: [
    { label: '航天器', detail: '产生测控与业务数据' },
    { label: '中继卫星', detail: '在轨接收并转发数据' },
    { label: '地面站', detail: '接收数据并发送控制指令' },
  ],
  prompt: '为公众号制作一张中继卫星通信图，画面明确展示航天器、中继卫星和地面站三者的空间关系与双向数据链路，采用清新编辑风格，主体清楚，信息层级准确，所有简体中文必须严格使用给定文案，不添加正文没有的数据、标识或结论。',
  size: role === 'COVER' ? '16:9' : '4:3',
});

test('配图策划提示词读取完整正文并禁止空泛占位词', () => {
  const prompt = buildVisualPlanningPrompt({
    project: { title: '天链三号01星', planning: { title: '天链三号01星', category: '科技', coreMessage: '解释中继卫星的作用' }, versionTitle: '中继卫星有什么用', versionBody: '中继卫星承担航天器与地面站之间的数据转发任务。' },
    platform: 'WECHAT', bodyItemCount: 2, styleProfile: { preset: 'RETRO_POP', customPrompt: '薄荷绿边框' }, request: '',
  });
  assert.match(prompt.system, /禁止用“关键、节点、时间/);
  assert.match(prompt.message, /中继卫星承担航天器与地面站之间的数据转发任务/);
  assert.match(prompt.message, /清新波普怀旧/);
  assert.match(prompt.message, /薄荷绿边框/);
  assert.match(prompt.system, /图片内容为主、文字为辅/);
  assert.match(prompt.system, /禁止把模板、矢量、图标/);
  assert.match(prompt.system, /最多四个必要短标签/);
  assert.match(prompt.message, /封面 1 张 \+ 正文插图 2 张/);
  assert.match(prompt.message, /bodyItemCount 不是总数/);
  assert.match(prompt.message, /"totalImageCount":3/);
});

test('数量修复提示明确总数并要求重写完整数组', () => {
  const repair = buildVisualPlanningRepairPrompt('系统规则', '实际返回 5 张', { platform: 'WECHAT', bodyItemCount: 5 });
  assert.match(repair, /封面 1 张 \+ 正文插图 5 张/);
  assert.match(repair, /恰好包含 6 项/);
  assert.match(repair, /COVER → BODY → BODY → BODY → BODY → BODY/);
  assert.match(repair, /不要只补缺失项/);
});

test('微博九张方案使用一张主图加八张后续配图', () => {
  const prompt = buildVisualPlanningPrompt({
    project: { title: '机器人行业观察', planning: { title: '机器人行业观察', category: '科技', coreMessage: '解释产品、团队和应用场景' }, versionTitle: '机器人行业观察', versionBody: '正文内容足够完整。' },
    platform: 'WEIBO', bodyItemCount: 9, styleProfile: { preset: 'FRESH_EDITORIAL', customPrompt: '' }, request: '',
  });
  assert.match(prompt.message, /首张角色为 MAIN，其余 8 张角色为 BODY/);
  assert.match(prompt.message, /"totalImageCount":9/);
});

test('保存配图时按平台限制图片总数', () => {
  assert.doesNotThrow(() => validateVisualPlanImageCount('WECHAT', 12));
  assert.doesNotThrow(() => validateVisualPlanImageCount('ZHIHU', 12));
  assert.doesNotThrow(() => validateVisualPlanImageCount('XIAOHONGSHU', 9));
  assert.doesNotThrow(() => validateVisualPlanImageCount('WEIBO', 9));
  assert.throws(() => validateVisualPlanImageCount('WECHAT', 13), /公众号最多保存 12 张图片/);
  assert.throws(() => validateVisualPlanImageCount('ZHIHU', 13), /知乎最多保存 12 张图片/);
  assert.throws(() => validateVisualPlanImageCount('XIAOHONGSHU', 10), /小红书最多保存 9 张图片/);
  assert.throws(() => validateVisualPlanImageCount('WEIBO', 10), /微博最多保存 9 张图片/);
});

test('模型方案必须返回平台所需数量和具体内容', () => {
  const parsed = parseVisualPlanningContent(JSON.stringify({
    strategy: '封面建立主题识别，两张正文图分别解释通信关系和应用价值。',
    items: [item('COVER', '文章封面', '发布首图'), item('BODY', '通信关系图', '解释通信关系段落后'), item('BODY', '应用场景图', '说明应用价值段落后')],
  }), { platform: 'WECHAT', bodyItemCount: 2 });
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[1].focus, '中继卫星位于航天器与地面站之间，转发测控指令和业务数据');
});

test('配图方案拒绝关键、节点、时间等空泛内容', () => {
  const bad = item('BODY', '通信关系图', '正文第一段后');
  bad.informationPoints = ['关键一二', '节点三四'];
  assert.throws(() => parseVisualPlanningContent(JSON.stringify({ strategy: '按文章顺序解释具体关系。', items: [bad] }), { platform: 'WECHAT', bodyItemCount: 2, singleItem: true }), /过于空泛/);
});

test('配图方案拒绝描述模板和字体的伪搜索词', () => {
  const bad = item('BODY', '股权结构图', '正文第一段后');
  bad.searchQueries = ['饼图 图表 极简', '人民币 符号 图标'];
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
