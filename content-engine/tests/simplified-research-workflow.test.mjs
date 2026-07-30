import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

let buildResearchResult;
let workflowSourceActionsForProject;
let projectOriginalSource;
let sourceMatchesProject;
try {
  ({ buildResearchResult, workflowSourceActionsForProject, projectOriginalSource, sourceMatchesProject } = await import('../server/services/simplified-research.cjs'));
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
  assert.equal(actions.filter((item) => ['SEARCH_WEB', 'READ_LINK'].includes(item.action)).length, 2);
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

test('研究结果只把已核验事实交给正文，并保留用户草稿', () => {
  assert.equal(typeof buildResearchResult, 'function');

  const result = buildResearchResult({
    plan: {
      summary: '核验一思智能的融资与交付情况',
      claims: [
        { claim: '一思智能完成融资', priority: 'HIGH', reason: '正文将提及融资' },
        { claim: '一思智能已批量交付', priority: 'HIGH', reason: '正文将评价交付状态' },
      ],
    },
    sources: [{
      id: 'source-official', status: 'CAPTURED', title: '官方公告', url: 'https://example.com/announcement', summary: '公司宣布完成融资。', source: '官方公告', metadata: { sourceType: 'OFFICIAL' },
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

test('采用或跳过研究都会推进正文，正文上下文只读取已确认事实', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');

  assert.match(server, /research-results\/:artifactId\/accept/);
  assert.match(server, /research\/skip/);
  assert.match(server, /stage: 'MASTER_WRITING'/);
  assert.match(server, /researchContext/);
  assert.match(server, /verifiedFacts/);
});
