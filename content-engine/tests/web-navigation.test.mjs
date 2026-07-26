import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const navigation = await import('../src/app/navigation.mjs').catch(() => null);

test('一级导航只生成八个工作入口', () => {
  assert.ok(navigation, '导航模型尚未实现');
  const entries = navigation.navigationGroups.flatMap((group) => group.items);
  assert.deepEqual(
    entries.map(({ view, label }) => [view, label]),
    [
      ['today', '今天'],
      ['discover', '发现'],
      ['plan', '规划'],
      ['create', '创作'],
      ['publish', '发布'],
      ['review', '复盘'],
      ['assets', '素材库'],
      ['settings', '设置'],
    ],
  );
});

test('发现跳转保留局部页面和搜索预设', () => {
  assert.ok(navigation, '导航模型尚未实现');
  const preset = { label: '今日头条', domains: ['toutiao.com'], defaultCategory: '社会' };
  assert.deepEqual(navigation.discoverIntent('search', preset), {
    view: 'discover',
    discoverSection: 'search',
    searchPreset: preset,
  });
});

test('设置跳转可定位检索 API', () => {
  assert.ok(navigation, '导航模型尚未实现');
  assert.deepEqual(navigation.settingsIntent('models', 'search'), {
    view: 'settings',
    settingsSection: 'models',
    modelSection: 'search',
  });
});

test('发现工作区只提供三个采集入口', () => {
  assert.deepEqual(navigation.discoverTabs, [
    { id: 'inbox', label: '热点情报' },
    { id: 'search', label: '网络搜索' },
    { id: 'import', label: '导入链接' },
  ]);
});

test('设置工作区统一管理五类配置', () => {
  assert.deepEqual(navigation.settingsTabs, [
    { id: 'workspace', label: '工作空间' },
    { id: 'sources', label: '资讯来源' },
    { id: 'models', label: '模型与 API' },
    { id: 'feishu', label: '飞书 Base' },
    { id: 'accounts', label: '账号授权' },
  ]);
});

test('热点详情重新打开时读取最近分析运行状态', async () => {
  const source = await readFile(new URL('../src/workspaces/discover/IntelligenceInbox.tsx', import.meta.url), 'utf8');
  assert.match(source, /latestAnalysisRun\(selected\.id\)/);
  assert.match(source, /resumeAnalysisPolling/);
});
