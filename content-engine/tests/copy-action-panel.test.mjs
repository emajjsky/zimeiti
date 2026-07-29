import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { copyActionPanelState } from '../src/domain/copy-action-panel.mjs';

test('空正文把生成正文作为唯一主操作', () => {
  const state = copyActionPanelState({ hasBody: false, hasSelection: false, hasCandidate: false });
  assert.equal(state.primary.action, 'GENERATE_DRAFT');
  assert.equal(state.primary.label, '生成正文');
  assert.deepEqual(state.quickActions, []);
});

test('已有正文提供明确修改动作，选区优先修改选中内容', () => {
  const normal = copyActionPanelState({ hasBody: true, hasSelection: false, hasCandidate: false });
  assert.deepEqual(normal.quickActions.map((item) => item.action), ['POLISH_EXISTING_DRAFT', 'EXPAND_DRAFT', 'SHORTEN_DRAFT', 'RESTRUCTURE_DRAFT']);

  const selected = copyActionPanelState({ hasBody: true, hasSelection: true, hasCandidate: false });
  assert.equal(selected.primary.action, 'REVISE_SELECTION');
  assert.equal(selected.primary.label, '修改选中内容');
});

test('存在候选时先审核，不再展示新的生成或修改动作', () => {
  const state = copyActionPanelState({ hasBody: true, hasSelection: false, hasCandidate: true });
  assert.equal(state.primary.action, 'REVIEW_CANDIDATE');
  assert.equal(state.primary.label, '查看并采用');
  assert.deepEqual(state.quickActions, []);
});

test('正文 Agent 使用动作面板并在点击后直接启动任务', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  assert.match(agent, /copyActionPanelState/);
  assert.match(agent, /copyActionRequest/);
  assert.match(agent, /confirmAgentRun\(prepared\.id\)/);
  assert.doesNotMatch(agent, /自由对话/);
  assert.doesNotMatch(agent, /确认调用/);
});

test('大纲与正文候选都必须先进入审核，不能在候选存在时继续生成', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  assert.match(agent, /artifact\.type === 'OUTLINE' \|\| artifact\.type === 'PLATFORM_COPY'/);
  assert.match(agent, /artifact\.status === 'CANDIDATE'/);
});
