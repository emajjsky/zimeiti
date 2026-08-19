import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import copyActionModule from '../server/services/project-copy-action.cjs';
import queueModule from '../server/queue.cjs';
import researchModule from '../server/services/project-research.cjs';

const { buildWritingPacket, parseFinishedCopyBody, parseRevisionCopyBody, copyMaxTokensForLength, buildCopyPrompt } = copyActionModule;
const { queueJobOptions, isFinalQueueAttempt } = queueModule;
const { RESEARCH_PLAN_TOOL_NAME, researchPlanTool } = researchModule;

test('研究计划使用严格工具契约而不是自由文本 JSON', () => {
  assert.equal(RESEARCH_PLAN_TOOL_NAME, 'submit_research_plan');
  assert.equal(researchPlanTool.function.name, RESEARCH_PLAN_TOOL_NAME);
  assert.deepEqual(researchPlanTool.function.parameters.required, ['title', 'summary', 'researchBrief', 'questions', 'claims', 'nextActions']);
});

test('未核验主张不能同时作为正文核心表达继续传递', () => {
  const claim = 'Wan3.0 首次支持 doc、xls、ppt、pdf、md 等文档格式作为视频生成输入源';
  const packet = buildWritingPacket({
    projectId: 'project-claim-boundary',
    platform: 'WECHAT',
    project: { title: '办公工具的新变化', planning: { title: '办公工具的新变化', category: '科技', coreMessage: claim } },
    brief: { coreMessage: claim, lengthTarget: '1200 字' },
    researchContext: { verifiedFacts: [], cautions: [{ id: 'claim-wan3-doc-input', claim, status: 'SINGLE_SOURCE' }] },
  });
  assert.equal(packet.coreMessage, '');
  assert.deepEqual(packet.unresolvedClaims, [{ id: 'claim-wan3-doc-input', claim, status: 'SINGLE_SOURCE' }]);
});

test('用户确认的规划标题不因研究待核验清单被正文入口拦截', () => {
  const claim = 'Wan3.0 首次支持 doc、xls、ppt、pdf、md 等文档格式作为视频生成输入源';
  assert.doesNotThrow(() => buildWritingPacket({
    projectId: 'project-unsafe-title',
    platform: 'WECHAT',
    project: { title: claim, planning: { title: claim, category: '科技' } },
    researchContext: { cautions: [{ id: 'claim-wan3-doc-input', claim, status: 'SINGLE_SOURCE' }] },
  }));
});

test('公开链接摄取的正文作为来源材料进入写作资料包，而不是被误判为作者草稿', () => {
  const packet = buildWritingPacket({
    projectId: 'project-reference-material',
    platform: 'WECHAT',
    project: { title: '跨界联姻', planning: { title: '跨界联姻', category: '科技' } },
    materials: [{ id: 'reference-1', kind: 'REFERENCE', title: '公开报道', body: '来源正文中的完整事实描述。' }],
    researchContext: { verifiedFacts: [], cautions: [] },
  });
  assert.deepEqual(packet.authorMaterials, [{ id: 'reference-1', kind: 'REFERENCE', content: '来源正文中的完整事实描述。' }]);
});

test('正文和大纲准备阶段默认读取项目全部写作资料，不依赖前端再次勾选', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const copyPrepare = server.slice(server.indexOf("app.post('/api/v1/creative/projects/:projectId/agent/prepare'"), server.indexOf("app.get('/api/v1/creative/agent-runs/:id'"));
  assert.match(copyPrepare, /projectWritingMaterialSnapshot\(workspace\.id, projectId, 'WECHAT'\)/);
  const outlinePrepare = server.slice(server.indexOf('/outline/prepare'), server.indexOf('/outline-runs/:id/confirm'));
  assert.match(outlinePrepare, /projectWritingMaterialSnapshot\(workspace\.id, projectId, input\.platform\)/);
  const draftPrepare = server.slice(server.indexOf('/draft/prepare'), server.indexOf('/draft-runs/:id/confirm'));
  assert.match(draftPrepare, /projectWritingMaterialSnapshot\(workspace\.id, projectId, input\.platform\)/);
});

test('应用链接摄取时把已导入正文图片关联到新项目', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const applyStart = server.indexOf('async function applyContentIngestion');
  const applyEnd = server.indexOf('registerContentIngestionRoutes', applyStart);
  const apply = server.slice(applyStart, applyEnd);
  assert.match(apply, /content_ingestion_media/);
  assert.match(apply, /media\.asset_id/);
  assert.match(apply, /链接正文自动导入的图片素材/);
});

