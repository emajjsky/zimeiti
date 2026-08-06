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
  assert.match(workspace, /layoutAddonsFromDraft/);
  assert.match(workspace, /layoutAddonsDirty/);
  assert.match(workspace, /visualPlan: \{ \.\.\.\(draft\.visualPlan \?\? \{\}\), layoutAddons \}/);
  assert.match(workspace, /应用并刷新预览/);
  assert.match(workspace, /个性开头和结尾/);
  assert.match(workspace, /layoutAddonsDirty \? await saveLayoutAddons\(\) : draft/);
  assert.match(workspace, /精排当前模板/);
  assert.match(workspace, /本次精排要求（可选）/);
  assert.match(workspace, /切换模板不会自动套用本次精排/);
  assert.match(workspace, /webDrafts\.designLayout/);
  assert.match(workspace, /templateId: selectedTemplateId/);
  assert.match(workspace, /setSelectedPreview\(\{ \.\.\.result, html: hydratePreviewHtml\(result\.html, assetSourcesRef\.current\) \}\)/);
  assert.match(workspace, /实际策略：公众号智能精排（\$\{result\.policy\.scope\}）/);
  assert.match(workspace, /thumbnailPreviewHtml/);
  assert.match(workspace, /data-layout-thumbnail/);
  assert.match(workspace, /thumbnailPreviewHtml\(template\)/);
  assert.match(workspace, /template\.rules/);
  assert.match(workspace, /overflow:hidden;-ms-overflow-style:none;scrollbar-width:none/);
  for (const token of ['shadow-card', 'center-underline', 'case-card', 'tocVariant', 'tagVariant', 'listVariant', 'linkVariant', 'paragraphVariant', 'inlineVariant']) assert.match(workspace, new RegExp(token));
  assert.match(workspace, /LAYOUT_TEMPLATE_SOURCE_UNREADABLE/);
  assert.match(workspace, /\[502, 503, 504\]\.includes\(error\.status\)/);
  assert.doesNotMatch(workspace, /<pre>|HTML 发布稿进入审核/);
  assert.match(picker, /导入公众号模板/);
  assert.match(picker, /confirmedRights/);
  assert.match(picker, /我确认有权参考该文章的排版/);
  assert.match(picker, /duplicate|复制模板/);
  assert.match(picker, /onRemove|删除模板/);
  assert.match(picker, /overflow:hidden;-ms-overflow-style:none;scrollbar-width:none/);
});

test('模板客户端公开完整管理与服务端预览 API，导入不接受浏览器模型参数', async () => {
  const api = await read('../src/data/webApi.ts');
  const start = api.indexOf('export const webWechatTemplates');
  assert.notEqual(start, -1);
  const section = api.slice(start, api.indexOf('\nexport const ', start + 20) === -1 ? undefined : api.indexOf('\nexport const ', start + 20));
  for (const method of ['list:', 'create:', 'patch:', 'duplicate:', 'archive:', 'remove:', 'import:', 'preview:']) assert.match(section, new RegExp(method));
  assert.match(section, /confirmedRights:\s*true/);
  assert.doesNotMatch(section, /model\s*:/);
  assert.match(api, /designLayout: \(draftId: string/);
  assert.match(api, /\/creative\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/layout\/design/);
});

test('模板卡片、预览画布和移动端工具条都有稳定尺寸', async () => {
  const styles = await read('../src/styles.css');
  assert.match(styles, /\.wechat-template-grid[^{]*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.wechat-template-mini-preview[^{]*\{[^}]*aspect-ratio:/s);
  assert.match(styles, /\.wechat-layout-preview-frame[^{]*\{[^}]*min-height:/s);
  assert.match(styles, /@media \(max-width:560px\)[^{]*\{[\s\S]*\.wechat-layout-workspace/s);
});
