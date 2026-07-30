import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisualGenerationSpec, buildVisualPlan, mergeVisualPlan, resizeVisualPlan, updateVisualPlanItem, visualPlanCountRange, visualStylePresets, visualTemplatesFor, VISUAL_PLAN_VERSION } from '../src/domain/visual-plan.mjs';

const article = {
  title: '我国成功发射天链三号01星',
  category: '科技',
  coreMessage: '新一代中继卫星将提升航天器测控与数据传输能力',
  body: '天链三号01星由运载火箭送入预定轨道。\n\n中继卫星承担天地通信与数据中继任务。\n\n本次任务还需要关注公开技术资料与后续应用。',
};

test('公众号配图方案自动包含封面、正文位置、搜索词和生图提示词', () => {
  const plan = buildVisualPlan(article, 'WECHAT');
  assert.ok(plan.length >= 3 && plan.length <= 5);
  assert.equal(plan[0].role, 'COVER');
  assert.equal(plan[0].searchQueries[0], '天链三号01星 发射');
  assert.ok(plan[0].searchQueries.every((query) => query.length <= 60 && !query.includes('新一代中继卫星将提升航天')));
  assert.match(plan[0].prompt, /公众号/);
  assert.match(plan[1].placement, /正文/);
  assert.ok(plan.every((item) => item.searchQueries.length >= 2 && item.prompt.length > 30 && item.size));
  assert.ok(plan.every((item) => item.visualType && item.focus && Array.isArray(item.avoidConcepts)));
  const firstQueries = plan.map((item) => item.searchQueries[0]);
  assert.equal(new Set(firstQueries).size, firstQueries.length);
  assert.notEqual(plan[1].searchQueries[0], plan[0].searchQueries[0]);
  assert.match(plan.slice(1).map((item) => item.searchQueries.join(' ')).join(' '), /中继卫星|数据传输|测控覆盖|卫星组网/);
});

test('渠道长标题不会把钩子句带进配图搜索词', () => {
  const plan = buildVisualPlan({
    ...article,
    title: '天链三号01星发射成功：我是二师兄，带你读懂这颗“太空通信卫星”',
  }, 'WECHAT');
  assert.equal(plan[0].searchQueries[0], '天链三号01星 发射');
  assert.ok(plan.every((item) => item.searchQueries.every((query) => !query.includes('我是二师兄') && !query.includes('带你读懂'))));
});

test('不同平台采用不同的默认配图数量与比例', () => {
  const xiaohongshu = buildVisualPlan(article, 'XIAOHONGSHU');
  const weibo = buildVisualPlan(article, 'WEIBO');
  assert.ok(xiaohongshu.length >= 6 && xiaohongshu.length <= 8);
  assert.ok(xiaohongshu.every((item) => item.size === '3:4'));
  assert.equal(weibo.length, 1);
  assert.equal(weibo[0].role, 'MAIN');
  assert.equal(weibo[0].size, '1:1');
});

test('小红书内容页默认生成带中文信息层级的图文信息图', () => {
  const plan = buildVisualPlan(article, 'XIAOHONGSHU');
  const card = plan.find((item) => item.role === 'CARD');
  assert.ok(card);
  assert.equal(card.generationMode, 'INFOGRAPHIC');
  assert.ok(card.informationPoints.length >= 3 && card.informationPoints.length <= 5);
  assert.match(card.prompt, /主标题：/);
  assert.match(card.prompt, /核心结论：/);
  assert.match(card.prompt, /信息点：/);
  assert.doesNotMatch(card.prompt, /不在图片内生成文字/);
  assert.ok(!card.negativePrompt.split('、').includes('文字'));
  assert.match(card.negativePrompt, /错别字/);
  assert.match(card.negativePrompt, /乱码/);
});

test('视觉插图与图文信息图切换时生成各自正确的提示词约束', () => {
  const item = {
    id: 'scene-1', role: 'BODY', title: '正文插图 1', placement: '正文第一段后', purpose: '解释普通人的实际使用场景',
    visualType: 'SCENE', focus: '普通人使用AI工具', avoidConcepts: [], searchQueries: ['AI 工具 使用场景'],
    informationPoints: ['先确认任务目标', '再选择合适工具', '最后人工检查结果'], prompt: '', negativePrompt: '',
    generationMode: 'ILLUSTRATION', size: '4:3', assetReferenceId: null,
  };
  const illustration = buildVisualGenerationSpec(item, { platform: 'WECHAT', title: '普通人怎样使用AI工具' }, 'ILLUSTRATION');
  assert.match(illustration.prompt, /不在图片内生成文字/);
  assert.ok(illustration.negativePrompt.split('、').includes('文字'));

  const infographic = buildVisualGenerationSpec(item, { platform: 'WECHAT', title: '普通人怎样使用AI工具' }, 'INFOGRAPHIC');
  assert.match(infographic.prompt, /主标题：普通人使用AI工具/);
  assert.match(infographic.prompt, /先确认任务目标/);
  assert.doesNotMatch(infographic.prompt, /不在图片内生成文字/);
  assert.ok(!infographic.negativePrompt.split('、').includes('文字'));
});

