import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { buildVisualGenerationSpec, buildVisualPlan, mergeVisualPlan, replanVisualPlan, resizeVisualPlan, updateVisualPlanItem, visualPlanCountRange, visualStylePresets, visualTemplatesFor, VISUAL_PLAN_VERSION } from '../src/domain/visual-plan.mjs';

const article = {
  title: '我国成功发射天链三号01星',
  category: '科技',
  coreMessage: '新一代中继卫星将提升航天器测控与数据传输能力',
  body: '天链三号01星由运载火箭送入预定轨道。\n\n中继卫星承担天地通信与数据中继任务。\n\n本次任务还需要关注公开技术资料与后续应用。',
};

test('配图方案只保存空间素材 ID', () => {
  const plan = buildVisualPlan(article, 'WECHAT');
  assert.ok(plan.every((item) => Object.hasOwn(item, 'assetId')));
  assert.ok(plan.every((item) => !Object.hasOwn(item, 'assetReferenceId')));
});

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
  assert.match(card.prompt, /画面内容优先/);
  assert.match(card.prompt, /只允许一个短标题/);
  assert.match(card.prompt, /必要短标签/);
  assert.match(card.prompt, /不生成正文段落/);
  assert.doesNotMatch(card.prompt, /不在图片内生成文字/);
  assert.match(card.prompt, /错别字/);
  assert.match(card.prompt, /乱码/);
  assert.ok(!Object.hasOwn(card, 'negativePrompt'));
});

test('视觉插图与图文信息图切换时生成各自正确的提示词约束', () => {
  const item = {
    id: 'scene-1', role: 'BODY', title: '正文插图 1', placement: '正文第一段后', purpose: '解释普通人的实际使用场景',
    visualType: 'SCENE', focus: '普通人使用AI工具', avoidConcepts: [], searchQueries: ['AI 工具 使用场景'],
    informationPoints: ['先确认任务目标', '再选择合适工具', '最后人工检查结果'], prompt: '',
    generationMode: 'ILLUSTRATION', size: '4:3', assetId: null,
  };
  const illustration = buildVisualGenerationSpec(item, { platform: 'WECHAT', title: '普通人怎样使用AI工具' }, 'ILLUSTRATION');
  assert.match(illustration.prompt, /不在图片内生成文字/);
  assert.match(illustration.prompt, /图片内容必须占主导/);
  assert.match(illustration.prompt, /不做文字型 PPT/);
  assert.ok(!Object.hasOwn(illustration, 'negativePrompt'));

  const infographic = buildVisualGenerationSpec(item, { platform: 'WECHAT', title: '普通人怎样使用AI工具' }, 'INFOGRAPHIC');
  assert.match(infographic.prompt, /不要文章标题/);
  assert.match(infographic.prompt, /图内文字必须极少/);
  assert.doesNotMatch(infographic.prompt, /不在图片内生成文字/);
  assert.ok(!Object.hasOwn(infographic, 'negativePrompt'));
});

test('搜索词描述文章主体和可见场景，不再描述模板字体和图标', () => {
  const plan = buildVisualPlan({
    title: '宇树科技上市进展：初步询价日为8月5日',
    category: '财经',
    coreMessage: '解释宇树科技IPO时间节点、股权结构和募资投向',
    body: '宇树科技进入IPO询价阶段。公司披露股权结构与募集资金用途，并展示人形机器人产品和研发场景。',
  }, 'WECHAT');
  const queries = plan.flatMap((entry) => entry.searchQueries);
  assert.ok(queries.some((query) => query.includes('宇树科技')));
  assert.ok(queries.every((query) => !/(模板|矢量|图标|字体|PPT|信息卡|知识卡|图表)/i.test(query)));
});

test('没有已保存方案时所有配图位保持未绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const merged = mergeVisualPlan(generated, null);
  assert.ok(merged.every((item) => item.assetId === null));
});

test('旧版方案自动升级搜索词并清空正文错误绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const oldPlan = generated.map((item, index) => ({
    ...item,
    searchQueries: ['天链三号01星 发射'],
    assetId: index === 0 ? 'cover-id' : `body-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, 1);
  assert.equal(upgraded[0].assetId, 'cover-id');
  assert.ok(upgraded.slice(1).every((item) => item.assetId === null));
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
    assetId: `asset-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, 2);
  assert.deepEqual(upgraded.map((item) => item.assetId), oldPlan.map((item) => item.assetId));
  assert.equal(upgraded[1].generationMode, 'INFOGRAPHIC');
  assert.doesNotMatch(upgraded[1].prompt, /不在图片内生成文字/);
});

