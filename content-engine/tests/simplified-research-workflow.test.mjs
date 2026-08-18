import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

let buildResearchResult;
let workflowSourceActionsForProject;
let projectOriginalSource;
let sourceMatchesProject;
let researchResultHasUsableFacts;
try {
  ({ buildResearchResult, workflowSourceActionsForProject, projectOriginalSource, sourceMatchesProject, researchResultHasUsableFacts } = await import('../server/services/simplified-research.cjs'));
} catch {}

test('研究工作流优先读取项目原始资讯链接，再执行补充检索', () => {
  assert.equal(typeof workflowSourceActionsForProject, 'function');
  const actions = workflowSourceActionsForProject({
    nextActions: [
      { action: 'SEARCH_WEB', purpose: '补充官方来源', target: '宇树科技 IPO 官方公告' },
      { action: 'SEARCH_WEB', purpose: '寻找媒体交叉报道', target: '宇树科技 上市进展' },
    ],
  }, {
    sourceSnapshot: {
      intelligence: {
        title: '宇树科技上市新进展',
        source: 'IT之家',
        url: 'https://www.ithome.com/0/983/890.htm',
      },
    },
  });

  assert.equal(actions[0].action, 'READ_LINK');
  assert.equal(actions[0].target, 'https://www.ithome.com/0/983/890.htm');
  assert.equal(actions.filter((item) => item.target === actions[0].target).length, 1);
  assert.equal(actions.filter((item) => ['SEARCH_WEB', 'READ_LINK'].includes(item.action)).length, 3);
  assert.deepEqual(actions.slice(1).map((item) => item.target), ['宇树科技 IPO 官方公告', '宇树科技 上市进展']);
});

test('研究优先复用项目已保存的原文快照，不依赖再次联网读取', () => {
  const project = { sourceSnapshot: { intelligence: {
    title: '宇树科技上市新进展',
    source: 'IT之家',
    url: 'https://www.ithome.com/0/983/890.htm',
    summary: '宇树科技公告了首次公开发行安排。',
    publishedAt: '2026-07-30T13:47:42.000Z',
  } } };
  assert.deepEqual(projectOriginalSource(project), {
    title: '宇树科技上市新进展',
    source: 'IT之家',
    url: 'https://www.ithome.com/0/983/890.htm',
    summary: '宇树科技公告了首次公开发行安排。',
    publishedAt: '2026-07-30T13:47:42.000Z',
    relevanceScore: 1,
    language: 'ZH',
  });
});

test('补充检索只保留与项目主体相关的来源', () => {
  const project = { title: '宇树科技上市新进展：初步询价日为 8 月 5 日' };
  assert.equal(sourceMatchesProject({ title: '宇树科技首次公开发行公告', summary: '' }, project), true);
  assert.equal(sourceMatchesProject({ title: '杭州云深处科技股份有限公司', summary: '科创板上市材料' }, project), false);
  assert.equal(sourceMatchesProject({ title: '成都迈科康生物科技股份有限公司', summary: '发行公告' }, project), false);
});

test('补充检索使用研究主体和关键词，不再受营销新闻标题误导', () => {
  const project = { sourceSnapshot: { intelligence: { title: '让Agent在协作中自进化，清华00后博士获千万元融资' } } };
  const plan = { researchBrief: { subject: '奇点逃逸（Singularity Escape）', keywords: ['奇点逃逸', '薛传奕', 'Nexus'] } };

  assert.equal(sourceMatchesProject({ title: '奇点逃逸完成新一轮融资', summary: '薛传奕介绍 Nexus 产品。' }, project, plan), true);
  assert.equal(sourceMatchesProject({ title: '另一家协作软件获融资', summary: '与奇点逃逸无关。'.replace('奇点逃逸', '') }, project, plan), false);
  assert.equal(sourceMatchesProject({ title: '奇点逃逸发布新产品', summary: '' }, project, { researchBrief: { subject: '奇点逃逸融资与产品进展', keywords: [] } }), true);
});