test('没有旧方案时只迁移历史封面，正文素材留在项目素材库', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const merged = mergeVisualPlan(generated, null, ['body-id', 'cover-id'], 'cover-id');
  assert.equal(merged[0].assetReferenceId, 'cover-id');
  assert.ok(merged.slice(1).every((item) => item.assetReferenceId === null));
});

test('旧版方案自动升级搜索词并清空正文错误绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const oldPlan = generated.map((item, index) => ({
    ...item,
    searchQueries: ['天链三号01星 发射'],
    assetReferenceId: index === 0 ? 'cover-id' : `body-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, [], null, 1);
  assert.equal(upgraded[0].assetReferenceId, 'cover-id');
  assert.ok(upgraded.slice(1).every((item) => item.assetReferenceId === null));
  assert.equal(new Set(upgraded.map((item) => item.searchQueries[0])).size, upgraded.length);
});

test('第二版方案升级图文模式时保留已有图片绑定并替换旧提示词', () => {
  const generated = buildVisualPlan(article, 'XIAOHONGSHU');
  const oldPlan = generated.map((item, index) => ({
    ...item,
    generationMode: undefined,
    informationPoints: undefined,
    prompt: '只生成视觉素材，不在图片内生成文字',
    negativePrompt: '文字、水印',
    assetReferenceId: `asset-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, [], null, 2);
  assert.deepEqual(upgraded.map((item) => item.assetReferenceId), oldPlan.map((item) => item.assetReferenceId));
  assert.equal(upgraded[1].generationMode, 'INFOGRAPHIC');
  assert.doesNotMatch(upgraded[1].prompt, /不在图片内生成文字/);
});

test('当前版本方案保留用户已经编辑的内容和绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const persisted = generated.map((item, index) => ({ ...item, purpose: `自定义 ${index}`, assetReferenceId: index ? `body-${index}` : 'cover-id' }));
  assert.deepEqual(mergeVisualPlan(generated, persisted, [], null, VISUAL_PLAN_VERSION), persisted);
});

test('微博当前版本的空方案会被保留，不会在刷新后重新生成主图', () => {
  const generated = buildVisualPlan(article, 'WEIBO');
  assert.deepEqual(mergeVisualPlan(generated, [], [], null, VISUAL_PLAN_VERSION), []);
});

test('公众号支持指定正文插图数量，封面单独计算', () => {
  const plan = buildVisualPlan(article, 'WECHAT', { bodyItemCount: 4 });
  assert.equal(plan.length, 5);
  assert.equal(plan.filter((item) => item.role === 'COVER').length, 1);
  assert.equal(plan.filter((item) => item.role === 'BODY').length, 4);
  assert.equal(new Set(plan.slice(1).map((item) => item.searchQueries[0])).size, 4);
});

test('用户指定的正文配图数量会限制在平台合理范围内', () => {
  assert.deepEqual(visualPlanCountRange('WECHAT'), { min: 2, max: 5 });
  assert.deepEqual(visualPlanCountRange('ZHIHU'), { min: 2, max: 4 });
  assert.deepEqual(visualPlanCountRange('XIAOHONGSHU'), { min: 5, max: 8 });
  assert.deepEqual(visualPlanCountRange('WEIBO'), { min: 0, max: 1 });
  assert.equal(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 0 }).length, 3);
  assert.equal(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 99 }).length, 6);
  assert.equal(buildVisualPlan(article, 'XIAOHONGSHU', { bodyItemCount: 8 }).length, 9);
});

test('调整配图数量时保留现有项和素材绑定，新项目保持未绑定', () => {
  const initial = buildVisualPlan(article, 'WECHAT', { bodyItemCount: 3 }).map((item, index) => ({
    ...item,
    purpose: `用户调整 ${index}`,
    assetReferenceId: `asset-${index}`,
  }));
  const expanded = resizeVisualPlan(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 5 }), initial);
  assert.equal(expanded.length, 6);
  assert.deepEqual(expanded.slice(0, 4).map((item) => item.assetReferenceId), ['asset-0', 'asset-1', 'asset-2', 'asset-3']);
  assert.ok(expanded.slice(4).every((item) => item.assetReferenceId === null));
  assert.equal(expanded[1].purpose, '用户调整 1');

  const reduced = resizeVisualPlan(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 2 }), expanded);
  assert.equal(reduced.length, 3);
  assert.deepEqual(reduced.map((item) => item.assetReferenceId), ['asset-0', 'asset-1', 'asset-2']);
  assert.ok(reduced.every((item) => !['asset-3', 'asset-4', 'asset-5'].includes(item.assetReferenceId)));
});

