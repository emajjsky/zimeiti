import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const screenStart = mainSource.indexOf('function ModelSettingsScreen()');
const screenEnd = mainSource.indexOf('function UsageOverview', screenStart);
const screenSource = mainSource.slice(screenStart, screenEnd);

test('模型与 API 页头随当前页签变化', () => {
  assert.match(mainSource, /const modelSettingsScreenTitles[\s\S]*bailian:\s*'百炼'[\s\S]*usage:\s*'调用记录'/);
  assert.match(screenSource, /title=\{modelSettingsScreenTitles\[screen\]\}/);
  assert.doesNotMatch(screenSource, /title="模型路由"/);
});

test('调用统计只在调用记录页渲染', () => {
  assert.match(screenSource, /screen === 'usage' && <UsageOverview usage=\{usage\} \/>/);
  assert.equal((screenSource.match(/<UsageOverview/g) ?? []).length, 1);
});

test('模型设置页不再渲染跨页连接概览', () => {
  assert.doesNotMatch(screenSource, /<CredentialInventory/);
  assert.doesNotMatch(mainSource, /function CredentialInventory/);
  assert.doesNotMatch(stylesSource, /\.credential-inventory/);
});

test('页面反馈只显示在所属页签', () => {
  assert.match(screenSource, /notice\?\.screen === screen/);
  assert.match(screenSource, /screen:\s*'policies'[\s\S]*已同步/);
});

test('模型设置内容宽度与其他后台页面保持一致', () => {
  assert.match(stylesSource, /\.ai-settings\s*\{[^}]*max-width:\s*1400px/);
  assert.match(stylesSource, /\.ai-section-content-policies \.policy-split\s*\{[^}]*max-width:\s*1180px/);
  assert.doesNotMatch(stylesSource, /\.core-agent-settings,\.bailian-web-settings\s*\{[^}]*max-width:\s*760px/);
});
