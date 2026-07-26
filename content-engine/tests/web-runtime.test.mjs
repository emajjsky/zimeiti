import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url);

test('项目运行时保持纯 Web，不包含 Electron 入口和打包依赖', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', projectRoot), 'utf8'));
  assert.equal(packageJson.main, undefined);
  assert.equal(packageJson.scripts['dev:desktop'], undefined);
  assert.equal(packageJson.scripts['package:win'], undefined);
  assert.equal(packageJson.scripts['package:dir'], undefined);
  assert.equal(packageJson.devDependencies.electron, undefined);
  assert.equal(packageJson.devDependencies['electron-builder'], undefined);
});

test('仓库不再保留 Electron 主进程与预加载脚本', async () => {
  for (const relativePath of ['electron/main.cjs', 'electron/preload.cjs']) {
    await assert.rejects(access(new URL(relativePath, projectRoot)));
  }
});
