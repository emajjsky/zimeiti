import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  PROJECT_RESEARCH_SOURCES_VERSION,
  dedupeSourceSnapshots,
  normalizeReadResult,
  normalizeSearchResults,
  recommendSourceSelection,
  researchSourceActions,
} from '../server/services/project-research-sources.cjs';

const plan = {
  id: 'plan-1',
  nextActions: [
    { action: 'SEARCH_WEB', purpose: '查找官方能力说明', target: '产品名 官方文档' },
    { action: 'READ_LINK', purpose: '读取用户提供的说明', target: 'https://example.com/guide' },
    { action: 'ASK_USER', purpose: '补充付费报告截图', target: '上传截图或粘贴关键段落' },
  ],
};

test('研究来源动作保留计划顺序并生成确认数量', () => {
  const result = researchSourceActions(plan);
  assert.equal(PROJECT_RESEARCH_SOURCES_VERSION, 'project-research-sources:1.0.0');
  assert.deepEqual(result.counts, { search: 1, read: 1, askUser: 1, automatic: 2 });
  assert.deepEqual(result.actions.map(({ index, action }) => ({ index, action })), [
    { index: 0, action: 'SEARCH_WEB' },
    { index: 1, action: 'READ_LINK' },
    { index: 2, action: 'ASK_USER' },
  ]);
});

test('单个网页搜索动作最多保留五条规范化来源', () => {
  const action = researchSourceActions(plan).actions[0];
  const results = Array.from({ length: 7 }, (_, index) => ({
    title: `结果 ${index + 1}`,
    url: `https://example.com/${index + 1}`,
    source: 'example.com',
    summary: `摘要 ${index + 1}`,
  }));
  const normalized = normalizeSearchResults(action, results);
  assert.equal(normalized.length, 5);
  assert.deepEqual(normalized[0], {
    actionIndex: 0,
    action: 'SEARCH_WEB',
    purpose: '查找官方能力说明',
    target: '产品名 官方文档',
    status: 'CAPTURED',
    title: '结果 1',
    url: 'https://example.com/1',
    source: 'example.com',
    summary: '摘要 1',
    metadata: { relevanceScore: null, publishedAt: null, language: 'ZH', sourceType: 'WEB' },
    error: null,
  });
});

test('网页搜索来源保留核验所需的质量元数据', () => {
  const action = researchSourceActions(plan).actions[0];
  const [source] = normalizeSearchResults(action, [{
    title: '官方能力说明',
    url: 'https://www.gov.cn/zhengce/content/2026/example.htm',
    source: '中国政府网',
    summary: '官方发布的完整能力说明。',
    relevanceScore: 0.86,
    publishedAt: '2026-07-28T08:00:00.000Z',
    language: 'zh',
  }]);
  assert.deepEqual(source.metadata, {
    relevanceScore: 0.86,
    publishedAt: '2026-07-28T08:00:00.000Z',
    language: 'ZH',
    sourceType: 'OFFICIAL',
  });
});

test('推荐选择最多八条并优先官方高相关来源', () => {
  const sources = Array.from({ length: 11 }, (_, index) => ({
    id: `source-${index}`,
    status: 'CAPTURED',
    title: `来源 ${index}`,
    metadata: {
      relevanceScore: index === 10 ? 0.95 : 0.4 + index / 100,
      sourceType: index === 10 ? 'OFFICIAL' : 'WEB',
      language: index % 2 ? 'EN' : 'ZH',
    },
  }));
  const selected = recommendSourceSelection(sources, 8);
  assert.equal(selected.length, 8);
  assert.equal(selected[0], 'source-10');
  assert.equal(new Set(selected).size, selected.length);
});

test('公开链接读取结果使用同一来源快照形状', () => {
  const action = researchSourceActions(plan).actions[1];
  assert.deepEqual(normalizeReadResult(action, {
    title: '公开说明',
    url: 'https://example.com/guide',
    source: 'example.com',
    summary: '正文摘要',
  }), {
    actionIndex: 1,
    action: 'READ_LINK',
    purpose: '读取用户提供的说明',
    target: 'https://example.com/guide',
    status: 'CAPTURED',
    title: '公开说明',
    url: 'https://example.com/guide',
    source: 'example.com',
    summary: '正文摘要',
    metadata: { relevanceScore: null, publishedAt: null, language: 'ZH', sourceType: 'WEB' },
    error: null,
  });
});

