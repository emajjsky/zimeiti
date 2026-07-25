import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('情报源页面分离自动来源和辅助渠道', () => {
  assert.match(mainSource, /自动来源/);
  assert.match(mainSource, /辅助渠道/);
  assert.match(mainSource, /onOpenClip/);
  assert.match(mainSource, /onOpenSearch/);
  assert.match(mainSource, /assistedChannels/);
});

test('辅助渠道搜索向网页搜索页传递域名预设', () => {
  assert.match(mainSource, /searchPreset/);
  assert.match(mainSource, /setSearchPreset/);
  assert.match(mainSource, /preset\.domains/);
});

test('热点卡片显示持久化关键词并限制标签数量', () => {
  assert.match(mainSource, /signal\.keywords/);
  assert.match(mainSource, /slice\(0, 2\)/);
});

test('情报源布局包含窄屏回退和统一交互高度', () => {
  assert.match(styleSource, /\.source-mode-tabs/);
  assert.match(styleSource, /\.assisted-channel-grid/);
  assert.match(styleSource, /@media \(max-width:860px\)/);
  assert.match(styleSource, /min-height:40px/);
});

test('辅助渠道长域名不会撑破卡片网格', () => {
  assert.match(styleSource, /\.assisted-channel-card header\{[^}]*min-width:0/);
  assert.match(styleSource, /\.assisted-channel-card header>div\{flex:1;min-width:0\}/);
});