test('研究结果只把已核验事实交给正文，并保留用户草稿', () => {
  assert.equal(typeof buildResearchResult, 'function');

  const result = buildResearchResult({
    plan: {
      summary: '核验一思智能的融资与交付情况',
      researchBrief: {
        subject: '一思智能融资与交付进展',
        directions: ['核验融资事件', '核验批量交付状态'],
        keywords: ['一思智能', '融资', '批量交付'],
        preferredChannels: ['公司官方公告', '投资机构公告'],
        searchQueries: ['一思智能 融资 官方公告', '一思智能 批量交付 官方'],
      },
      claims: [
        { claim: '一思智能完成融资', priority: 'HIGH', reason: '正文将提及融资' },
        { claim: '一思智能已批量交付', priority: 'HIGH', reason: '正文将评价交付状态' },
      ],
    },
    sources: [{
      id: 'source-official', action: 'READ_LINK', purpose: '读取官方公告', target: 'https://example.com/announcement', status: 'CAPTURED', title: '官方公告', url: 'https://example.com/announcement', summary: '公司宣布完成融资。', source: '官方公告', metadata: { sourceType: 'OFFICIAL' }, error: null,
    }, {
      id: 'source-failed', action: 'SEARCH_WEB', purpose: '寻找投资机构公告', target: '一思智能 投资机构 公告', status: 'FAILED', title: '寻找投资机构公告', url: null, summary: '', source: '网页搜索', error: '搜索服务未返回结果。',
    }],
    verification: {
      summary: '融资有证据，交付尚未找到证据。',
      claims: [
        { claim: '一思智能完成融资', status: 'VERIFIED', explanation: '独立来源支持', evidence: [{ sourceId: 'source-official', relation: 'SUPPORTS', quote: '公司宣布完成融资。', note: '融资公告' }] },
        { claim: '一思智能已批量交付', status: 'NEEDS_REVIEW', explanation: '没有相关来源', evidence: [] },
      ],
    },
    materials: [{ id: 'draft-1', kind: 'DRAFT', title: '我的体验草稿', body: '我实际体验过这台设备。', scope: 'PROJECT' }],
  });

  assert.deepEqual(result.facts.map((item) => item.claim), ['一思智能完成融资']);
  assert.deepEqual(result.cautions.map((item) => item.claim), ['一思智能已批量交付']);
  assert.deepEqual(result.materialContext.userContent.map((item) => item.id), ['draft-1']);
  assert.equal(result.researchBrief.subject, '一思智能融资与交付进展');
  assert.deepEqual(result.researchBrief.directions, ['核验融资事件', '核验批量交付状态']);
  assert.equal(result.sourceAttempts.length, 2);
  assert.equal(result.sourceAttempts[1].status, 'FAILED');
  assert.equal(result.process.failedSourceCount, 1);
  assert.equal(researchResultHasUsableFacts(result), true);
});

test('没有多源或单一来源事实的研究结果不可采用', () => {
  assert.equal(researchResultHasUsableFacts({ facts: [], cautions: [{ claim: '尚待核验', status: 'NEEDS_REVIEW' }] }), false);
  assert.equal(researchResultHasUsableFacts({ facts: [], cautions: [{ claim: '单一来源事实', status: 'SINGLE_SOURCE' }] }), true);
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const acceptStart = server.indexOf("app.post('/api/v1/creative/research-results/:artifactId/accept'");
  const acceptEnd = server.indexOf("app.post('/api/v1/creative/projects/:projectId/research/skip'", acceptStart);
  assert.match(server.slice(acceptStart, acceptEnd), /researchResultHasUsableFacts\(candidate\.output_json\)/);
  assert.match(server.slice(acceptStart, acceptEnd), /statusCode = 409/);
});

test('迁移允许研究结果作为项目级候选产物保存', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/021_simplified_research_workflow.sql', import.meta.url), 'utf8');

  assert.match(migration, /RESEARCH_RESULT/);
  assert.match(migration, /CREATE TABLE project_research_results/);
  assert.match(migration, /generation_run_id uuid NOT NULL UNIQUE/);
  assert.match(migration, /artifact_id uuid NOT NULL UNIQUE/);
});

