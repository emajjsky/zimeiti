import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import contentMasterModule from '../server/services/content-master.cjs';
import copyActionModule from '../server/services/project-copy-action.cjs';

const { loadContentMasterState } = contentMasterModule;

const {
  COPY_ACTIONS,
  buildCopyPrompt,
  buildWritingPacket,
  buildFinishedCopyPrompt,
  parseFinishedCopyBody,
  copyActionPersistenceMode,
  buildCopyQualityReviewPrompt,
  detectVoiceViolations,
  copyActionVersion,
  copyTemplateScope,
  defaultRevisionTemplate,
  applyAcceptedCopyToState,
  copyPromptTemplateScope,
  mergeFactsToVerify,
  reconcileFactsToVerify,
  parseCopyOutput,
  parseCopyQualityReview,
  parseCopyQualityReviewSafely,
  candidateQualityReview,
  resolveCopyAction,
} = copyActionModule;

test('已核验研究事实不会再次进入正文候选的发布前核验列表', () => {
  const verifiedFacts = [
    { claim: '宇树科技本次拟公开发行股份4044.6434万股，占发行后总股本10%' },
    { claim: '宇树科技IPO全程仅用时73天' },
    { claim: '王兴兴在表决权差异安排下合计控制公司68.78%的表决权' },
    { claim: '宇树科技IPO计划募集资金总额为42.02亿元' },
  ];
  const candidateFacts = [
    '宇树科技本次拟公开发行股份 4044.6434 万股，占发行后总股本的 10%',
    '宇树科技 IPO 申请从获上交所正式受理到上会并通过审议，全程仅用时 73 天',
    '上交所官网显示，宇树科技股份有限公司科创板 IPO 审核状态已变更为注册生效',
    '宇树科技本次 IPO 计划募集资金总额为 42.02 亿元',
    '宇树科技存在特别表决权机制安排，实际控制人王兴兴在表决权差异安排下合计控制公司 68.78% 的表决权',
  ];

  assert.deepEqual(reconcileFactsToVerify(candidateFacts, verifiedFacts), [
    '上交所官网显示，宇树科技股份有限公司科创板 IPO 审核状态已变更为注册生效',
  ]);
});

test('账号声音规则检测明确的 AI 套话、emoji 标题和强制互动', () => {
  const issues = detectVoiceViolations('很多人会问：这意味着什么？\n\n✨ 总结\n\n建议点赞收藏，评论区聊聊。', {
    bannedPhrases: ['很多人会问'],
    bannedStructures: ['emoji 小标题', '强制互动结尾'],
  });
  assert.deepEqual(issues.map((item) => item.code), ['BANNED_PHRASE', 'EMOJI_HEADING', 'FORCED_CTA']);
});

test('历史账号声音审查结果仍可读取，但不参与新的正文生成执行链', () => {
  assert.deepEqual(candidateQualityReview(
    { approved: true, issues: [] },
    [{ code: 'BANNED_PHRASE', excerpt: '这意味着', message: '避免使用套话：这意味着' }],
  ), {
    status: 'NEEDS_REVIEW',
    issues: ['避免使用套话：这意味着'],
  });
});