test('当前版本方案保留用户已经编辑的内容和绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const persisted = generated.map((item, index) => ({ ...item, purpose: `自定义 ${index}`, assetId: index ? `body-${index}` : 'cover-id' }));
  assert.deepEqual(mergeVisualPlan(generated, persisted, VISUAL_PLAN_VERSION), persisted);
});

test('微博当前版本的空方案会被保留，不会在刷新后重新生成主图', () => {
  const generated = buildVisualPlan(article, 'WEIBO');
  assert.deepEqual(mergeVisualPlan(generated, [], VISUAL_PLAN_VERSION), []);
});

test('公众号支持指定正文插图数量，封面单独计算', () => {
  const plan = buildVisualPlan(article, 'WECHAT', { bodyItemCount: 4 });
  assert.equal(plan.length, 5);
  assert.equal(plan.filter((item) => item.role === 'COVER').length, 1);
  assert.equal(plan.filter((item) => item.role === 'BODY').length, 4);
  assert.equal(new Set(plan.slice(1).map((item) => item.searchQueries[0])).size, 4);
});

test('用户指定的正文配图数量会限制在平台合理范围内', () => {
  assert.deepEqual(visualPlanCountRange('WECHAT'), { min: 2, max: 11 });
  assert.deepEqual(visualPlanCountRange('ZHIHU'), { min: 2, max: 11 });
  assert.deepEqual(visualPlanCountRange('XIAOHONGSHU'), { min: 5, max: 8 });
  assert.deepEqual(visualPlanCountRange('WEIBO'), { min: 1, max: 9 });
  assert.equal(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 0 }).length, 3);
  assert.equal(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 99 }).length, 12);
  assert.equal(buildVisualPlan(article, 'XIAOHONGSHU', { bodyItemCount: 8 }).length, 9);
  assert.equal(buildVisualPlan(article, 'ZHIHU', { bodyItemCount: 99 }).length, 12);
  const weibo = buildVisualPlan(article, 'WEIBO', { bodyItemCount: 9 });
  assert.equal(weibo.length, 9);
  assert.deepEqual(weibo.map((item) => item.role), ['MAIN', 'BODY', 'BODY', 'BODY', 'BODY', 'BODY', 'BODY', 'BODY', 'BODY']);
});

test('调整配图数量时保留现有项和素材绑定，新项目保持未绑定', () => {
  const initial = buildVisualPlan(article, 'WECHAT', { bodyItemCount: 3 }).map((item, index) => ({
    ...item,
    purpose: `用户调整 ${index}`,
    assetId: `asset-${index}`,
  }));
  const expanded = resizeVisualPlan(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 5 }), initial);
  assert.equal(expanded.length, 6);
  assert.deepEqual(expanded.slice(0, 4).map((item) => item.assetId), ['asset-0', 'asset-1', 'asset-2', 'asset-3']);
  assert.ok(expanded.slice(4).every((item) => item.assetId === null));
  assert.equal(expanded[1].purpose, '用户调整 1');

  const reduced = resizeVisualPlan(buildVisualPlan(article, 'WECHAT', { bodyItemCount: 2 }), expanded);
  assert.equal(reduced.length, 3);
  assert.deepEqual(reduced.map((item) => item.assetId), ['asset-0', 'asset-1', 'asset-2']);
  assert.ok(reduced.every((item) => !['asset-3', 'asset-4', 'asset-5'].includes(item.assetId)));
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
  assert.doesNotMatch(inherited.prompt, /波普怀旧/);
  assert.match(inherited.prompt, /薄荷绿、婴儿蓝、珊瑚粉/);
  assert.match(inherited.prompt, /向四周展开一级分支/);

  const overridden = updateVisualPlanItem(inherited, { stylePreset: 'TECH_MEDIA' }, { platform: 'WECHAT', title: article.title }, { preset: 'RETRO_POP' });
  assert.doesNotMatch(overridden.prompt, /科技媒体/);
  assert.match(overridden.prompt, /cobalt blue, teal green and deep graphite/);
  assert.doesNotMatch(overridden.prompt, /波普怀旧/);
});