test('来源按规范化 URL 去重且整次最多二十条', () => {
  const sources = Array.from({ length: 24 }, (_, index) => ({
    actionIndex: index,
    action: 'SEARCH_WEB',
    purpose: '搜索',
    target: '关键词',
    status: 'CAPTURED',
    title: `来源 ${index}`,
    url: index === 1 ? 'https://example.com/a#section' : `https://example.com/${index === 0 ? 'a' : index}`,
    source: 'example.com',
    summary: '',
    error: null,
  }));
  const result = dedupeSourceSnapshots(sources);
  assert.equal(result.length, 20);
  assert.equal(result.filter((item) => item.url?.startsWith('https://example.com/a')).length, 1);
});

test('迁移注册来源动作、快照表和研究来源产物', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/019_project_research_sources.sql', import.meta.url), 'utf8');
  assert.match(migration, /project-research-sources:1\.0\.0/);
  assert.match(migration, /CREATE TABLE project_research_source_runs/);
  assert.match(migration, /CREATE TABLE project_research_sources/);
  assert.match(migration, /RESEARCH_SOURCES/);
  assert.match(migration, /CAPTURED.*NEEDS_USER.*FAILED/s);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS project_artifacts_type_platform_check/);
  assert.match(migration, /ADD CONSTRAINT project_artifacts_type_platform_check/);
  assert.doesNotMatch(migration, /ADD CONSTRAINT project_artifacts_platform_check/);
});

test('来源任务准备阶段只创建确认运行，确认接口才入队', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepareStart = server.indexOf("/research/sources/prepare");
  const confirmStart = server.indexOf("/research-source-runs/:id/confirm");
  const cancelStart = server.indexOf("/research-source-runs/:id/cancel");
  assert.ok(prepareStart > -1 && confirmStart > prepareStart && cancelStart > confirmStart);
  const prepare = server.slice(prepareStart, confirmStart);
  const confirm = server.slice(confirmStart, cancelStart);
  assert.match(prepare, /PROJECT_RESEARCH_SOURCES_VERSION/);
  assert.match(prepare, /'DRAFT'/);
  assert.match(prepare, /provider = 'TAVILY'.*status = 'READY'/s);
  assert.doesNotMatch(prepare, /await enqueue/);
  assert.match(confirm, /'PROJECT_RESEARCH_SOURCES'/);
  assert.match(confirm, /await enqueue/);
});

test('项目 Agent 把来源运行视为研究阶段活动任务', () => {
  const agent = fs.readFileSync(new URL('../server/services/project-agent.cjs', import.meta.url), 'utf8');
  assert.match(agent, /project-research-sources/);
  assert.match(agent, /PROJECT_RESEARCH_SOURCES/);
  assert.match(agent, /sourceCounts/);
});

test('Worker 分派来源任务并使用现有 Tavily 与公开网页读取器', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  assert.match(worker, /queueJob\.name === 'PROJECT_RESEARCH_SOURCES'/);
  assert.match(worker, /searchTavily/);
  assert.match(worker, /clipPublicLink/);
  assert.match(worker, /normalizeSearchResults/);
  assert.match(worker, /normalizeReadResult/);
  assert.match(worker, /project_research_sources/);
  assert.match(worker, /RESEARCH_SOURCES/);
});

test('调用记录把来源检索显示为独立业务操作而不是模型策略', () => {
  const integrations = fs.readFileSync(new URL('../src/domain/integrations.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(integrations, /ApiUsageTask = ModelTask \| 'SOURCE_DISCOVERY'/);
  assert.match(main, /SOURCE_DISCOVERY: '研究资料检索'/);
  assert.match(main, /usageTaskNames\[log\.task\]/);
});