test('生成正文执行事实安全门，改写正文不因原文主张被重新拦截', () => {
  const claim = 'Wan3.0 首次支持 doc、xls、ppt、pdf、md 等文档格式作为视频生成输入源';
  const safetyContext = { researchContext: { cautions: [{ id: 'claim-wan3-doc-input', claim, status: 'SINGLE_SOURCE' }] } };
  const uncertainBody = `关于“${claim}”的说法目前尚不能确认，正式发布前仍需要以官方文档为准。${'这里继续解释判断边界，避免把传闻写成事实。'.repeat(8)}`;
  assert.doesNotThrow(() => parseFinishedCopyBody(uncertainBody, { lockedTitle: '办公工具的新变化' }, 'GENERATE_DRAFT', safetyContext));
  const generated = parseFinishedCopyBody(`官方已经确认：${claim}。${'这会改变办公内容生产方式。'.repeat(8)}`, { lockedTitle: '办公工具的新变化' }, 'GENERATE_DRAFT', safetyContext);
  assert.deepEqual(generated.factsToVerify, [claim]);
  assert.doesNotThrow(() => parseRevisionCopyBody(`改写后的正文保留原文表达：${claim}。${'本次只调整措辞与语言组织，不改变原文主题。'.repeat(8)}`, 'POLISH_EXISTING_DRAFT', {
    lockedTitle: '办公工具的新变化',
    currentContent: { title: '办公工具的新变化', body: '原文正文。'.repeat(40), factsToVerify: [claim] },
    researchContext: safetyContext.researchContext,
  }));
});

test('修改正文只接受纯正文，标题和变更说明由服务端生成', () => {
  const body = '这是新的正文开头，先把读者真正关心的问题摆出来。'.repeat(20);
  const output = parseRevisionCopyBody(body, 'POLISH_EXISTING_DRAFT', {
    lockedTitle: '办公工具的新变化',
    currentContent: { title: '办公工具的新变化', body: '这是旧正文。'.repeat(30) },
    researchContext: { cautions: [] },
  });
  assert.equal(output.title, '办公工具的新变化');
  assert.equal(output.changeSummary, '优化措辞、句子节奏和段落衔接，保留原有事实边界。');
  assert.equal(output.body, body);
  assert.throws(() => parseRevisionCopyBody('标题：办公工具的新变化\n\n正文：'.concat(body), 'POLISH_EXISTING_DRAFT', {
    lockedTitle: '办公工具的新变化', currentContent: { body: '旧正文。'.repeat(30) }, researchContext: { cautions: [] },
  }), /标题|变更说明|正文|内部/);
});

test('正文目标篇幅映射到足够的 CLI 输出上限', () => {
  assert.equal(copyMaxTokensForLength('3000-3250 字'), 6500);
  assert.equal(copyMaxTokensForLength(''), 3000);
  assert.equal(copyMaxTokensForLength('100000 字'), 12000);
});

test('修改提示词要求模型只输出正文纯文本', () => {
  const prompt = buildCopyPrompt({
    action: 'POLISH_EXISTING_DRAFT', platform: 'WECHAT', request: '润色', template: '保持事实边界，改善表达。',
    project: { title: '办公工具的新变化', planning: { title: '办公工具的新变化' } },
    currentContent: { title: '办公工具的新变化', body: '旧正文。'.repeat(30) },
    researchContext: { verifiedFacts: [], cautions: [] },
  });
  assert.match(prompt.system, /只输出最终正文纯文本/);
  assert.match(prompt.system, /服务端会锁定标题/);
});

test('正文提示词只携带事实 claim 和来源 ID，不泄漏证据摘录', () => {
  const prompt = buildCopyPrompt({
    action: 'GENERATE_DRAFT', platform: 'WECHAT', request: '生成正文', template: '写成正文。',
    project: { title: '办公工具的新变化', planning: { title: '办公工具的新变化' } },
    researchContext: {
      verifiedFacts: [{ id: 'fact-1', claim: '已确认的事实', status: 'VERIFIED', evidence: [{ sourceId: 'source-1', quote: '不应发送的整段证据' }] }],
      cautions: [{ id: 'claim-1', claim: '待复核的产品能力事实主张', evidence: [{ sourceId: 'source-2', quote: '不应发送的待核验证据' }] }],
    },
  });
  const message = JSON.parse(prompt.message);
  assert.deepEqual(message.researchContext.verifiedFacts, [{ id: 'fact-1', claim: '已确认的事实', status: 'VERIFIED', sourceIds: ['source-1'] }]);
  assert.deepEqual(message.researchContext.cautions, [{ id: 'claim-1', claim: '待复核的产品能力事实主张', status: 'UNRESOLVED' }]);
  assert.doesNotMatch(prompt.message, /不应发送的整段证据|不应发送的待核验证据/);
});