test('项目风格库覆盖编辑、知识、插画、文化和科技，并提供可执行视觉约束', () => {
  const styles = visualStylePresets();
  assert.ok(styles.length >= 25);
  assert.deepEqual(new Set(styles.map((style) => style.group)), new Set(['EDITORIAL', 'KNOWLEDGE', 'ILLUSTRATION', 'CREATIVE', 'CULTURAL', 'TECHNOLOGY']));
  assert.ok(styles.every((style) => style.description.length >= 8 && style.swatches.length === 4 && style.prompt.length >= 60));
  assert.ok(styles.every((style) => style.caseLabel && style.caseTitle && style.caseMeta));
  const retro = styles.find((style) => style.id === 'RETRO_POP');
  assert.match(retro.prompt, /薄荷绿.*婴儿蓝.*珊瑚粉.*奶油黄/);
  assert.match(retro.prompt, /丝网印刷网点|轻微错版/);
  assert.match(retro.prompt, /人物动作.*不幼稚/);
});

test('后端配图接口接受全部前端艺术方向预设', () => {
  const api = readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const enumBody = api.match(/const visualStylePreset = z\.enum\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  const serverStyleIds = new Set([...enumBody.matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]));
  const missing = visualStylePresets().map((style) => style.id).filter((id) => !serverStyleIds.has(id));
  assert.deepEqual(missing, []);
});

test('正式风格选择器只使用真实案例图清单并覆盖核心视觉方向', () => {
  const featured = visualStylePresets().filter((style) => style.featured);
  assert.equal(featured.length, 36);
  assert.ok(featured.every((style) => /^\/visual-style-previews\/[a-z0-9-]+\.png$/.test(style.previewImage)));
  assert.equal(featured.filter((style) => style.group === 'CREATIVE').length, 7);
  assert.equal(featured.filter((style) => style.group === 'CULTURAL').length, 5);
  assert.equal(featured.filter((style) => style.group === 'TECHNOLOGY').length, 5);
  assert.ok(featured.some((style) => style.id === 'MACARON_CARTOON' && /卡通/.test(style.name)));
  assert.ok(featured.some((style) => style.id === 'CYBER_TECH' && /赛博/.test(style.name)));
  assert.ok(featured.some((style) => style.id === 'PIXEL_RETRO' && /像素/.test(style.name)));
  assert.ok(featured.some((style) => style.id === 'BUSINESS_EDITORIAL'));
  assert.ok(featured.some((style) => style.id === 'SCIENCE_ATLAS'));
  assert.ok(featured.some((style) => style.id === 'INDUSTRIAL_MEDIA'));
  assert.ok(featured.some((style) => style.id === 'WOODCUT_PRINT'));
  assert.ok(featured.some((style) => style.id === 'MINERAL_FRESCO'));
  assert.ok(featured.some((style) => style.id === 'AI_LAB'));
  assert.ok(featured.some((style) => style.id === 'CLEAN_ENERGY'));
  assert.ok(featured.some((style) => style.id === 'KIDS_DOODLE'));
  assert.ok(featured.some((style) => style.id === 'COSMIC_HORROR'));
  assert.ok(featured.some((style) => style.id === 'WARM_3D_ANIMATION'));
  assert.ok(featured.some((style) => style.id === 'PIXEL_GAME'));
  assert.ok(featured.some((style) => style.id === 'SOFT_3D'));
  assert.ok(featured.some((style) => style.id === 'MINIMAL_KNOWLEDGE'));
});

test('艺术方向清单与正式案例路径一一对应且禁止平台拼图', () => {
  const manifest = JSON.parse(readFileSync(new URL('../scripts/visual-style-previews.json', import.meta.url), 'utf8'));
  const expected = new Map(visualStylePresets().filter((style) => style.featured).map((style) => [style.id, style.previewImage.split('/').at(-1)]));
  assert.equal(manifest.items.length, expected.size);
  assert.match(manifest.sharedPrompt, /single coherent scene/i);
  assert.match(manifest.sharedPrompt, /No poster layout, no presentation slide, no platform collage, no split panels/i);
  assert.deepEqual(new Map(manifest.items.map((item) => [item.id, item.filename])), expected);
});