test('前端领域模型识别统一研究运行和研究结果', () => {
  const domain = fs.readFileSync(new URL('../src/domain/creative.ts', import.meta.url), 'utf8');

  assert.match(domain, /'RESEARCH_RESULT'/);
  assert.match(domain, /'PROJECT_RESEARCH_WORKFLOW'/);
  assert.match(domain, /interface ResearchResult/);
});

test('开始研究直接入队统一任务，不再创建确认草稿', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const start = server.indexOf("/research/start");

  assert.ok(start >= 0);
  assert.match(server.slice(start, start + 5_000), /'PROJECT_RESEARCH_WORKFLOW'/);
  assert.doesNotMatch(server.slice(start, start + 5_000), /status = 'DRAFT'/);
  assert.match(worker, /queueJob\.name === 'PROJECT_RESEARCH_WORKFLOW'/);
  assert.match(worker, /generateSimplifiedResearchWorkflow/);
});

test('Worker restart reclaims interrupted research jobs instead of leaving RUNNING forever', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');

  assert.match(worker, /status IN \('PENDING', 'RUNNING'\)/);
  assert.match(worker, /previous_status/);
  assert.match(worker, /status = 'QUEUED'.*status = 'RUNNING'/s);
});

test('accepted research replaces stale candidates and running research can be cancelled', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const acceptStart = server.indexOf("app.post('/api/v1/creative/research-results/:artifactId/accept'");
  const acceptEnd = server.indexOf("app.post('/api/v1/creative/projects/:projectId/research/skip'", acceptStart);
  const cancelStart = server.indexOf("app.post('/api/v1/creative/agent-runs/:id/cancel'");
  const cancelEnd = server.indexOf("app.post('/api/v1/creative/projects/:projectId/research/sources/prepare'", cancelStart);

  assert.match(server.slice(acceptStart, acceptEnd), /status IN \('CANDIDATE', 'ACCEPTED'\)/);
  assert.match(server.slice(acceptStart, acceptEnd), /candidate\.status === 'ACCEPTED'/);
  assert.match(server.slice(acceptStart, acceptEnd), /project: candidate\.project_json/);
  assert.match(server.slice(cancelStart, cancelEnd), /SIMPLIFIED_RESEARCH_WORKFLOW_VERSION/);
  assert.match(server.slice(cancelStart, cancelEnd), /status IN \('DRAFT', 'QUEUED', 'RUNNING'\)/);
  assert.match(fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8'), /研究任务已取消或中断/);
});

test('正文首次生成不经过历史审稿状态阻断主动修改', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const projectAgent = fs.readFileSync(new URL('../server/services/project-agent.cjs', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../src/workspaces/create/CopyCandidateDialog.tsx', import.meta.url), 'utf8');
  const acceptStart = server.indexOf("app.post('/api/v1/creative/project-artifacts/:id/accept'");
  const acceptEnd = server.indexOf("app.post('/api/v1/creative/project-artifacts/:id/reject'", acceptStart);

  assert.doesNotMatch(server.slice(acceptStart, acceptEnd), /qualityReview\?\.status === 'NEEDS_REVIEW'/);
  assert.match(projectAgent, /'qualityReview',\s*a\.metadata_json->'payload'->'qualityReview'/);
  assert.doesNotMatch(dialog, /needsRewrite|qualityReview|发布前核验/);
});

test('023 迁移保留旧正文内容，只退出会阻塞创作的 NEEDS_REVIEW 候选', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/023_finished_copy_workflow.sql', import.meta.url), 'utf8');
  assert.match(migration, /UPDATE project_artifacts/);
  assert.match(migration, /artifact_type = 'PLATFORM_COPY'/);
  assert.match(migration, /status = 'CANDIDATE'/);
  assert.match(migration, /qualityReview.*NEEDS_REVIEW/s);
  assert.match(migration, /SET status = 'REJECTED'/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});

test('采用或跳过研究都会推进正文，正文上下文只读取已确认事实', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');

  assert.match(server, /research-results\/:artifactId\/accept/);
  assert.match(server, /research\/skip/);
  assert.match(server, /stage: 'MASTER_WRITING'/);
  assert.match(server, /researchContext/);
  assert.match(server, /verifiedFacts/);
});
