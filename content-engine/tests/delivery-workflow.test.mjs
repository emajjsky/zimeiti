import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canOpenChannelView, channelViewForStage } from '../src/domain/channel-workflow.mjs';

test('渠道步骤按正文确认状态逐步解锁', () => {
  assert.equal(canOpenChannelView('COPY', 'copy', false), true);
  assert.equal(canOpenChannelView('COPY', 'visual', false), false);
  assert.equal(canOpenChannelView('COPY', 'visual', true), false);
  assert.equal(canOpenChannelView('VISUAL', 'visual', true), true);
  assert.equal(canOpenChannelView('VISUAL', 'layout', true), false);
  assert.equal(canOpenChannelView('LAYOUT', 'layout', true), true);
  assert.equal(canOpenChannelView('REVIEW', 'review', true), true);
  assert.equal(channelViewForStage('COPY', false), 'copy');
  assert.equal(channelViewForStage('VISUAL', true), 'visual');
});

test('创作后半段提供配图、排版、审核和发布包的真实接口', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  assert.match(api, /projects\/:projectId\/visual'/);
  assert.match(api, /visual\/complete/);
  assert.match(api, /layout\/generate/);
  assert.match(api, /layout\/complete/);
  assert.match(api, /review\/complete/);
  assert.match(api, /function documentForPlatform/);
  assert.match(api, /请先确认所有需要人工核对的事实/);
  assert.match(client, /saveVisual/);
  assert.match(client, /generateLayout/);
  assert.match(client, /completeReview/);
});

test('创作工作台提供真实配图与排版，并将公众号排版直接保存为草稿', () => {
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const visual = fs.readFileSync(new URL('../src/workspaces/create/VisualWorkspace.tsx', import.meta.url), 'utf8');
  const layout = fs.readFileSync(new URL('../src/workspaces/create/LayoutWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /<VisualWorkspace/);
  assert.match(workspace, /<LayoutWorkspace/);
  assert.doesNotMatch(workspace, /ReviewWorkspace|canOpenChannelView|channel-platform-tabs/);
  assert.doesNotMatch(workspace, /配图尚未开始|排版尚未开始|审核尚未开始/);
  assert.match(visual, /确认素材，进入排版/);
  assert.match(visual, /if \(!hasCopy \|\| !plan\.length\) return/);
  assert.match(visual, /生成配图方案/);
  assert.match(visual, /修改这张图/);
  assert.doesNotMatch(visual, />高级设置</);
  assert.doesNotMatch(visual, /aria-label="视觉结构"/);
  assert.match(visual, /webDrafts\.patch/);
  assert.match(visual, /webDrafts\.replaceAssets/);
  assert.match(layout, /保存公众号草稿/);
  assert.doesNotMatch(layout, /进入审核/);
});

test('服务端拒绝为没有公众号正文的草稿保存配图方案', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const start = api.indexOf("app.put('/api/v1/creative/projects/:projectId/visual'");
  const end = api.indexOf("app.post('/api/v1/creative/projects/:projectId/visual/complete'", start);
  const route = api.slice(start, end);
  assert.match(route, /draft\.platform !== 'WECHAT'/);
  assert.match(route, /draft\.body/);
  assert.match(route, /请先完成公众号正文/);
});

test('后半段制作状态只由公众号草稿资源推进', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  assert.match(api, /platforms: \{ \.\.\.delivery\.platforms, \[input\.platform\]/);
  assert.match(api, /platformDelivery\(delivery, input\.platform\)/);
  assert.doesNotMatch(api.slice(api.indexOf("platform-versions/complete"), api.indexOf('function deliveryOf')), /incomplete/);
  assert.doesNotMatch(workspace, /delivery\?\.platforms|copyPlatform|completePlatformVersions/);
  assert.match(workspace, /draft\?\.status === 'READY'/);
  assert.match(client, /replaceAssets: \(draftId: string/);
});

test('发布稿按渠道保留 HTML 或 Markdown 格式，且不需要外部平台授权', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(api, /platform === 'XIAOHONGSHU' \|\| platform === 'WEIBO'/);
  assert.match(api, /format: 'MARKDOWN'/);
  assert.match(api, /format: 'HTML'/);
  assert.doesNotMatch(api.slice(api.indexOf("app.post('/api/v1/creative/projects/:projectId/layout/generate'"), api.indexOf("app.post('/api/v1/creative/projects/:projectId/review/complete'")), /account.*authorize/i);
});

test('视觉导演保存完整策划字段并支持参考图真实图生图', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  assert.match(api, /assetIds:\s*z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(3\)/);
  assert.match(api, /stylePreset:\s*z\.union\(\[z\.literal\('INHERIT'\), visualStylePreset\]\)/);
  assert.match(api, /customPrompt:\s*z\.string\(\)\.trim\(\)\.max\(1_200\)/);
  assert.match(api, /contentBlocks:\s*z\.array/);
  assert.ok((api.match(/prompt:\s*z\.string\(\)\.trim\(\)\.min\(4\)\.max\(8_000\)/g) ?? []).length >= 2);
  assert.match(api, /references:\s*z\.array/);
  assert.match(api, /assetStore\.listProject\(workspace\.id, projectId\)/);
  assert.match(api, /assetStore\.getStored\(workspace\.id, assetId\)/);
  assert.match(api, /input\.assetIds\.length \? 'edit' : 'generate'/);
  assert.match(api, /args\.push\('--image', image\)/);
  assert.match(api, /operation = input\.assetIds\.length \? 'IMAGE_TO_IMAGE' : 'TEXT_TO_IMAGE'/);
  assert.match(client, /assetIds\?: string\[\]/);
  assert.match(client, /planVisual:/);
  assert.match(api, /VISUAL_PLANNING_SCOPE/);
  assert.doesNotMatch(api, /VISUAL_PLANNING_FALLBACK_SCOPE/);
  assert.match(api, /'WECHAT_VISUAL_PLANNING'/);
  assert.match(api, /bodyItemCount:\s*z\.number\(\)\.int\(\)\.min\(0\)\.max\(11\)/);
  assert.match(api, /currentPlan:\s*z\.array\(z\.record[\s\S]*?\.max\(12\)/);
  assert.match(api, /plan:\s*z\.array\(visualPlanItemInput\)\.max\(12\)/);
});

test('配图策划使用独立可见任务策略，不静默回退到文案模型', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../server/services/visual-planning.cjs', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/VisualWorkspace.tsx', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../server/migrations/028_content_draft_foundation.sql', import.meta.url), 'utf8');
  assert.match(service, /VISUAL_PLANNING_SCOPE = 'WECHAT_VISUAL_PLANNING'/);
  assert.doesNotMatch(service, /CONTENT_WRITING/);
  assert.match(api, /const scope = VISUAL_PLANNING_SCOPE;[\s\S]*?textTaskRoute\(workspace\.id, scope, '配图策划'\)/);
  assert.match(client, /WECHAT_VISUAL_PLANNING: '公众号配图策划'/);
  assert.match(workspace, /实际策略：公众号配图策划/);
  assert.match(migration, /SELECT workspace_id, 'WECHAT_VISUAL_PLANNING'/);
});
