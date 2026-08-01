import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const switcher = await readFile(new URL('../src/components/workspace/WorkspaceSwitcher.tsx', import.meta.url), 'utf8').catch(() => '');
const management = await readFile(new URL('../src/workspaces/settings/WorkspaceManagementSettings.tsx', import.meta.url), 'utf8').catch(() => '');
const profile = await readFile(new URL('../src/workspaces/settings/WorkspaceProfileSettings.tsx', import.meta.url), 'utf8');
const repository = await readFile(new URL('../src/data/localRepository.ts', import.meta.url), 'utf8');

test('应用根节点按当前空间重新挂载并提供无空间门禁', () => {
  assert.match(main, /key=\{session\.activeWorkspaceId\}/);
  assert.match(main, /session\.activeWorkspaceId \? <App/);
  assert.match(main, /<WorkspaceGate/);
});

test('顶部空间切换等待保存队列并使用正式切换接口', () => {
  assert.match(main, /flushPendingSaves/);
  assert.match(main, /<WorkspaceSwitcher/);
  assert.match(switcher, /webWorkspaces\.select/);
  assert.match(switcher, /onBeforeSwitch/);
});

test('工作空间管理使用正式创建和重命名接口', () => {
  assert.match(management, /webWorkspaces\.create/);
  assert.match(management, /webWorkspaces\.rename/);
  assert.match(management, /workspace\.role === 'OWNER'/);
});

test('内容偏好不再编辑工作空间主体名称或旧素材目录', () => {
  assert.doesNotMatch(profile, /工作空间名称/);
  assert.doesNotMatch(profile, /materialRoot/);
  assert.doesNotMatch(repository, /materialRoot/);
});
