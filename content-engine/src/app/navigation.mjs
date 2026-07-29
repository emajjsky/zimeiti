export const navigationGroups = [
  {
    id: 'work',
    label: '工作',
    items: [
      { view: 'today', label: '今天' },
      { view: 'discover', label: '发现' },
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
  { id: 'voices', label: '账号声音' },
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

const views = new Set(navigationGroups.flatMap((group) => group.items.map((item) => item.view)));
const legacyCreativeViews = new Set(['plan', 'topicEditor']);
const discoverSections = new Set(discoverTabs.map((item) => item.id));
const settingsSections = new Set(settingsTabs.map((item) => item.id));
const modelSections = new Set(['bailian', 'agent', 'search', 'connections', 'policies', 'templates', 'usage']);
const platforms = new Set(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL']);
const createStages = new Set(['planning', 'research', 'master', 'platform', 'visual', 'layout', 'review']);

function allowed(value, values, fallback = null) {
  return typeof value === 'string' && values.has(value) ? value : fallback;
}

export function readWorkspaceLocation(locationTarget = globalThis.location) {
  const params = new URLSearchParams(locationTarget?.search ?? '');
  const requestedView = params.get('view');
  const isLegacyCreative = legacyCreativeViews.has(requestedView);
  return {
    view: isLegacyCreative ? 'create' : allowed(requestedView, views, 'today'),
    discoverSection: allowed(params.get('discover'), discoverSections, 'inbox'),
    settingsSection: allowed(params.get('settings'), settingsSections, 'workspace'),
    modelSection: allowed(params.get('model'), modelSections),
    intelligenceId: params.get('intel') || null,
    legacyTopicId: isLegacyCreative ? params.get('topic') || null : null,
    projectId: params.get('project') || null,
    platform: allowed(params.get('platform'), platforms, 'WECHAT'),
    stage: allowed(params.get('stage'), createStages, 'planning'),
  };
}

export function workspaceLocationUrl(route, locationTarget = globalThis.location) {
  const url = new URL(locationTarget?.href ?? 'http://localhost/');
  const params = url.searchParams;
  ['discover', 'settings', 'model', 'intel', 'topic', 'project', 'stage', 'platform'].forEach((key) => params.delete(key));
  params.set('view', allowed(route.view, views, 'today'));
  if (route.view === 'discover') {
    params.set('discover', allowed(route.discoverSection, discoverSections, 'inbox'));
    if (route.intelligenceId) params.set('intel', route.intelligenceId);
  }
  if (route.view === 'settings') {
    params.set('settings', allowed(route.settingsSection, settingsSections, 'workspace'));
    if (route.settingsSection === 'models' && allowed(route.modelSection, modelSections)) params.set('model', route.modelSection);
  }
  if (route.view === 'create' || route.view === 'publish') {
    if (route.projectId) params.set('project', route.projectId);
  }
  if (route.view === 'create') {
    if (route.projectId) params.set('stage', allowed(route.stage, createStages, 'planning'));
    params.set('platform', allowed(route.platform, platforms, 'WECHAT'));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function replaceWorkspaceLocation(route, historyTarget = globalThis.history, locationTarget = globalThis.location) {
  if (typeof historyTarget?.replaceState !== 'function') return;
  historyTarget.replaceState(historyTarget.state ?? null, '', workspaceLocationUrl(route, locationTarget));
}
