import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('文案工作区支持四平台且只使用通用 Project Agent', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(copy, /WECHAT[\s\S]*XIAOHONGSHU[\s\S]*ZHIHU[\s\S]*WEIBO/);
  assert.match(copy, /<ProjectAgent/);
  assert.match(copy, /CopyCandidateDialog/);
  assert.doesNotMatch(workspace, /creative-agent-panel/);
  assert.doesNotMatch(workspace, /prepareOutline|prepareDraft/);
});

test('文案工作区支持启用缺失平台、正文选区和明确采用候选', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../src/workspaces/create/CopyCandidateDialog.tsx', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(copy, /enableProjectPlatform/);
  assert.match(copy, /selectionStart[\s\S]*selectionEnd/);
  assert.match(copy, /selection=\{selection\}/);
  assert.match(copy, /blockedReason=.*正在保存创作设定/s);
  assert.doesNotMatch(copy, /请先保存写作策略/);
  assert.match(agent, /已选择.*字/);
  assert.match(agent, /blockedReason/);
  assert.match(dialog, /added[\s\S]*removed[\s\S]*unchanged/);
  assert.match(dialog, /采用为当前版本/);
  assert.match(dialog, /废弃候选/);
  assert.match(api, /enableProjectPlatform/);
  assert.match(api, /rejectArtifact/);
  assert.match(server, /project-artifacts\/:id\/reject/);
});

test('文案工作区样式在桌面和移动端保持无横向溢出布局', () => {
  const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.copy-workspace/);
  assert.match(styles, /@media \(max-width:1024px\)[\s\S]*\.copy-workspace-layout/);
  assert.match(styles, /@media \(max-width:460px\)[\s\S]*\.copy-platform-tabs/);
});

test('创作流程将用户输入收敛为自动保存的最小界面', () => {
  const planning = fs.readFileSync(new URL('../src/workspaces/create/PlanningWorkspace.tsx', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(planning, /已自动保存/);
  assert.doesNotMatch(planning, /计划发布时间/);
  assert.doesNotMatch(planning, /保存规划/);
  assert.match(agent, /showResearchSupplement/);
  assert.match(agent, /补充研究/);
  assert.match(workspace, /webCreative\.saveBrief\(project\.id, defaults\)/);
  assert.match(copy, /setTimeout\(.*700/s);
  assert.match(copy, /正在保存创作设定/);
});