test('写作资料包只保留顶层已核验事实，不泄漏证据摘录和旧审稿信息', () => {
  const packet = buildWritingPacket({
    projectId: 'project-1',
    platform: 'WECHAT',
    project: {
      title: '宇树科技 IPO 到底意味着什么',
      planning: { title: '宇树科技 IPO 到底意味着什么', category: '财经', angle: '解释上市进程', objective: '帮助普通读者看懂', targetAudience: '普通投资者', coreMessage: '看懂进程，不做收益承诺' },
    },
    brief: { lengthTarget: '1800 字', notes: '语气克制' },
    accountVoice: { name: '把话说透', rules: { opening: '先给判断', bannedPhrases: ['众所周知'] } },
    materials: [{ id: 'draft-1', kind: 'DRAFT', title: '我的草稿', body: '这是作者自己的判断。' }],
    researchContext: {
      verifiedFacts: [{ claim: 'IPO 计划募集资金总额为 42.02 亿元', status: 'VERIFIED', evidence: [{ sourceId: 'source-1', quote: '3 月 20 日另有一项旁支信息' }] }],
      cautions: [{ claim: '预计上市后股价翻倍', status: 'NEEDS_REVIEW', evidence: [{ sourceId: 'source-2', quote: '未经核验的预测' }] }],
      creativeReferences: [{ id: 'ref-1', purpose: 'STRUCTURE', summary: '先事件后影响', originalText: '不得复制的参考原文' }],
    },
    qualityReview: { status: 'NEEDS_REVIEW', issues: ['旧审稿问题'] },
  });

  assert.equal(packet.lockedTitle, '宇树科技 IPO 到底意味着什么');
  assert.deepEqual(packet.verifiedClaims, [{ id: 'claim-1', claim: 'IPO 计划募集资金总额为 42.02 亿元', sourceIds: ['source-1'] }]);
  assert.deepEqual(packet.forbiddenClaims, ['预计上市后股价翻倍']);
  assert.equal(packet.authorMaterials[0].content, '这是作者自己的判断。');
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /3 月 20 日|未经核验的预测|不得复制的参考原文|旧审稿问题|qualityReview|evidence/);
});

test('首次正文使用锁定标题和纯文本单次成稿契约', () => {
  const packet = buildWritingPacket({
    projectId: 'project-1', platform: 'WECHAT',
    project: { title: '锁定标题', planning: { title: '锁定标题', category: '科技', targetAudience: '普通读者', objective: '解释变化', coreMessage: '给出清晰判断' } },
    brief: { lengthTarget: '1200 字' }, materials: [], researchContext: { verifiedFacts: [], cautions: [] },
  });
  const prompt = buildFinishedCopyPrompt(packet, '写成适合公众号阅读的完整文章。');
  assert.match(prompt.system, /只输出最终正文/);
  assert.doesNotMatch(prompt.system, /JSON|factsToVerify|changeSummary|候选/);
  assert.equal(parseFinishedCopyBody('这是完整正文。'.repeat(50), packet).title, '锁定标题');
  assert.throws(() => parseFinishedCopyBody('```json\n{"body":"错误"}\n```', packet), /代码围栏|JSON|正文/);
});

