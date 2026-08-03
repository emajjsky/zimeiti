import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { copyActionPanelState, copyActionRequest } from '../src/domain/copy-action-panel.mjs';

test('空正文把生成正文作为唯一主操作', () => {
  const state = copyActionPanelState({ hasAcceptedCopy: false, hasSelection: false, hasCandidate: false });
  assert.equal(state.primary.action, 'GENERATE_DRAFT');
  assert.equal(state.primary.label, '生成正文');
  assert.deepEqual(state.quickActions, []);
});

test('已有正文提供明确修改动作，选区优先修改选中内容', () => {
  const normal = copyActionPanelState({ hasAcceptedCopy: true, hasSelection: false, hasCandidate: false });
  assert.deepEqual(normal.quickActions.map((item) => item.action), ['POLISH_EXISTING_DRAFT', 'EXPAND_DRAFT', 'SHORTEN_DRAFT', 'RESTRUCTURE_DRAFT']);

  const selected = copyActionPanelState({ hasAcceptedCopy: true, hasSelection: true, hasCandidate: false });
  assert.equal(selected.primary.action, 'REVISE_SELECTION');
  assert.equal(selected.primary.label, '修改选中内容');
});

test('存在候选时先审核，不再展示新的生成或修改动作', () => {
  const state = copyActionPanelState({ hasAcceptedCopy: true, hasSelection: false, hasCandidate: true });
  assert.equal(state.primary.action, 'REVIEW_CANDIDATE');
  assert.equal(state.primary.label, '查看修改');
  assert.deepEqual(state.quickActions, []);
});

test('未采用过正文候选时，即使有项目摘要或旧草稿也从生成正文开始', () => {
  const state = copyActionPanelState({ hasAcceptedCopy: false, hasSelection: false, hasCandidate: false });
  assert.equal(state.primary.action, 'GENERATE_DRAFT');
  assert.equal(state.primary.label, '生成正文');
  assert.deepEqual(state.quickActions, []);
});

test('次级大纲入口也能生成受控的大纲请求', () => {
  assert.equal(copyActionRequest('GENERATE_OUTLINE'), '生成大纲');
});

test('正文 Agent 使用动作面板并在点击后直接启动任务', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  assert.match(agent, /copyActionPanelState/);
  assert.match(agent, /copyActionRequest/);
  assert.match(agent, /confirmAgentRun\(prepared\.id\)/);
  assert.doesNotMatch(agent, /自由对话/);
  assert.doesNotMatch(agent, /确认调用/);
});

test('首次正文不产生候选，只有大纲或主动修改候选进入查看流程', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  assert.match(agent, /artifact\.type === 'OUTLINE' \|\| artifact\.type === 'PLATFORM_COPY'/);
  assert.match(agent, /artifact\.status === 'CANDIDATE'/);
  assert.doesNotMatch(agent, /正文候选已生成|正式文稿尚未改变|查看并采用|正在生成正文候选|候选审核/);
  assert.match(agent, /正在准备资料|正在生成正文/);
});

test('首次正文完成后按运行成功状态同步当前编辑器，不依赖候选产物或切换页面', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(agent, /webCreative\.agentRun\(watchedRun\.current\.id\)/);
  assert.match(agent, /completed\.type === 'SYNC_GENERATED_DRAFT'/);
  assert.match(agent, /await onDraftGenerated\(\)/);
  assert.doesNotMatch(agent, /watchedRun\.current\?\.action === 'GENERATE_DRAFT'[\s\S]*result\.artifacts\.find/);
  assert.match(copy, /onDraftGenerated=\{async \(\) => \{ applyServerDraft\(await onReloadDraft\(\)\); \}\}/);
  assert.match(copy, /contentRef\.current = nextContent/);
  assert.match(copy, /saveQueue\.current = Promise\.resolve\(updated\)/);
  assert.match(copy, /readOnly=\{copyRunActive\}/);
});
