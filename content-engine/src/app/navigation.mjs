export const navigationGroups = [
  {
    id: 'work',
    label: '工作',
    items: [
      { view: 'today', label: '今天' },
      { view: 'discover', label: '发现' },
      { view: 'plan', label: '规划' },
      { view: 'create', label: '创作' },
      { view: 'publish', label: '发布' },
      { view: 'review', label: '复盘' },
    ],
  },
  {
    id: 'resources',
    label: '资源',
    items: [{ view: 'assets', label: '素材库' }],
  },
  {
    id: 'system',
    label: '系统',
    items: [{ view: 'settings', label: '设置' }],
  },
];

export const discoverTabs = [
  { id: 'inbox', label: '热点情报' },
  { id: 'search', label: '网络搜索' },
  { id: 'import', label: '导入链接' },
];

export const settingsTabs = [
  { id: 'workspace', label: '工作空间' },
  { id: 'sources', label: '资讯来源' },
  { id: 'models', label: '模型与 API' },
  { id: 'feishu', label: '飞书 Base' },
  { id: 'accounts', label: '账号授权' },
];

export function discoverIntent(discoverSection = 'inbox', searchPreset = null) {
  return { view: 'discover', discoverSection, searchPreset };
}

export function settingsIntent(settingsSection = 'workspace', modelSection = null) {
  return { view: 'settings', settingsSection, modelSection };
}

export function resetViewport(scrollTarget = globalThis.window) {
  if (typeof scrollTarget?.scrollTo !== 'function') return;
  scrollTarget.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}
