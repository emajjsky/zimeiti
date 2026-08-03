import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  draftSourceState,
  moveDraftAsset,
  normalizeDraftAssets,
  removeDraftAsset,
} from '../src/domain/platform-draft-editor.mjs';

const assets = [
  { assetId: 'asset-a', role: 'COVER' },
  { assetId: 'asset-b', role: 'BODY' },
  { assetId: 'asset-c', role: 'BODY' },
];

test('平台草稿素材最多九张且不能重复', () => {
  assert.deepEqual(normalizeDraftAssets(assets), assets);
  assert.throws(() => normalizeDraftAssets([...assets, { assetId: 'asset-a', role: 'BODY' }]), /重复/);
  assert.throws(() => normalizeDraftAssets(Array.from({ length: 10 }, (_, index) => ({ assetId: `asset-${index}`, role: 'BODY' }))), /9/);
});

test('素材上移下移和删除保持明确顺序与封面角色', () => {
  assert.deepEqual(moveDraftAsset(assets, 2, -1).map(({ assetId }) => assetId), ['asset-a', 'asset-c', 'asset-b']);
  assert.deepEqual(moveDraftAsset(assets, 0, -1), assets);
  assert.deepEqual(removeDraftAsset(assets, 0), [
    { assetId: 'asset-b', role: 'COVER' },
    { assetId: 'asset-c', role: 'BODY' },
  ]);
});

test('派生草稿明确区分当前来源、旧来源和缺失来源', () => {
  assert.equal(draftSourceState({ sourceDraftVersionId: 'version-2', sourceStale: false }, 'version-2'), 'CURRENT');
  assert.equal(draftSourceState({ sourceDraftVersionId: 'version-1', sourceStale: true }, 'version-2'), 'STALE');
  assert.equal(draftSourceState({ sourceDraftVersionId: null, sourceStale: false }, 'version-2'), 'MISSING');
});

test('小红书和微博共用单页编辑器并复用素材预览选择器', async () => {
  const editor = await readFile(new URL('../src/workspaces/create/PlatformDraftEditor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /小红书.*微博/s);
  assert.match(editor, /AssetPreviewDialog/);
  assert.match(editor, /AssetPickerDialog/);
  assert.match(editor, /webDrafts\.patch/);
  assert.match(editor, /webDrafts\.replaceAssets/);
  assert.match(editor, /TEXT_TO_IMAGE/);
  assert.match(editor, /IMAGE_TO_IMAGE/);
  assert.doesNotMatch(editor, /配图步骤|排版步骤|审核步骤/);
});

test('生图接口只允许三个产品平台并返回实际任务策略', async () => {
  const server = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const generation = await readFile(new URL('../server/services/visual-generation.cjs', import.meta.url), 'utf8');
  assert.match(generation, /platform: z\.literal\('WECHAT'\)/);
  assert.match(generation, /platform: z\.enum\(\['XIAOHONGSHU', 'WEIBO'\]\)/);
  assert.match(generation, /z\.discriminatedUnion\('platform'/);
  assert.match(server, /policy: \{ scope: operation, provider: policy\.rows\[0\]\.provider, model \}/);
  assert.match(server, /const visualPlanningInput = z\.object\(\{\s*platform: z\.literal\('WECHAT'\)/);
});