test('首次正文自动把平台常见 Markdown 归一化为可保存纯文本', () => {
  const packet = buildWritingPacket({
    projectId: 'project-markdown', platform: 'XIAOHONGSHU',
    project: { title: '宇树科技 IPO 到底意味着什么', planning: { title: '宇树科技 IPO 到底意味着什么' } },
    brief: { lengthTarget: '300-800 字' }, materials: [], researchContext: { verifiedFacts: [], cautions: [] },
  });
  const parsed = parseFinishedCopyBody([
    '# 宇树科技 IPO 到底意味着什么',
    '',
    '## 先说结论',
    '',
    '> 这不是一次普通的资本市场新闻。',
    '',
    '- **看业务**：资金将继续投向研发。',
    '- **看行业**：机器人赛道进入新阶段。',
    '- [看风险说明](https://example.com/risk)：仍要关注定价与兑现节奏。',
    '',
    '真正值得普通读者关注的，不是一个短期数字，而是企业如何把技术、产品和商业化连接起来。'.repeat(3),
  ].join('\n'), packet);

  assert.equal(parsed.title, '宇树科技 IPO 到底意味着什么');
  assert.doesNotMatch(parsed.body, /(^|\n)\s*#{1,6}\s|\*\*|__|^>\s|\[[^\]]+\]\([^)]+\)/m);
  assert.doesNotMatch(parsed.body, /^宇树科技 IPO 到底意味着什么$/m);
  assert.match(parsed.body, /^先说结论$/m);
  assert.match(parsed.body, /^• 看业务：资金将继续投向研发。$/m);
  assert.match(parsed.body, /看风险说明：仍要关注定价与兑现节奏/);
});

test('正文格式归一化后仍执行内容安全和完整性校验', () => {
  const packet = { lockedTitle: '锁定标题' };
  assert.throws(() => parseFinishedCopyBody('{"body":"结构化正文"}', packet), /结构化对象/);
  assert.throws(() => parseFinishedCopyBody('正文泄漏 writingPacket 内部字段。'.repeat(10), packet), /内部字段/);
  assert.throws(() => parseFinishedCopyBody('# 锁定标题\n\n**太短了**', packet), /不完整/);
});

test('首次生成直接正式保存，只有主动修改保留候选', () => {
  assert.equal(copyActionPersistenceMode('GENERATE_DRAFT'), 'ACCEPTED');
  assert.equal(copyActionPersistenceMode('POLISH_EXISTING_DRAFT'), 'CANDIDATE');
  assert.equal(copyActionPersistenceMode('RESTRUCTURE_DRAFT'), 'CANDIDATE');
});

test('文案提示词携带账号声音规则与本篇语气，但不携带校准原文', () => {
  const prompt = buildCopyPrompt({
    action: 'GENERATE_DRAFT', request: '生成正文', platform: 'WECHAT', template: '写成文章。',
    project: { title: '标题', coreViewpoint: '观点', factChecks: [] },
    brief: { objective: '完成文章', targetAudience: '读者', coreMessage: '观点', sourceRequirements: '', lengthTarget: '1200 字', notes: '' },
    currentContent: { title: '', body: '', factsToVerify: [] }, skills: [], materials: [],
    accountVoice: { name: '把话说透', version: 2, offset: 'SHARPER', rules: { opening: '先给判断', bannedPhrases: ['很多人会问'] }, calibrationFullText: '不应出现的原文' },
  });
  assert.match(prompt.message, /把话说透/);
  assert.match(prompt.message, /SHARPER/);
  assert.doesNotMatch(prompt.message, /不应出现的原文/);
});

function routeSlice(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `缺少路由 ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `缺少后续路由 ${end}`);
  return source.slice(from, to);
}

test('文案请求按固定优先级确定性映射到注册动作', () => {
  assert.equal(resolveCopyAction({ request: '把这篇文章润色一下', hasBody: true }).action, 'POLISH_EXISTING_DRAFT');
  assert.equal(resolveCopyAction({ request: '压缩到 800 字', hasBody: true }).action, 'SHORTEN_DRAFT');
  assert.equal(resolveCopyAction({ request: '改成微博串文', hasBody: true, targetPlatform: 'WEIBO' }).action, 'ADAPT_PLATFORM');
  assert.equal(resolveCopyAction({ request: '把选中的两段改得更清楚', hasBody: true, selection: '原文' }).action, 'REVISE_SELECTION');
  assert.equal(resolveCopyAction({ request: '扩写这篇内容', hasBody: true }).action, 'EXPAND_DRAFT');
  assert.equal(resolveCopyAction({ request: '重新调整文章结构', hasBody: true }).action, 'RESTRUCTURE_DRAFT');
  assert.equal(resolveCopyAction({ request: '先生成文章大纲', hasBody: false }).action, 'GENERATE_OUTLINE');
  assert.equal(resolveCopyAction({ request: '写一篇完整正文', hasBody: false }).action, 'GENERATE_DRAFT');
});

test('正文为空时，开始或正文默认生成完整正文而不反问', () => {
  assert.equal(resolveCopyAction({ request: '开始', hasBody: false }).action, 'GENERATE_DRAFT');
  assert.equal(resolveCopyAction({ request: '正文', hasBody: false }).action, 'GENERATE_DRAFT');
});

test('无法唯一判断的请求要求澄清且不创建动作', () => {
  assert.deepEqual(resolveCopyAction({ request: '处理一下', hasBody: true }), {
    needsClarification: true,
    question: '你希望润色、重构、扩写还是压缩当前文案？',
  });
  assert.deepEqual(resolveCopyAction({ request: '把这篇文章润色并压缩', hasBody: true }), {
    needsClarification: true,
    question: '这次要优先润色表达，还是压缩篇幅？',
  });
});

test('八个文案动作拥有稳定版本且模型输出保持待核验事实', () => {
  assert.equal(COPY_ACTIONS.length, 8);
  assert.equal(copyActionVersion('SHORTEN_DRAFT'), 'project-copy-shorten-draft:1.0.0');
  const output = parseCopyOutput(JSON.stringify({
    title: '调整后的标题',
    body: '这是调整后的完整正文。'.repeat(12),
    changeSummary: '压缩重复表达并保留核心观点。',
    factsToVerify: ['核验公开数据的发布日期'],
  }), 'SHORTEN_DRAFT');
  assert.deepEqual(output.factsToVerify, ['核验公开数据的发布日期']);
  assert.throws(() => parseCopyOutput(JSON.stringify({ ...output, factsToVerify: '已经核验' }), 'SHORTEN_DRAFT'), /array|expected/i);
});

test('四个平台拥有独立修订提示词 Scope 和规则', () => {
  for (const platform of ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']) {
    assert.equal(copyTemplateScope(platform), `CREATIVE_REVISION_${platform}`);
  }
  assert.match(defaultRevisionTemplate('WECHAT'), /公众号/);
  assert.match(defaultRevisionTemplate('XIAOHONGSHU'), /小红书/);
  assert.match(defaultRevisionTemplate('ZHIHU'), /知乎|论证/);
  assert.match(defaultRevisionTemplate('WEIBO'), /微博|单条|串文/);
});

test('文案提示词冻结动作、平台规则并禁止洗掉待核验事实', () => {
  const prompt = buildCopyPrompt({
    action: 'POLISH_EXISTING_DRAFT',
    request: '让表达更自然',
    platform: 'WECHAT',
    template: '保留作者的个人表达。',
    project: { title: '项目标题', coreViewpoint: '核心观点', factChecks: ['核验价格'] },
    brief: { objective: '完成文章', targetAudience: '普通读者', coreMessage: '先说明边界', sourceRequirements: '使用公开来源', lengthTarget: '1500 字', notes: '' },
    currentContent: { title: '原标题', body: '原正文', factsToVerify: ['核验价格'] },
    skills: [{ dimension: 'VOICE', name: '自然', version: { version: '1.0.0', instructions: '短句表达。' } }],
    materials: [],
  });
  assert.match(prompt.system, /POLISH_EXISTING_DRAFT/);
  assert.match(prompt.system, /factsToVerify/);
  assert.match(prompt.system, /不得.*已确认事实/);
  assert.match(prompt.message, /保留作者的个人表达/);
  assert.match(prompt.message, /核验价格/);
});

test('文案提示词锁定项目主题，并把未经核验的信息排除在确定事实之外', () => {
  const prompt = buildCopyPrompt({
    action: 'GENERATE_DRAFT',
    request: '生成正文',
    platform: 'WECHAT',
    template: '写成适合公众号阅读的文章。',
    project: { title: '传统家具的 AI 进化论', coreViewpoint: 'AI 应服务于传统家具的设计、生产与传播', factChecks: [] },
    brief: { objective: '完成文章', targetAudience: '家居从业者', coreMessage: '技术要服务于真实行业问题', sourceRequirements: '使用已核验资料', lengthTarget: '1500 字', notes: '' },
    currentContent: { title: '', body: '', factsToVerify: [] },
    researchContext: { verifiedFacts: ['某工厂已将 AI 用于产品建模'], cautions: ['7 月 27 日有 300 人参加某会议'] },
    materials: [],
  });
  assert.match(prompt.system, /项目标题、核心观点和目标平台是硬主题边界/);
  assert.match(prompt.system, /不得用研究资料中的单条事件替换项目主题/);
  assert.match(prompt.system, /不得写入未出现在 verifiedFacts 中的具体日期、单位、人数、引语、会议或产品能力/);
  assert.match(prompt.system, /没有 verifiedFacts 时，只能依据用户材料、当前正文或观点方法写作/);
});

test('公众号正文强制移动端文章结构，并拒绝把 Markdown 标记泄漏到正式成稿', () => {
  const prompt = buildCopyPrompt({
    action: 'GENERATE_DRAFT',
    request: '生成正文',
    platform: 'WECHAT',
    template: '写成适合公众号阅读的文章。',
    project: { title: '一颗卫星上天，对普通人意味着什么', coreViewpoint: '解释技术如何改变日常体验', factChecks: [] },
    brief: { objective: '完成文章', targetAudience: '普通读者', coreMessage: '先讲清与读者的关系', sourceRequirements: '使用已核验资料', lengthTarget: '1500 字', notes: '' },
    currentContent: { title: '', body: '', factsToVerify: [] },
    materials: [],
  });
  assert.match(prompt.system, /公众号正文开篇先写一个读者熟悉的场景、疑问或反差/);
  assert.match(prompt.system, /不要写成百科词条、新闻通稿或教科书解释/);
  assert.match(prompt.system, /纯文本成稿：不得使用 Markdown 标记/);
  assert.throws(() => parseCopyOutput(JSON.stringify({
    title: '标题',
    body: `**一、这不是公众号小标题**\n\n${'这是一段错误示例，用来确保 Markdown 标记不能泄漏到正式文稿。'.repeat(3)}`,
    changeSummary: '生成候选',
    factsToVerify: [],
  }), 'GENERATE_DRAFT'), /Markdown/);
});

test('待复核主张不能作为项目核心观点注入生成上下文', () => {
  const claim = '该卫星主要用于为飞船、空间实验室、空间站等载人航天器提供数据中继和测控服务。';
  const prompt = buildCopyPrompt({
    action: 'GENERATE_DRAFT',
    request: '生成正文',
    platform: 'WECHAT',
    template: '写成适合公众号阅读的文章。',
    project: { title: '我国成功发射天链三号01星', coreViewpoint: claim, factChecks: [] },
    brief: { objective: '解释发射新闻', targetAudience: '普通读者', coreMessage: claim, sourceRequirements: '', lengthTarget: '1500 字', notes: '' },
    currentContent: { title: '', body: '', factsToVerify: [] },
    researchContext: { verifiedFacts: [], cautions: [{ claim, status: 'NEEDS_REVIEW' }] },
    materials: [],
  });
  const message = JSON.parse(prompt.message);
  assert.equal(message.project.coreViewpoint, undefined);
  assert.equal(message.writingBrief.coreMessage, undefined);
  assert.equal(message.researchContext.cautions[0].claim, claim);
  assert.match(prompt.system, /待复核主张禁止写入区/);
});

test('公众号候选不得把待复核主张写成正文事实', () => {
  const claim = '该卫星主要用于为飞船、空间实验室、空间站等载人航天器提供数据中继和测控服务。';
  assert.throws(() => parseCopyOutput(JSON.stringify({
    title: '这颗卫星上天意味着什么？',
    body: `这是一段面向普通读者的完整公众号正文，用于解释一条航天新闻的阅读方法。\n\n这颗卫星为载人航天器提供数据中继和测控服务。\n\n${'正文还需要保持清晰、克制，并把未核验信息留在核验清单中。'.repeat(5)}`,
    changeSummary: '生成候选',
    factsToVerify: [claim],
  }), 'GENERATE_DRAFT', { platform: 'WECHAT', researchContext: { cautions: [{ claim, status: 'NEEDS_REVIEW' }] } }), /待复核|正文/);
});

test('重构已有正文自动继承待复核事实，且拒绝新增待复核事实', () => {
  const claim = '该卫星主要用于为飞船、空间实验室、空间站等载人航天器提供数据中继和测控服务。';
  const body = `这是一篇正在重构的公众号文章，原稿已提到该卫星为载人航天器提供数据中继和测控服务。\n\n${'重构只改善结构与表达，不新增未经核验的用途、数据或影响推演。'.repeat(5)}`;
  const output = parseCopyOutput(JSON.stringify({ title: '这颗卫星上天意味着什么？', body, changeSummary: '重组原有叙事结构。', factsToVerify: [] }), 'RESTRUCTURE_DRAFT', {
    currentContent: { body },
    researchContext: { cautions: [{ claim, status: 'NEEDS_REVIEW' }] },
  });
  assert.deepEqual(output.factsToVerify, [claim]);
  assert.throws(() => parseCopyOutput(JSON.stringify({ title: '标题', body, changeSummary: '错误示例', factsToVerify: [] }), 'RESTRUCTURE_DRAFT', {
    currentContent: { body: '不包含这条主张的原稿。' },
    researchContext: { cautions: [{ claim, status: 'NEEDS_REVIEW' }] },
  }), /待复核|正文/);
});

test('文案质量审稿只以已核验事实为准，并返回可执行的重写结论', () => {
  const retainedClaim = '该卫星主要用于为飞船、空间实验室、空间站等载人航天器提供数据中继和测控服务。';
  const review = parseCopyQualityReview(JSON.stringify({ approved: false, issues: ['正文把待复核用途写成了确定事实'] }));
  assert.deepEqual(review, { approved: false, issues: ['正文把待复核用途写成了确定事实'] });
  assert.deepEqual(candidateQualityReview(review), { status: 'NEEDS_REVIEW', issues: ['正文把待复核用途写成了确定事实'] });
  assert.deepEqual(candidateQualityReview({ approved: true, issues: ['应被忽略'] }), { status: 'PASSED', issues: [] });
  assert.throws(() => parseCopyQualityReview(JSON.stringify({ approved: 'false', issues: [] })), /boolean|expected/i);
  const prompt = buildCopyQualityReviewPrompt({
    action: 'RESTRUCTURE_DRAFT',
    platform: 'WECHAT',
    output: { title: '示例', body: '示例正文', changeSummary: '生成候选', factsToVerify: [] },
    currentContent: { body: `原稿中已有：${retainedClaim}` },
    researchContext: { verifiedFacts: [{ claim: '已核验事实' }], cautions: [{ claim: retainedClaim }] },
  });
  assert.match(prompt.system, /不得使用模型已有知识补全事实/);
  assert.match(prompt.system, /issues 必须是字符串数组/);
  const reviewInput = JSON.parse(prompt.message);
  assert.deepEqual(reviewInput.allowedExistingCautions, [retainedClaim]);
});

test('历史质量审稿数据仍可兼容读取，但 Worker 不再调用审稿与自动重写', () => {
  assert.deepEqual(parseCopyQualityReview(JSON.stringify({
    approved: false,
    issues: [
      { problem: '资金用途缺少证据', suggestion: '删除具体用途推演' },
      { message: '结尾存在主观扩展' },
    ],
  })), {
    approved: false,
    issues: ['资金用途缺少证据；删除具体用途推演', '结尾存在主观扩展'],
  });

  assert.deepEqual(parseCopyQualityReviewSafely('{不是有效 JSON'), {
    approved: false,
    issues: ['质量审稿返回格式异常，候选正文已保留，请人工检查。'],
    malformed: true,
  });

  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const execute = routeSlice(worker, 'async function generateProjectCopyAction', 'async function generateAgentPlan');
  assert.doesNotMatch(execute, /buildCopyQualityReviewPrompt|parseCopyQualityReviewSafely|candidateQualityReview|detectVoiceViolations/);
  assert.doesNotMatch(execute, /buildCopyRepairPrompt/);
});

test('017 注册八个需要确认的受控文案动作', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/017_project_copy_actions.sql', import.meta.url), 'utf8');
  for (const action of COPY_ACTIONS) assert.match(migration, new RegExp(copyActionVersion(action).replace(/[.]/g, '\\.')));
  assert.match(migration, /requires_confirmation/);
  assert.match(migration, /CONTENT_WRITING/);
  assert.match(migration, /CONTENT_REWRITE/);
});

test('四平台修订提示词在设置页可见并接入服务端模板仓储', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../src/workspaces/settings/PromptTemplateSettings.tsx', import.meta.url), 'utf8');
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.WECHAT/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.XIAOHONGSHU/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.ZHIHU/);
  assert.match(server, /REVISION_TEMPLATE_SCOPES\.WEIBO/);
  assert.match(api, /CREATIVE_REVISION_WECHAT/);
  assert.match(api, /CREATIVE_REVISION_WEIBO/);
  assert.match(settings, /id: 'REVISION', label: '修改文案'/);
});

test('不同文案动作冻结对应的大纲、初稿或修订模板', () => {
  assert.equal(copyPromptTemplateScope('GENERATE_OUTLINE', 'WECHAT'), 'CREATIVE_OUTLINE_WECHAT');
  assert.equal(copyPromptTemplateScope('GENERATE_DRAFT', 'ZHIHU'), 'CREATIVE_DRAFT_ZHIHU');
  assert.equal(copyPromptTemplateScope('POLISH_EXISTING_DRAFT', 'WEIBO'), 'CREATIVE_REVISION_WEIBO');
});

test('Project Agent prepare 不入队，confirm 才创建 Worker Job', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepare = routeSlice(server, "/agent/prepare", "/agent-runs/:id/confirm");
  const confirm = routeSlice(server, "/agent-runs/:id/confirm", "/agent-runs/:id/cancel");
  assert.match(prepare, /status.*DRAFT/s);
  assert.doesNotMatch(prepare, /await enqueue/);
  assert.match(confirm, /PROJECT_COPY_ACTION/);
  assert.match(confirm, /await enqueue/);
});

test('Project Agent Worker 首次生成直接落正式正文，主动修改才保存候选', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const execute = routeSlice(worker, 'async function generateProjectCopyAction', 'async function generateAgentPlan');
  assert.match(worker, /PROJECT_COPY_ACTION/);
  assert.match(execute, /project_artifacts/);
  assert.match(execute, /platform_content_versions/);
  assert.match(execute, /copyActionPersistenceMode\(snapshot\.action\)/);
  assert.match(execute, /status:\s*persistenceMode/);
  assert.match(execute, /updateCreativeProjects/);
  assert.match(execute, /applyAcceptedCopyToState/);
  assert.match(execute, /accepted_at = now\(\)/);
  assert.doesNotMatch(execute, /qualityReview/);
});

test('首次正文根据项目母版历史递增版本号，不重复创建版本一', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const execute = routeSlice(worker, 'async function generateProjectCopyAction', 'async function generateAgentPlan');
  assert.match(worker, /loadContentMasterState/);
  assert.match(execute, /loadContentMasterState\(client, workspaceId, snapshot\.projectId\)/);
  assert.match(execute, /masterState\.nextVersion/);
  assert.match(execute, /masterState\.parentVersionId/);
  assert.doesNotMatch(execute, /content_master_versions[\s\S]{0,250}VALUES \(\$1, \$2, \$3, 1,/);
});

test('项目母版状态在事务锁内返回已采用版本和下一版本', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      return { rows: [{ accepted_master_id: 'master-2', next_master_version: '4', parent_master_version_id: 'master-3' }] };
    },
  };
  const state = await loadContentMasterState(client, 'workspace-1', 'project-1');
  assert.deepEqual(state, { acceptedMasterId: 'master-2', nextVersion: 4, parentVersionId: 'master-3' });
  assert.match(calls[0].sql, /pg_advisory_xact_lock\(hashtextextended/);
  assert.deepEqual(calls[0].params, ['content-master:workspace-1:project-1']);
  assert.match(calls[1].sql, /MAX\(m\.version_number\)/);
});

test('采用修改候选时根据项目母版历史递增版本号', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const accept = routeSlice(server, "/project-artifacts/:id/accept", "/project-artifacts/:id/reject");
  assert.match(server, /loadContentMasterState/);
  assert.match(accept, /loadContentMasterState\(client, workspace\.id, candidate\.project_id\)/);
  assert.match(accept, /masterState\.nextVersion/);
  assert.match(accept, /masterState\.parentVersionId/);
  assert.doesNotMatch(accept, /content_master_versions[\s\S]{0,250}VALUES \(\$1, \$2, \$3, 1,/);
});

test('首次正文没有独立研究 Scope 时复用正文模型准备上下文', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepare = routeSlice(server, "/agent/prepare", "/agent-runs/:id/confirm");
  assert.match(prepare, /const primaryRoute = \{ provider: route\.provider, connectionId: route\.connectionId \?\? null, model: route\.model \}/);
  assert.match(prepare, /researchPolicy\.rowCount \? \{ provider: 'BAILIAN_CLI',[^\n]+ \} : primaryRoute/);
  assert.match(prepare, /verificationPolicy\.rowCount \? \{ provider: 'BAILIAN_CLI',[^\n]+ \} : primaryRoute/);
});

test('自动研究失败时降级使用已有上下文继续写正文', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const prepareStart = worker.indexOf('async function prepareCopyResearchContext');
  const prepareEnd = worker.indexOf('async function generateProjectCopyAction', prepareStart);
  const prepare = worker.slice(prepareStart, prepareEnd);
  assert.match(prepare, /catch \(error\)/);
  assert.match(prepare, /automatic research failed/);
  assert.match(prepare, /researchContext:\s*snapshot\.researchContext/);
});

test('采用候选时更新正式版本并合并待核验事实', () => {
  const state = {
    projects: [{
      id: 'project-1',
      title: '项目',
      status: 'BRIEF',
      factChecks: ['核验原始价格', ''],
      versions: [{ id: 'wechat-1', platform: 'WECHAT', status: 'DRAFT', title: '旧标题', body: '旧正文', updatedAt: '旧时间' }],
    }],
  };
  const result = applyAcceptedCopyToState(state, {
    projectId: 'project-1',
    platform: 'WECHAT',
    title: '新标题',
    body: '新正文',
    factsToVerify: ['核验原始价格', ' 核验发布日期 '],
    updatedAt: '12:30',
  });
  assert.equal(result.project.status, 'WRITING');
  assert.equal(result.project.stage, 'PLATFORM_ADAPTATION');
  assert.equal(result.project.versions[0].title, '新标题');
  assert.equal(result.project.versions[0].body, '新正文');
  assert.deepEqual(result.project.factChecks, ['核验原始价格', '核验发布日期']);
  assert.deepEqual(mergeFactsToVerify([' A ', '', 'B'], ['B', 'C']), ['A', 'B', 'C']);
});

test('采用候选、完成平台版本和启用平台都通过项目仓储串行更新且保持幂等', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const repository = fs.readFileSync(new URL('../server/services/project-planning.cjs', import.meta.url), 'utf8');
  const accept = routeSlice(server, "/project-artifacts/:id/accept", "/projects/:projectId/platforms/:platform");
  const enable = routeSlice(server, "/projects/:projectId/platforms/:platform", "/projects/:projectId/platform-versions/complete");
  const complete = routeSlice(server, "/projects/:projectId/platform-versions/complete", "/agent/skills");
  assert.match(accept, /FOR UPDATE OF a(?!, v)/);
  assert.doesNotMatch(accept, /FOR UPDATE OF a, v/);
  assert.match(accept, /updateCreativeProjects/);
  assert.doesNotMatch(accept, /workspace_snapshots/);
  assert.match(accept, /platform_content_versions/);
  assert.match(accept, /upsertStageSummary/);
  assert.match(enable, /updateCreativeProjects/);
  assert.match(enable, /some\(/);
  assert.match(enable, /VIDEO_CHANNEL/);
  assert.match(complete, /updateCreativeProjects/);
  assert.match(complete, /PLATFORM_ADAPTATION/);
  assert.match(complete, /\[input\.platform\]: \{ \.\.\.currentPlatform, stage: needsVisual\(input\.platform\) \? 'VISUAL' : 'LAYOUT'/);
  assert.match(repository, /workspace_snapshots WHERE workspace_id = \$1 FOR UPDATE/);
  assert.match(repository, /content_projects WHERE workspace_id = \$1 ORDER BY position, updated_at DESC FOR UPDATE/);
});