test('视觉导演按正文表达任务选择思维导图、流程图、时间线和对比图', () => {
  const plan = buildVisualPlan({
    title: '普通人建立个人知识库的完整方法',
    category: '知识管理',
    coreMessage: '知识库由信息收集、分类体系、加工流程和复盘机制组成',
    body: [
      '知识库的组成可以分为信息入口、主题分类、长期项目和输出成果，这些模块共同构成个人知识体系。',
      '实际操作分为四个步骤：先收集资料，再清洗去重，然后建立关联，最后形成文章或视频。',
      '2023 年以手工收藏为主，2024 年开始使用自动化，2025 年引入智能分析，2026 年形成稳定工作流。',
      '传统方案依赖文件夹，新方案使用双向链接；前者简单但容易失联，后者维护成本更高但关系清楚。',
    ].join('\n\n'),
  }, 'WECHAT', { bodyItemCount: 4 });
  assert.deepEqual(plan.slice(1).map((item) => item.visualType), ['MIND_MAP', 'FLOWCHART', 'TIMELINE', 'COMPARISON']);
  assert.ok(plan.slice(1).every((item) => item.sourceExcerpt.length > 20));
  assert.ok(plan.slice(1).every((item) => item.contentBlocks.length >= 2));
  assert.match(plan[1].prompt, /思维导图/);
  assert.match(plan[2].prompt, /流程图/);
});

test('项目风格默认继承且单张图片可以独立覆盖', () => {
  const styles = visualStylePresets();
  assert.ok(styles.some((item) => item.id === 'FRESH_EDITORIAL'));
  assert.ok(styles.some((item) => item.id === 'RETRO_POP'));
  const [item] = buildVisualPlan(article, 'WECHAT');
  assert.equal(item.stylePreset, 'INHERIT');
  assert.ok(visualTemplatesFor('MIND_MAP').some((item) => item.id === 'RADIAL_BRANCH'));

  const inherited = updateVisualPlanItem(item, { visualType: 'MIND_MAP', templatePreset: 'RADIAL_BRANCH' }, { platform: 'WECHAT', title: article.title }, { preset: 'RETRO_POP' });
  assert.equal(inherited.stylePreset, 'INHERIT');
  assert.match(inherited.prompt, /波普怀旧/);
  assert.match(inherited.prompt, /放射分支/);

  const overridden = updateVisualPlanItem(inherited, { stylePreset: 'TECH_MEDIA' }, { platform: 'WECHAT', title: article.title }, { preset: 'RETRO_POP' });
  assert.match(overridden.prompt, /科技媒体/);
  assert.doesNotMatch(overridden.prompt, /波普怀旧/);
});

test('视觉提示词包含结构内容和参考图用途但不暴露项目文件名', () => {
  const [item] = buildVisualPlan(article, 'WECHAT');
  const updated = updateVisualPlanItem(item, {
    visualType: 'COMPARISON',
    templatePreset: 'SPLIT_COMPARE',
    contentBlocks: [
      { label: '传统方式', detail: '手工整理，启动快但容易遗漏' },
      { label: '智能方式', detail: '自动归类，需要人工复核' },
    ],
    references: [{ referenceId: '11111111-1111-4111-8111-111111111111', uses: ['COLOR', 'LAYOUT'] }],
  }, { platform: 'WECHAT', title: article.title }, { preset: 'FRESH_EDITORIAL' });
  assert.match(updated.prompt, /传统方式：手工整理/);
  assert.match(updated.prompt, /参考图只用于参考色彩、排版/);
  assert.doesNotMatch(updated.prompt, /11111111/);
});

test('第三版方案升级视觉导演字段时保留用户内容和最终图片绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const oldPlan = generated.map((item, index) => ({
    id: item.id,
    role: item.role,
    title: item.title,
    placement: item.placement,
    purpose: `旧版目的 ${index}`,
    visualType: index ? 'CONCEPT_DIAGRAM' : item.visualType,
    focus: item.focus,
    avoidConcepts: item.avoidConcepts,
    searchQueries: item.searchQueries,
    generationMode: item.generationMode,
    informationPoints: [`旧版信息 ${index}`],
    prompt: '旧提示词',
    negativePrompt: '旧负面提示词',
    size: item.size,
    assetReferenceId: `asset-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, [], null, 3);
  assert.equal(VISUAL_PLAN_VERSION, 4);
  assert.deepEqual(upgraded.map((item) => item.assetReferenceId), oldPlan.map((item) => item.assetReferenceId));
  assert.deepEqual(upgraded.map((item) => item.purpose), oldPlan.map((item) => item.purpose));
  assert.deepEqual(upgraded.map((item) => item.informationPoints), oldPlan.map((item) => item.informationPoints));
  assert.ok(upgraded.every((item) => item.stylePreset === 'INHERIT' && Array.isArray(item.references) && item.templatePreset));
  assert.ok(upgraded.every((item) => item.prompt !== '旧提示词'));
});
