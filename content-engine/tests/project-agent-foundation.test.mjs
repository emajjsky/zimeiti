import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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
