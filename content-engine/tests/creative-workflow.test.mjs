import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('文案策略继承账号声音与本篇语气，不再让用户选择语言风格', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(copy, /当前账号声音/);
  assert.match(copy, /使用声音/);
  assert.match(copy, /本篇语气/);
  assert.match(copy, /accountVoiceProfileId: event\.target\.value/);
  assert.match(copy, /MORE_RESTRAINED/);
  assert.doesNotMatch(copy, /\{ id: 'VOICE', label: '语言风格' \}/);
  assert.match(workspace, /webAccountVoices\.list/);
});

test('文案工作区只编辑公众号母稿且复用通用 Project Agent', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../src/workspaces/create/CopyCandidateDialog.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(copy, /platform="WECHAT"/);
  assert.doesNotMatch(copy, /XIAOHONGSHU|ZHIHU|WEIBO|enableProjectPlatform/);
  assert.match(copy, /<ProjectAgent/);
  assert.match(copy, /CopyCandidateDialog/);
  assert.match(dialog, /完整文稿/);
  assert.match(dialog, /段落差异/);
  assert.doesNotMatch(dialog, /发布前核验|查看核验项|qualityReview|正文需重写|需先重写/);
  assert.match(dialog, /previewMode/);
  assert.doesNotMatch(dialog, /candidate-facts/);
  assert.doesNotMatch(workspace, /creative-agent-panel/);
  assert.doesNotMatch(workspace, /prepareOutline|prepareDraft/);
});

test('文案工作区支持 revision 保存、正文选区和明确采用候选', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../src/workspaces/create/CopyCandidateDialog.tsx', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(copy, /webDrafts\.patch/);
  assert.match(copy, /revision: draftRef\.current\.revision/);
  assert.doesNotMatch(copy, /enableProjectPlatform|onPlatform/);
  assert.match(copy, /selectionStart[\s\S]*selectionEnd/);
  assert.match(copy, /selection=\{selection\}/);
  assert.match(copy, /blockedReason=.*正在保存创作设定/s);
  assert.doesNotMatch(copy, /请先保存写作策略/);
  assert.match(agent, /修改选中.*字/);
  assert.match(agent, /blockedReason/);
  assert.match(dialog, /added[\s\S]*removed[\s\S]*unchanged/);
  assert.match(dialog, /采用修改/);
  assert.match(dialog, /放弃修改/);
  assert.match(api, /webDrafts/);
  assert.match(api, /rejectArtifact/);
  assert.match(server, /project-artifacts\/:id\/reject/);
  const accept = server.slice(server.indexOf("app.post('/api/v1/creative/project-artifacts/:id/accept'"), server.indexOf("app.post('/api/v1/creative/project-artifacts/:id/reject'"));
  assert.match(accept, /const candidateFacts = mergeFactsToVerify\(candidate\.facts_to_verify_json \?\? \[\]\)/);
  assert.doesNotMatch(accept, /candidate\.source_snapshot_json\?\.project\?\.factChecks/);
});

test('文案工作区样式在桌面和移动端保持无横向溢出布局', () => {
  const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.copy-workspace/);
  assert.match(styles, /@media \(max-width:1024px\)[\s\S]*\.copy-workspace-layout/);
  assert.match(styles, /@media \(max-width:460px\)[\s\S]*\.copy-platform-bar/);
  assert.match(styles, /candidate-copy-preview[\s\S]*min-height:min\(54dvh,560px\)/);
  assert.match(styles, /candidate-full-copy[\s\S]*overflow-y:auto/);
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
  assert.match(workspace, /webCreative\.saveBrief\(project\.id, normalized\)/);
  assert.match(copy, /setTimeout\(.*700/s);
  assert.match(copy, /正在保存创作设定/);
});

test('公众号母稿沿五步线性页面推进，研究留在内容准备中', () => {
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /PreparationWorkspace/);
  assert.match(workspace, /onStage\('visual'\)/);
  assert.match(workspace, /onStage\('layout'\)/);
  assert.doesNotMatch(workspace, /platform-versions-workspace|stage === 'master'|stage === 'platform'/);
  assert.doesNotMatch(copy, /补充研究|当前渠道下一步/);
  assert.match(copy, /确认正文，开始配图/);
});