test('精选艺术方向只控制视觉质感，不向最终生图指令注入版式模板', () => {
  const forbiddenLayoutLanguage = /PPT|卡片|标题安全区|多栏|字号层级|界面层|信息密度|图表|矩阵|结构树|步骤|编号|标签/;
  for (const style of visualStylePresets().filter((item) => item.featured)) {
    const plan = buildVisualPlan({ title: '创作者怎样整理研究资料', body: '创作者在桌前整理采访照片、研究笔记和事实依据，并从中筛选出文章真正需要的内容。' }, 'WECHAT');
    const compiled = buildVisualGenerationSpec(plan[0], { platform: 'WECHAT', title: '创作者怎样整理研究资料' }, 'ILLUSTRATION', { preset: style.id, customPrompt: '' });
    const artDirection = compiled.prompt.match(/项目统一视觉方向：(.+?)。系列一致性：/)?.[1] ?? '';
    assert.ok(artDirection, `${style.id} 缺少项目统一视觉方向`);
    assert.doesNotMatch(artDirection, forbiddenLayoutLanguage, `${style.id} 仍混入版式模板语言`);
  }
});

test('正式风格案例资产全部落盘且为有效 PNG', () => {
  const featured = visualStylePresets().filter((style) => style.featured);
  for (const style of featured) {
    const assetUrl = new URL(`../public${style.previewImage}`, import.meta.url);
    assert.ok(statSync(assetUrl).size > 100_000, `${style.id} 案例图不应为空壳文件`);
    assert.deepEqual([...readFileSync(assetUrl).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test('项目统一补充要求会进入每张图的提示词', () => {
  const [item] = buildVisualPlan(article, 'WECHAT');
  const updated = updateVisualPlanItem(item, {}, { platform: 'WECHAT', title: article.title }, {
    preset: 'RETRO_POP',
    customPrompt: '所有图片统一使用薄荷绿边框，人物服装不要出现高饱和紫色',
  });
  assert.match(updated.prompt, /项目统一补充要求/);
  assert.match(updated.prompt, /薄荷绿边框/);
  assert.match(updated.prompt, /不要出现高饱和紫色/);
});

test('重新规划默认保留已选图片，用户明确取消时只解除正文图绑定', () => {
  const current = buildVisualPlan(article, 'WECHAT', { bodyItemCount: 3 }).map((item, index) => ({ ...item, assetId: `asset-${index}` }));
  const kept = replanVisualPlan({ ...article, body: `新的正文先解释普通人使用中继卫星服务的实际场景。\n\n${article.body}` }, 'WECHAT', current, {
    bodyItemCount: 3,
    styleProfile: { preset: 'RETRO_POP', customPrompt: '统一使用薄荷绿边框' },
  });
  assert.deepEqual(kept.map((item) => item.assetId), current.map((item) => item.assetId));
  assert.notEqual(kept[1].prompt, current[1].prompt);
  assert.doesNotMatch(kept[1].prompt, /清新波普怀旧/);
  assert.match(kept[1].prompt, /薄荷绿、婴儿蓝、珊瑚粉/);
  assert.match(kept[1].prompt, /统一使用薄荷绿边框/);

  const cleared = replanVisualPlan(article, 'WECHAT', current, { bodyItemCount: 3, keepAssignedAssets: false });
  assert.equal(cleared[0].assetId, 'asset-0');
  assert.ok(cleared.slice(1).every((item) => item.assetId === null));
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
    references: [{ assetId: '11111111-1111-4111-8111-111111111111', uses: ['COLOR', 'LAYOUT'] }],
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
    assetId: `asset-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, 3);
  assert.equal(VISUAL_PLAN_VERSION, 8);
  assert.deepEqual(upgraded.map((item) => item.assetId), oldPlan.map((item) => item.assetId));
  assert.deepEqual(upgraded.map((item) => item.purpose), oldPlan.map((item) => item.purpose));
  assert.deepEqual(upgraded.map((item) => item.informationPoints), oldPlan.map((item) => item.informationPoints));
  assert.ok(upgraded.every((item) => item.stylePreset === 'INHERIT' && Array.isArray(item.references) && item.templatePreset));
  assert.ok(upgraded.every((item) => item.prompt !== '旧提示词'));
  assert.ok(upgraded.every((item) => !Object.hasOwn(item, 'negativePrompt')));
});

test('第四版方案升级时移除独立负面提示词并保留图片绑定', () => {
  const generated = buildVisualPlan(article, 'WECHAT');
  const oldPlan = generated.map((item, index) => ({
    ...item,
    negativePrompt: '文字、水印、低清晰度',
    assetId: `asset-${index}`,
  }));
  const upgraded = mergeVisualPlan(generated, oldPlan, 4);
  assert.ok(upgraded.every((item) => !Object.hasOwn(item, 'negativePrompt')));
  assert.deepEqual(upgraded.map((item) => item.assetId), oldPlan.map((item) => item.assetId));
  assert.ok(upgraded.every((item) => item.prompt.includes('水印')));
});
