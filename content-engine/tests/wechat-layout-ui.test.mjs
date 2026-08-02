import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('公众号排版工作台只接收草稿并提供模板库与真实预览', async () => {
  const [workspace, picker] = await Promise.all([
    read('../src/workspaces/create/LayoutWorkspace.tsx'),
    read('../src/workspaces/create/WechatLayoutTemplatePicker.tsx'),
  ]);
  assert.match(workspace, /LayoutWorkspace\(\{ draft, onDraftChange, onComplete \}/);
  assert.doesNotMatch(workspace, /activePlatform|platformName|webCreative\.delivery/);
  assert.match(workspace, /WechatLayoutTemplatePicker/);
  assert.match(workspace, /<iframe/);
  assert.match(picker, /sandbox=""/);
  assert.match(workspace, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(workspace, /allow-scripts/);
  assert.match(workspace, /srcDoc=\{selectedPreview\.html\}/);
  assert.match(workspace, /保存公众号草稿/);
  assert.match(workspace, /selectedPreview\.templateVersionId/);
  assert.match(workspace, /webDrafts\.complete\(workingDraft\.id, workingDraft\.revision\)/);
  assert.match(workspace, /thumbnailPreviewHtml/);
  assert.doesNotMatch(workspace, /<pre>|HTML 发布稿|进入审核/);
  assert.match(picker, /导入公众号模板/);
  assert.match(picker, /confirmedRights/);
  assert.match(picker, /我确认有权参考该文章的排版/);
  assert.match(picker, /duplicate|复制模板/);
  assert.match(picker, /archive|归档模板/);
});

test('模板客户端公开完整管理与服务端预览 API，导入不接受浏览器模型参数', async () => {
  const api = await read('../src/data/webApi.ts');
  const start = api.indexOf('export const webWechatTemplates');
  assert.notEqual(start, -1);
  const section = api.slice(start, api.indexOf('\nexport const ', start + 20) === -1 ? undefined : api.indexOf('\nexport const ', start + 20));
  for (const method of ['list:', 'create:', 'patch:', 'duplicate:', 'archive:', 'import:', 'preview:']) assert.match(section, new RegExp(method));
  assert.match(section, /confirmedRights:\s*true/);
  assert.doesNotMatch(section, /model\s*:/);
});

test('模板卡片、预览画布和移动端工具条都有稳定尺寸', async () => {
  const styles = await read('../src/styles.css');
  assert.match(styles, /\.wechat-template-grid[^{]*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.wechat-template-mini-preview[^{]*\{[^}]*aspect-ratio:/s);
  assert.match(styles, /\.wechat-layout-preview-frame[^{]*\{[^}]*min-height:/s);
  assert.match(styles, /@media \(max-width:560px\)[^{]*\{[\s\S]*\.wechat-layout-workspace/s);
});
