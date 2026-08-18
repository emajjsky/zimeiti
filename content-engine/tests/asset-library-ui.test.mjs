import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const library = fs.readFileSync(new URL('../src/workspaces/assets/AssetLibrary.tsx', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../src/components/assets/AssetPreviewDialog.tsx', import.meta.url), 'utf8');
const picker = fs.readFileSync(new URL('../src/components/assets/AssetPickerDialog.tsx', import.meta.url), 'utf8');
const projectMaterials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
const visualWorkspace = fs.readFileSync(new URL('../src/workspaces/create/VisualWorkspace.tsx', import.meta.url), 'utf8');
const ingestionPanel = fs.readFileSync(new URL('../src/workspaces/create/ContentIngestionPanel.tsx', import.meta.url), 'utf8');

test('素材库使用真实空间素材接口并展示上传、预览和项目引用信息', () => {
  assert.doesNotMatch(main, /Utility title="素材库"/);
  assert.match(main, /<AssetLibrary/);
  assert.match(library, /webAssets\.list/);
  assert.match(library, /webAssets\.upload/);
  assert.match(library, /projectCount/);
  assert.match(library, /AssetPreviewDialog/);
});

test('统一预览组件处理鉴权加载失败、重试和 Blob URL 回收', () => {
  assert.match(preview, /webAssets\.content/);
  assert.match(preview, /URL\.revokeObjectURL/);
  assert.match(preview, /素材预览加载失败/);
  assert.match(preview, /重试/);
});

test('项目资料和配图复用同一预览与空间素材选择器', () => {
  assert.match(picker, /webAssets\.list/);
  assert.match(picker, /webAssets\.link/);
  assert.match(picker, /allowUpload/);
  assert.match(picker, /webAssets\.upload/);
  assert.match(projectMaterials, /AssetPreviewDialog/);
  assert.match(projectMaterials, /AssetPickerDialog/);
  assert.match(visualWorkspace, /AssetPreviewDialog/);
  assert.match(visualWorkspace, /AssetPickerDialog/);
});

test('配图参考图同时支持上传和素材库选择，并写入当前配图参考列表', () => {
  assert.match(visualWorkspace, /referenceAssetPickerOpen/);
  assert.match(visualWorkspace, /allowUpload/);
  assert.match(visualWorkspace, /addReference\(asset\)/);
});

test('继续已有内容的素材库使用真实图片预览瀑布墙，而不是文字文件列表', () => {
  assert.match(ingestionPanel, /webAssets\.content/);
  assert.match(ingestionPanel, /content-ingestion-asset-waterfall/);
  assert.match(ingestionPanel, /<img/);
  assert.doesNotMatch(ingestionPanel, /content-ingestion-asset-list/);
});