test('正文任务单次调用失败后立即结束，不自动重试', () => {
  assert.deepEqual(queueJobOptions({ id: 'job-1', job_type: 'PROJECT_COPY_ACTION' }), {
    jobId: 'job-1', removeOnComplete: 100, removeOnFail: 200,
  });
  for (const jobType of ['PROJECT_COPY_ACTION', 'CREATIVE_OUTLINE', 'CREATIVE_DRAFT', 'DRAFT_ADAPTATION']) {
    assert.deepEqual(queueJobOptions({ id: `copy-${jobType}`, job_type: jobType }), {
      jobId: `copy-${jobType}`, removeOnComplete: 100, removeOnFail: 200,
    });
  }
  assert.deepEqual(queueJobOptions({ id: 'job-2', job_type: 'STORAGE_DELETE' }), {
    jobId: 'job-2', removeOnComplete: 100, removeOnFail: 200,
  });
  assert.equal(queueJobOptions({ id: 'job-3', job_type: 'BAILIAN_TEXT' }).attempts, 3);
  assert.deepEqual(queueJobOptions({ id: 'research-1', job_type: 'PROJECT_RESEARCH_WORKFLOW' }), {
    jobId: 'research-1', removeOnComplete: 100, removeOnFail: 200,
  });
  assert.equal(isFinalQueueAttempt({ attemptsMade: 0, opts: { attempts: 3 } }), false);
  assert.equal(isFinalQueueAttempt({ attemptsMade: 2, opts: { attempts: 3 } }), true);

  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  assert.equal((worker.match(/generation_runs SET status = 'FAILED'/g) ?? []).length, 1);
  assert.match(worker, /if \(isFinalQueueAttempt\(queueJob\)\)[\s\S]*generation_runs SET status = 'FAILED'/);
  assert.match(worker, /status IN \('RUNNING', 'FAILED'\)/);
});

test('统一大纲动作使用结构化输出契约并由同一解析器保存', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const copyAction = fs.readFileSync(new URL('../server/services/project-copy-action.cjs', import.meta.url), 'utf8');
  const execute = worker.slice(worker.indexOf('async function generateProjectCopyAction'), worker.indexOf('async function generateAgentPlan'));
  assert.match(execute, /const output = isOutlineAction[\s\S]*parseOutlineContent\(first\.content\)/);
  assert.match(execute, /parseRevisionCopyBody\(first\.content/);
  assert.match(copyAction, /GENERATE_OUTLINE[\s\S]*titleOptions/);
  assert.match(copyAction, /GENERATE_OUTLINE[\s\S]*JSON/);
});

test('研究计划执行路径强制使用严格工具输出', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const planRunner = worker.slice(worker.indexOf('async function runWorkflowResearchPlan'), worker.indexOf('async function captureWorkflowSources'));
  const legacyRunner = worker.slice(worker.indexOf('async function generateProjectResearchPlan'), worker.indexOf('async function textConnectionInput'));
  for (const source of [planRunner, legacyRunner]) {
    assert.match(source, /tools: \[researchPlanTool\]/);
    assert.match(source, /requiredToolName: RESEARCH_PLAN_TOOL_NAME/);
  }
});

test('正文写作包完整携带作者想法和链接多模态理解结果', () => {
  const packet = buildWritingPacket({
    projectId: 'project-1',
    platform: 'WECHAT',
    action: 'GENERATE_DRAFT',
    project: { id: 'project-1', title: '项目标题', planning: { title: '项目标题' } },
    materials: [
      { id: 'idea-1', kind: 'IDEA', title: '作者想法', body: '这是作者自己补充的创作方向。' },
      { id: 'understanding-1', type: 'CONTENT_UNDERSTANDING', sourceUrl: 'https://example.com', summary: '链接正文的核心摘要', coreViewpoints: ['链接中的主要观点'], structureOutline: ['先提出问题，再给出判断'] },
    ],
    researchContext: { verifiedFacts: [], cautions: [] },
  });
  assert.match(JSON.stringify(packet.authorMaterials), /作者自己补充的创作方向/);
  assert.match(JSON.stringify(packet.supportingMaterials), /链接正文的核心摘要/);
  assert.match(JSON.stringify(packet.supportingMaterials), /链接中的主要观点/);
});
