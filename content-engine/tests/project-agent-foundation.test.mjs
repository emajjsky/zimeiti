import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createProjectAgentStore } from '../server/services/project-agent.cjs';

test('015 建立通用 Agent、阶段摘要和四平台产物', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/015_universal_project_agent.sql', import.meta.url), 'utf8');
  assert.match(migration, /RENAME COLUMN generation_run_id TO action_run_id/);
  assert.match(migration, /stage text NOT NULL DEFAULT 'RESEARCH'/);
  assert.match(migration, /CREATE TABLE project_stage_summaries/);
  assert.match(migration, /CREATE TABLE project_artifacts/);
  assert.match(migration, /CREATE TABLE content_master_versions/);
  assert.match(migration, /CREATE TABLE platform_strategies/);
  assert.match(migration, /CREATE TABLE platform_content_versions/);
  assert.match(migration, /'WECHAT'.*'XIAOHONGSHU'.*'ZHIHU'.*'WEIBO'/s);
});

test('研究消息读写统一使用 action_run_id', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /project_agent_messages[^;]*generation_run_id/s);
  assert.doesNotMatch(worker, /project_agent_messages[^;]*generation_run_id/s);
  assert.match(server, /project_agent_messages[^;]*action_run_id/s);
  assert.match(worker, /project_agent_messages[^;]*action_run_id/s);
});

test('项目 Agent 上下文按工作空间、项目、阶段和平台隔离', async () => {
  const calls = [];
  const store = createProjectAgentStore({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
    transaction: async (callback) => callback({ query: async () => ({ rows: [] }) }),
  });

  const context = await store.context('workspace-a', 'project-a', { stage: 'COPY', platform: 'ZHIHU', history: 'CURRENT' });

  assert.equal(context.stage, 'COPY');
  assert.equal(context.platform, 'ZHIHU');
  assert.ok(calls.length >= 4);
  assert.ok(calls.every(({ params }) => params[0] === 'workspace-a' && params[1] === 'project-a'));
  assert.ok(calls.some(({ sql }) => /stage = \$3/.test(sql)));
  assert.ok(calls.some(({ sql }) => /platform/.test(sql)));
});

test('统一 Agent 上下文 API 先验证项目再读取时间线', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const start = server.indexOf("/creative/projects/:projectId/agent'");
  const end = server.indexOf("/creative/projects/:projectId/research'", start);
  assert.ok(start > -1 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /projectAgentQuery\.parse\(request\.query\)/);
  assert.ok(route.indexOf('creativeProject(workspace.id, projectId)') < route.indexOf('projectAgentStore.context(workspace.id, projectId'));
});

test('研究成功同时生成通用产物、ARTIFACT 消息和阶段摘要', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  const start = worker.indexOf('async function generateProjectResearchPlan');
  const end = worker.indexOf('async function generateIntelligenceAnalysis', start);
  const researchWorker = worker.slice(start, end);
  assert.match(researchWorker, /createArtifact/);
  assert.match(researchWorker, /artifact_id/);
  assert.match(researchWorker, /'ARTIFACT'/);
  assert.match(researchWorker, /upsertStageSummary/);
});
