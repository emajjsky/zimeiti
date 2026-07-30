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

test('创作工作台不再把配图、排版和审核渲染为占位页面', () => {
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const visual = fs.readFileSync(new URL('../src/workspaces/create/VisualWorkspace.tsx', import.meta.url), 'utf8');
  const layout = fs.readFileSync(new URL('../src/workspaces/create/LayoutWorkspace.tsx', import.meta.url), 'utf8');
  const review = fs.readFileSync(new URL('../src/workspaces/create/ReviewWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /<VisualWorkspace/);
  assert.match(workspace, /<LayoutWorkspace/);
  assert.match(workspace, /<ReviewWorkspace/);
  assert.doesNotMatch(workspace, /配图尚未开始|排版尚未开始|审核尚未开始/);
  assert.match(visual, /确认素材，进入排版/);
  assert.match(visual, /if \(!hasCopy\) return/);
  assert.match(workspace, /canOpenChannelView/);
  assert.match(workspace, /disabled=\{!canOpenChannelView/);
  assert.match(layout, /确认排版，进入审核/);
  assert.match(review, /完成审核，生成发布包/);
  assert.match(review, /下载 .*发布稿/);
});

test('服务端拒绝为没有正文的渠道保存配图方案', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const start = api.indexOf("app.put('/api/v1/creative/projects/:projectId/visual'");
  const end = api.indexOf("app.post('/api/v1/creative/projects/:projectId/visual/complete'", start);
  const route = api.slice(start, end);
  assert.match(route, /existingVersion\.body/);
  assert.match(route, /请先完成.*正文/);
});

test('后半段制作状态按渠道隔离，公众号无需等待其他平台', () => {
  const api = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  assert.match(api, /platforms: \{ \.\.\.delivery\.platforms, \[input\.platform\]/);
  assert.match(api, /platformDelivery\(delivery, input\.platform\)/);
  assert.doesNotMatch(api.slice(api.indexOf("platform-versions/complete"), api.indexOf('function deliveryOf')), /incomplete/);
  assert.match(workspace, /delivery\?\.platforms\?\.\[copyPlatform\]/);
  assert.match(client, /completePlatformVersions: \(projectId: string, platform: CreativePlatform\)/);
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
  assert.match(api, /referenceImageIds:\s*z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(3\)/);
  assert.match(api, /stylePreset:\s*z\.enum\(\['INHERIT'/);
  assert.match(api, /contentBlocks:\s*z\.array/);
  assert.ok((api.match(/prompt:\s*z\.string\(\)\.trim\(\)\.min\(4\)\.max\(8_000\)/g) ?? []).length >= 2);
  assert.match(api, /references:\s*z\.array/);
  assert.match(api, /researchSnapshot\(workspace\.id, projectId, \[\], input\.referenceImageIds\)/);
  assert.match(api, /input\.referenceImageIds\.length \? 'edit' : 'generate'/);
  assert.match(api, /args\.push\('--image', image\)/);
  assert.match(api, /operation = input\.referenceImageIds\.length \? 'IMAGE_TO_IMAGE' : 'TEXT_TO_IMAGE'/);
  assert.match(client, /referenceImageIds\?: string\[\]/);
});
