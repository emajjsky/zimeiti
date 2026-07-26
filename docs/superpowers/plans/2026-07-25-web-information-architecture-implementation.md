# 内容引擎 Web 信息架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有内容引擎重构为纯 Web 自媒体工作台，收敛一级导航，并把信息采集统一归入“发现”、系统配置统一归入“设置”。

**Architecture:** 保留现有 React、Vite、服务 API 和领域数据结构，只重构前端导航状态、页面壳和组件归属。新增独立的导航类型、局部页签组件、发现工作区和设置工作区；业务面板继续复用现有 API，不创建第二套数据状态。

**Tech Stack:** React、TypeScript、Vite、原生 CSS、Lucide React、Node Test Runner、Playwright 手工或脚本验收

## Global Constraints

- 一级导航固定为：今天、发现、规划、创作、发布、复盘、素材库、设置。
- “发现”固定包含：热点情报、网络搜索、导入链接。
- “设置”固定包含：工作空间、资讯来源、模型与 API、飞书 Base、账号授权。
- 用户可见界面不得出现 Desktop、桌面客户端、V0.1、GPU 或本地运行概念。
- “剪藏链接”用户文案统一改为“导入链接”。
- 微博、今日头条、央视网、X、公众号、财经媒体、官方公告只作为网络搜索来源范围预设，不形成独立辅助渠道页面。
- 继续复用 RSS、Tavily、公开链接读取、分类、去重、30 天保留、模型和飞书服务契约；只新增资讯来源更新接口。
- 不引入新设计系统、路由库、图标库或动画库。
- 视觉参数固定为 `DESIGN_VARIANCE: 4`、`MOTION_INTENSITY: 2`、`VISUAL_DENSITY: 6`。
- 页面面板统一 8px 圆角，输入框和按钮统一 6px 圆角，普通容器不使用厚重偏移阴影。
- 所有页面必须具备 Loading、Empty、Error、Success 状态。
- 1280、1024、768、390 像素宽度不得横向溢出。
- 文件修改使用 `apply_patch`，不得覆盖无关用户改动。

---

## File Structure

### 新建文件

- `content-engine/src/app/navigation.ts`
  - 定义一级视图、发现局部视图、设置局部视图和导航标签。
- `content-engine/src/components/workspace/WorkspaceTabs.tsx`
  - 渲染发现页面顶部页签和设置窄屏页签。
- `content-engine/src/components/workspace/PageHeader.tsx`
  - 统一页面标题、主操作和状态反馈区域。
- `content-engine/src/workspaces/DiscoverWorkspace.tsx`
  - 管理发现局部导航和三个发现子页面的显示。
- `content-engine/src/workspaces/SettingsWorkspace.tsx`
  - 管理设置二级导航和五个设置子页面的显示。
- `content-engine/tests/web-information-architecture.test.mjs`
  - 验证导航归属、用户文案、跨页面跳转意图和禁用旧入口。
- `content-engine/tests/web-responsive-contract.test.mjs`
  - 验证响应式和 Taste 视觉约束。

### 修改文件

- `content-engine/src/main.tsx`
  - 使用新的导航类型和工作区壳；重命名并迁移现有业务面板；删除旧一级 View 和辅助渠道页面。
- `content-engine/src/data/webApi.ts`
  - 增加资讯来源更新请求。
- `content-engine/src/styles.css`
  - 重构应用壳、侧栏、页面标题、工作区页签、搜索布局、来源设置和响应式样式。
- `content-engine/server/index.cjs`
  - 增加来源更新路由和输入校验。
- `content-engine/server/services/intelligenceRepository.cjs`
  - 持久化来源编辑、启停和刷新频率。
- `content-engine/tests/intelligence-ui-contract.test.mjs`
  - 将旧“自动来源/辅助渠道”契约改为新的发现和设置归属契约。
- `content-engine/tests/model-settings-layout.test.mjs`
  - 保留模型设置内部功能断言，增加其归属设置工作区的断言。
- `docs/01_PRD_内容引擎.md`
  - 更新产品导航和采集流程。
- `docs/02_PLAN_内容引擎.md`
  - 记录重构完成情况和下一验收关口。
- `docs/03_IMPLEMENT_内容引擎.md`
  - 记录组件结构、导航状态和兼容边界。
- `docs/04_ACCEPTANCE_LOG_内容引擎.md`
  - 记录自动化测试和各视口验收结果。

---

### Task 1: 建立导航领域模型并锁定一级信息架构

**Files:**
- Create: `content-engine/src/app/navigation.ts`
- Create: `content-engine/tests/web-information-architecture.test.mjs`
- Modify: `content-engine/src/main.tsx:13-46`

**Interfaces:**
- Produces: `View`、`DiscoverSection`、`SettingsSection`、`primaryNavigation`、`resourceNavigation`。
- Consumes: 现有 `main.tsx` 的 `setView` 和 Lucide 图标映射。

- [ ] **Step 1: 写一级导航失败测试**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const navigationSource = await readFile(
  new URL('../src/app/navigation.ts', import.meta.url),
  'utf8',
).catch(() => '');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('一级导航只保留工作阶段、素材库和设置', () => {
  assert.match(navigationSource, /'today'/);
  assert.match(navigationSource, /'discover'/);
  assert.match(navigationSource, /'assets'/);
  assert.match(navigationSource, /'settings'/);
  assert.doesNotMatch(navigationSource, /'sources'/);
  assert.doesNotMatch(navigationSource, /'clip'/);
  assert.doesNotMatch(navigationSource, /'automation'/);
  assert.doesNotMatch(navigationSource, /'models'/);
});

test('发现和设置使用独立局部视图', () => {
  assert.match(navigationSource, /DiscoverSection = 'inbox' \| 'search' \| 'import'/);
  assert.match(navigationSource, /SettingsSection =[^;]*'workspace'[^;]*'sources'[^;]*'models'[^;]*'feishu'[^;]*'accounts'/s);
});

test('旧入口不再由 main 定义为一级 View', () => {
  assert.doesNotMatch(mainSource, /view === 'sources'/);
  assert.doesNotMatch(mainSource, /view === 'clip'/);
  assert.doesNotMatch(mainSource, /view === 'automation'/);
  assert.doesNotMatch(mainSource, /view === 'models'/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs
```

Expected: FAIL，原因是 `src/app/navigation.ts` 尚不存在，且 `main.tsx` 仍含旧一级 View。

- [ ] **Step 3: 创建导航类型和标签**

```ts
export type View =
  | 'today'
  | 'discover'
  | 'plan'
  | 'topicEditor'
  | 'create'
  | 'publish'
  | 'review'
  | 'assets'
  | 'settings';

export type DiscoverSection = 'inbox' | 'search' | 'import';

export type SettingsSection =
  | 'workspace'
  | 'sources'
  | 'models'
  | 'feishu'
  | 'accounts';

export const primaryNavigation = [
  { view: 'today', label: '今天' },
  { view: 'discover', label: '发现' },
  { view: 'plan', label: '规划' },
  { view: 'create', label: '创作' },
  { view: 'publish', label: '发布' },
  { view: 'review', label: '复盘' },
] as const;

export const resourceNavigation = [
  { view: 'assets', label: '素材库' },
  { view: 'settings', label: '设置' },
] as const;
```

在 `main.tsx` 中删除本地 `View` 定义，从新文件导入类型。图标仍由 `main.tsx` 根据 `view` 映射，避免导航领域文件依赖 React 图标组件。

- [ ] **Step 4: 收敛 App 一级状态**

在 `App` 中增加局部状态：

```ts
const [discoverSection, setDiscoverSection] = useState<DiscoverSection>('inbox');
const [settingsSection, setSettingsSection] = useState<SettingsSection>('workspace');
```

删除 `sources`、`clip`、`automation`、`models` 的一级渲染分支，暂时在 `discover` 和 `settings` 分支放置工作区占位，确保类型检查先恢复。

- [ ] **Step 5: 运行测试和类型检查**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs
npm run typecheck
```

Expected: 两条命令均通过。

- [ ] **Step 6: 提交**

```powershell
git add content-engine/src/app/navigation.ts content-engine/src/main.tsx content-engine/tests/web-information-architecture.test.mjs
git commit -m "refactor web navigation model"
```

---

### Task 2: 重构应用壳、页面标题和局部页签组件

**Files:**
- Create: `content-engine/src/components/workspace/PageHeader.tsx`
- Create: `content-engine/src/components/workspace/WorkspaceTabs.tsx`
- Modify: `content-engine/src/main.tsx:235-305`
- Modify: `content-engine/src/styles.css:1-80`
- Modify: `content-engine/tests/web-information-architecture.test.mjs`

**Interfaces:**
- Consumes: `DiscoverSection`、`SettingsSection`。
- Produces: `PageHeader`、`WorkspaceTabs<T>`。

- [ ] **Step 1: 写应用壳和禁用桌面文案测试**

```js
test('应用壳不显示桌面端和版本装饰', () => {
  assert.doesNotMatch(mainSource, /DESKTOP/i);
  assert.doesNotMatch(mainSource, /V0\.1/i);
  assert.doesNotMatch(mainSource, /桌面客户端/);
});

test('页面使用统一标题和局部页签组件', async () => {
  const tabsSource = await readFile(
    new URL('../src/components/workspace/WorkspaceTabs.tsx', import.meta.url),
    'utf8',
  ).catch(() => '');
  const headerSource = await readFile(
    new URL('../src/components/workspace/PageHeader.tsx', import.meta.url),
    'utf8',
  ).catch(() => '');
  assert.match(tabsSource, /role="tablist"/);
  assert.match(tabsSource, /aria-selected/);
  assert.match(headerSource, /page-header-actions/);
  assert.match(headerSource, /page-header-feedback/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs
```

Expected: FAIL，组件尚不存在且界面仍包含 `DESKTOP · V0.1`。

- [ ] **Step 3: 创建 PageHeader**

```tsx
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  actions,
  feedback,
}: {
  title: string;
  actions?: ReactNode;
  feedback?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1>{title}</h1>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {feedback && <div className="page-header-feedback" aria-live="polite">{feedback}</div>}
    </header>
  );
}
```

- [ ] **Step 4: 创建 WorkspaceTabs**

```tsx
export type WorkspaceTab<T extends string> = {
  id: T;
  label: string;
};

export function WorkspaceTabs<T extends string>({
  value,
  tabs,
  onChange,
  ariaLabel,
}: {
  value: T;
  tabs: readonly WorkspaceTab<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={value === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 简化顶部栏和侧栏**

在 `main.tsx` 中：

- 顶部栏只保留产品标识、全局搜索、新建选题、通知、刷新和头像。
- 删除侧栏中的重复工作空间品牌块、版本号和第二个新建选题按钮。
- 将侧栏分成“工作”“资源”“系统”三个语义分组。
- 当前项保持 `aria-current="page"`。

目标结构：

```tsx
<aside className="sidebar">
  <NavigationGroup label="工作" items={workItems} />
  <NavigationGroup label="资源" items={resourceItems} />
  <NavigationGroup label="系统" items={systemItems} />
</aside>
```

- [ ] **Step 6: 添加基础样式**

在 `styles.css` 中：

```css
:root {
  --surface: #ffffff;
  --surface-muted: #eef2f7;
  --surface-active: #dfe9ff;
  --ink: #17203b;
  --muted: #66718a;
  --accent: #275fe8;
  --line: #cfd6e3;
  --radius-panel: 8px;
  --radius-control: 6px;
}

.page-header { display: grid; gap: 10px; margin-bottom: 20px; }
.page-header-main { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-header h1 { margin: 0; font-size: clamp(28px, 3vw, 32px); line-height: 1.2; }
.workspace-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--line); }
.workspace-tabs button { min-height: 42px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; }
.workspace-tabs button.active { border-bottom-color: var(--accent); color: var(--accent); font-weight: 700; }
```

- [ ] **Step 7: 运行测试、类型检查和构建**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs
npm run typecheck
npm run build
```

Expected: 全部通过。

- [ ] **Step 8: 提交**

```powershell
git add content-engine/src/components/workspace content-engine/src/main.tsx content-engine/src/styles.css content-engine/tests/web-information-architecture.test.mjs
git commit -m "refactor web application shell"
```

---

### Task 3: 建立发现工作区并迁移热点、网络搜索和导入链接

**Files:**
- Create: `content-engine/src/workspaces/DiscoverWorkspace.tsx`
- Modify: `content-engine/src/main.tsx:314-421`
- Modify: `content-engine/src/main.tsx:1045-1054`
- Modify: `content-engine/tests/web-information-architecture.test.mjs`
- Modify: `content-engine/tests/intelligence-ui-contract.test.mjs`

**Interfaces:**
- Consumes: `DiscoverSection`、`SearchPreset`、现有 `Discover`、`WebSearchPanel`、`LinkClipEditor` 业务逻辑。
- Produces: `DiscoverWorkspace`、`LinkImportPanel`、`openDiscover(section, preset?)`。

- [ ] **Step 1: 写发现归属失败测试**

```js
test('发现工作区包含三个局部页签', async () => {
  const source = await readFile(
    new URL('../src/workspaces/DiscoverWorkspace.tsx', import.meta.url),
    'utf8',
  ).catch(() => '');
  assert.match(source, /热点情报/);
  assert.match(source, /网络搜索/);
  assert.match(source, /导入链接/);
});

test('用户界面不再使用剪藏链接', () => {
  assert.doesNotMatch(mainSource, />剪藏链接</);
  assert.match(mainSource, /function LinkImportPanel/);
});

test('搜索来源预设只出现在网络搜索中', () => {
  const searchStart = mainSource.indexOf('function WebSearchPanel');
  const searchSource = mainSource.slice(searchStart);
  assert.match(searchSource, /assistedChannels\.map/);
});

test('来源预设包含国内外主动检索渠道', async () => {
  const sourceCatalog = await readFile(
    new URL('../src/data/intelligenceSources.ts', import.meta.url),
    'utf8',
  );
  for (const label of ['微博', '今日头条', '央视网', 'X', '公众号', '财经媒体', '官方公告']) {
    assert.match(sourceCatalog, new RegExp(label));
  }
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs tests/intelligence-ui-contract.test.mjs
```

Expected: FAIL，发现工作区尚不存在，且旧文案仍为“剪藏链接”。

- [ ] **Step 3: 创建 DiscoverWorkspace**

```tsx
import type { ReactNode } from 'react';
import type { DiscoverSection } from '../app/navigation';
import { WorkspaceTabs } from '../components/workspace/WorkspaceTabs';

const tabs = [
  { id: 'inbox', label: '热点情报' },
  { id: 'search', label: '网络搜索' },
  { id: 'import', label: '导入链接' },
] as const;

export function DiscoverWorkspace({
  section,
  onSectionChange,
  inbox,
  search,
  linkImport,
}: {
  section: DiscoverSection;
  onSectionChange: (section: DiscoverSection) => void;
  inbox: ReactNode;
  search: ReactNode;
  linkImport: ReactNode;
}) {
  return (
    <section className="discover-workspace">
      <WorkspaceTabs value={section} tabs={tabs} onChange={onSectionChange} ariaLabel="发现" />
      <div className="workspace-section" role="tabpanel">
        {section === 'inbox' ? inbox : section === 'search' ? search : linkImport}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 在 App 中建立统一发现跳转**

```ts
const openDiscover = (section: DiscoverSection, preset?: SearchPreset | null) => {
  setView('discover');
  setDiscoverSection(section);
  if (section === 'search') setSearchPreset(preset ?? null);
};
```

`view === 'discover'` 只渲染一个 `DiscoverWorkspace`，并把三个现有面板作为插槽传入。

- [ ] **Step 5: 重命名并调整导入链接面板**

- `LinkClipEditor` 改为 `LinkImportPanel`。
- 页面标题改为“导入链接”。
- 空 URL 时读取按钮 `disabled`。
- 成功保存后调用 `openDiscover('inbox')`。
- 成功状态提供“查看热点情报”和“继续导入”两个按钮。
- API 函数 `previewPublicLink` 和数据字段 `captureMethod: 'MANUAL_LINK'` 不改名。

- [ ] **Step 6: 重排网络搜索表单**

将来源范围按钮改为单个下拉：

```tsx
<select
  value={selectedChannelId}
  onChange={(event) => applyChannel(event.target.value)}
>
  <option value="ALL">全网</option>
  {assistedChannels.map((channel) => (
    <option key={channel.id} value={channel.id}>{channel.label}</option>
  ))}
</select>
```

`applyChannel` 将选中的渠道域名写入 `domains`，保持 `searchWeb({ query, category, domains })` 契约不变。

- [ ] **Step 7: 更新旧情报 UI 契约测试**

删除以下旧断言：

- “自动来源/辅助渠道”两个模式。
- `onOpenClip`、`onOpenSearch`。
- `.assisted-channel-grid` 和 `.assisted-channel-card`。

新增断言：

- 来源设置中不出现 `assistedChannels.map`。
- 网络搜索中出现来源预设。
- `LinkImportPanel` 使用“导入链接”。

- [ ] **Step 8: 运行发现相关测试**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs tests/intelligence-ui-contract.test.mjs tests/intelligence-filters.test.mjs tests/intelligence-sources.test.mjs
npm run typecheck
```

Expected: 全部通过。

- [ ] **Step 9: 提交**

```powershell
git add content-engine/src/workspaces/DiscoverWorkspace.tsx content-engine/src/main.tsx content-engine/tests/web-information-architecture.test.mjs content-engine/tests/intelligence-ui-contract.test.mjs
git commit -m "refactor discover collection workspace"
```

---

### Task 4: 建立设置工作区并迁移资讯来源、模型、飞书和账号

**Files:**
- Create: `content-engine/src/workspaces/SettingsWorkspace.tsx`
- Modify: `content-engine/src/main.tsx:682-1044`
- Modify: `content-engine/src/data/webApi.ts:38-46`
- Modify: `content-engine/server/index.cjs:282-289`
- Modify: `content-engine/server/services/intelligenceRepository.cjs:14-40`
- Modify: `content-engine/tests/web-information-architecture.test.mjs`
- Modify: `content-engine/tests/model-settings-layout.test.mjs`

**Interfaces:**
- Consumes: `SettingsSection`、现有 `ModelSettingsScreen`、`FeishuTemplateEditor` 和来源管理回调。
- Produces: `SettingsWorkspace`、`SourceSettings`、`WorkspaceProfileSettings`、`AccountAuthorizationSettings`、`openSettings(section, modelScreen?)`。

- [ ] **Step 1: 写设置归属失败测试**

```js
test('设置工作区包含五个配置页签', async () => {
  const source = await readFile(
    new URL('../src/workspaces/SettingsWorkspace.tsx', import.meta.url),
    'utf8',
  ).catch(() => '');
  for (const label of ['工作空间', '资讯来源', '模型与 API', '飞书 Base', '账号授权']) {
    assert.match(source, new RegExp(label));
  }
});

test('资讯来源只负责自动采集来源', () => {
  const start = mainSource.indexOf('function SourceSettings');
  const end = mainSource.indexOf('function WorkspaceProfileSettings', start);
  const sourceSettings = mainSource.slice(start, end);
  assert.match(sourceSettings, /automaticSourceGroups/);
  assert.doesNotMatch(sourceSettings, /assistedChannels/);
  assert.doesNotMatch(sourceSettings, /onOpenClip/);
  assert.doesNotMatch(sourceSettings, /onOpenSearch/);
});

test('模型页面归属于设置工作区', async () => {
  const settingsSource = await readFile(
    new URL('../src/workspaces/SettingsWorkspace.tsx', import.meta.url),
    'utf8',
  );
  assert.match(settingsSource, /models/);
  assert.match(mainSource, /models=\{<ModelSettingsScreen/);
});

test('来源编辑具备真实持久化接口', async () => {
  const webApiSource = await readFile(new URL('../src/data/webApi.ts', import.meta.url), 'utf8');
  const serverSource = await readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const repositorySource = await readFile(
    new URL('../server/services/intelligenceRepository.cjs', import.meta.url),
    'utf8',
  );
  assert.match(webApiSource, /updateSource:/);
  assert.match(webApiSource, /method:\s*'PUT'/);
  assert.match(serverSource, /app\.put\('\/api\/v1\/intelligence\/sources\/:id'/);
  assert.match(repositorySource, /async function updateSource/);
  assert.match(repositorySource, /enabled = \$9/);
  assert.match(repositorySource, /refresh_minutes = \$10/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs tests/model-settings-layout.test.mjs
```

Expected: FAIL，设置工作区不存在，来源组件仍包含辅助渠道。

- [ ] **Step 3: 创建 SettingsWorkspace**

```tsx
import type { ReactNode } from 'react';
import type { SettingsSection } from '../app/navigation';

const items = [
  { id: 'workspace', label: '工作空间' },
  { id: 'sources', label: '资讯来源' },
  { id: 'models', label: '模型与 API' },
  { id: 'feishu', label: '飞书 Base' },
  { id: 'accounts', label: '账号授权' },
] as const;

export function SettingsWorkspace({
  section,
  onSectionChange,
  workspace,
  sources,
  models,
  feishu,
  accounts,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  workspace: ReactNode;
  sources: ReactNode;
  models: ReactNode;
  feishu: ReactNode;
  accounts: ReactNode;
}) {
  const panels = { workspace, sources, models, feishu, accounts };
  return (
    <section className="settings-workspace">
      <nav className="settings-subnav" aria-label="设置">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? 'page' : undefined}
            className={section === item.id ? 'active' : ''}
            onClick={() => onSectionChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">{panels[section]}</div>
    </section>
  );
}
```

- [ ] **Step 4: 增加来源更新服务接口**

在 `src/data/webApi.ts` 增加：

```ts
updateSource: (
  sourceId: string,
  source: Omit<LocalState['sources'][number], 'id' | 'lastSyncedAt' | 'lastError'>,
) => request<LocalState['sources'][number]>(`/intelligence/sources/${sourceId}`, {
  method: 'PUT',
  body: JSON.stringify(source),
}),
```

在 `server/index.cjs` 增加：

```js
app.put('/api/v1/intelligence/sources/:id', { preHandler: authenticate }, async (request) => {
  const input = sourceInput.parse(request.body);
  const workspace = await currentWorkspace(request.user.sub);
  return updateSource(workspace.id, request.params.id, input);
});
```

将 `updateSource` 加入仓储导入和导出。仓储实现完整更新可编辑字段：

```js
async function updateSource(workspaceId, sourceId, source) {
  const result = await query(`UPDATE intelligence_sources SET
    name = $3,
    url = $4,
    category = $5,
    include_keywords = $6,
    exclude_keywords = $7,
    language = $8,
    enabled = $9,
    refresh_minutes = $10,
    trust = $11
    WHERE id = $1 AND workspace_id = $2
    RETURNING *`, [
    sourceId,
    workspaceId,
    source.name.trim(),
    source.url.trim(),
    source.category.trim(),
    JSON.stringify(source.includeKeywords ?? []),
    JSON.stringify(source.excludeKeywords ?? []),
    source.language ?? 'ALL',
    source.enabled !== false,
    Math.max(5, Number(source.refreshMinutes) || 60),
    source.trust,
  ]);
  if (!result.rowCount) throw new Error('未找到资讯来源。');
  return sourceDto(result.rows[0]);
}
```

- [ ] **Step 5: 收敛 SourceSettings**

- `SettingsHub` 重命名为 `SourceSettings`。
- 删除 `mode`、辅助渠道页签、`onOpenClip` 和 `onOpenSearch`。
- 保留来源目录、自定义 RSS、已接入来源、同步时间和错误。
- 页面标题由设置工作区管理，组件内部只保留内容区。

目标签名：

```ts
function SourceSettings({
  sources,
  onAddSource,
  onAddSources,
  onUpdateSource,
  onRemoveSource,
}: {
  sources: IntelligenceSource[];
  onAddSource: (source: NewSourceInput) => void;
  onAddSources: (sources: NewSourceInput[]) => void;
  onUpdateSource: (id: string, source: NewSourceInput) => Promise<void>;
  onRemoveSource: (id: string) => void;
})
```

其中 `NewSourceInput` 可在 `main.tsx` 中定义为：

```ts
type NewSourceInput = Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>;
```

已接入来源的每一行提供：

- 启用开关，直接调用 `onUpdateSource(id, { ...source, enabled })`。
- 编辑按钮，展开当前行编辑名称、URL、题材、包含词、排除词、语言和刷新频率。
- 保存按钮，成功后用服务端返回值替换当前来源。
- 删除按钮，继续调用现有删除接口。

App 中新增：

```ts
const updateSource = async (sourceId: string, source: NewSourceInput) => {
  if (!window.contentEngine && webAuth.session()) {
    const saved = await webIntelligence.updateSource(sourceId, source);
    updateState({
      ...state,
      sources: state.sources.map((item) => item.id === sourceId ? saved : item),
    });
    return;
  }
  updateState({
    ...state,
    sources: state.sources.map((item) => item.id === sourceId ? { ...item, ...source } : item),
  });
};
```

- [ ] **Step 6: 拆分工作空间和飞书 Base**

新增工作空间基础面板：

```tsx
function WorkspaceProfileSettings({
  workspace,
  onChange,
}: {
  workspace: WorkspaceProfile;
  onChange: (workspace: WorkspaceProfile) => void;
})
```

只展示并保存名称、题材和平台。删除“本地素材目录”用户文案，避免纯 Web 产品继续出现本地路径概念。

飞书页面只渲染：

```tsx
<FeishuTemplateEditor template={state.feishuTemplate} onChange={saveFeishuTemplate} />
```

- [ ] **Step 7: 添加账号授权空状态**

```tsx
function AccountAuthorizationSettings() {
  return (
    <section className="settings-empty-state">
      <h2>尚未绑定平台账号</h2>
      <p>公众号、视频号和小红书授权将在发布流程接入。</p>
    </section>
  );
}
```

只建立页面归属，不新增 OAuth 假功能或不可用按钮。

- [ ] **Step 8: 将 ModelSettingsScreen 作为设置子页面**

保留模型页面内部 `bailian`、`agent`、`search`、`external`、`policies`、`usage` 状态和 API 调用，不复制一份新的模型配置组件。

更新模型布局测试：

```js
test('模型设置作为 SettingsWorkspace 的 models 插槽渲染', () => {
  assert.match(mainSource, /models=\{<ModelSettingsScreen\s*\/?>\}/);
  assert.doesNotMatch(mainSource, /view === 'models'/);
});
```

- [ ] **Step 9: 运行设置相关测试**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs tests/model-settings-layout.test.mjs tests/intelligence-ui-contract.test.mjs
npm run typecheck
```

Expected: 全部通过。

- [ ] **Step 10: 提交**

```powershell
git add content-engine/src/workspaces/SettingsWorkspace.tsx content-engine/src/main.tsx content-engine/src/data/webApi.ts content-engine/server/index.cjs content-engine/server/services/intelligenceRepository.cjs content-engine/tests/web-information-architecture.test.mjs content-engine/tests/model-settings-layout.test.mjs content-engine/tests/intelligence-ui-contract.test.mjs
git commit -m "refactor settings workspace ownership"
```

---

### Task 5: 补齐跨页面跳转、保存反馈和配置缺失状态

**Files:**
- Modify: `content-engine/src/main.tsx:47-290`
- Modify: `content-engine/src/main.tsx:314-421`
- Modify: `content-engine/src/main.tsx:1045-1054`
- Modify: `content-engine/tests/web-information-architecture.test.mjs`

**Interfaces:**
- Consumes: `openDiscover`、`openSettings`、`DiscoverSection`、`SettingsSection`。
- Produces: `SettingsTarget`、稳定的搜索到设置跳转和来源缺失跳转。

- [ ] **Step 1: 写跨页面跳转失败测试**

```js
test('配置缺失通过设置局部目标跳转', () => {
  assert.match(mainSource, /openSettings\('models',\s*'search'\)/);
  assert.match(mainSource, /openSettings\('sources'\)/);
  assert.doesNotMatch(mainSource, /setView\('sources'\)/);
  assert.doesNotMatch(mainSource, /setView\('models'\)/);
});

test('搜索来源预设通过发现局部状态传递', () => {
  assert.match(mainSource, /openDiscover\('search',\s*preset\)/);
  assert.match(mainSource, /setSearchPreset/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs
```

Expected: FAIL，现有代码仍使用旧一级 View 跳转。

- [ ] **Step 3: 建立设置跳转目标**

```ts
const [requestedModelScreen, setRequestedModelScreen] =
  useState<ModelSettingsSection | null>(null);

const openSettings = (
  section: SettingsSection,
  modelScreen?: ModelSettingsSection,
) => {
  setView('settings');
  setSettingsSection(section);
  setRequestedModelScreen(section === 'models' ? modelScreen ?? null : null);
};
```

给 `ModelSettingsScreen` 增加可选参数：

```ts
function ModelSettingsScreen({ initialScreen }: { initialScreen?: ModelSettingsSection | null })
```

使用 `useEffect` 在 `initialScreen` 变化时设置内部 screen，但不重置用户正在编辑的连接表单。

- [ ] **Step 4: 修改来源缺失跳转**

`refreshRss` 中不再 `window.alert` 后切换旧一级 View，改为：

```ts
setRefreshFeedback({
  status: 'error',
  message: '尚未启用资讯来源，请先完成配置。',
});
openSettings('sources');
```

- [ ] **Step 5: 修改 Tavily 缺失跳转**

`WebSearchPanel` 接收：

```ts
onOpenSearchSettings: () => void;
```

按钮调用：

```tsx
<button className="button primary" onClick={onOpenSearchSettings}>
  前往设置
</button>
```

App 传入：

```tsx
onOpenSearchSettings={() => openSettings('models', 'search')}
```

- [ ] **Step 6: 补齐任务状态反馈**

- 网络搜索：加载时保留旧结果并显示骨架覆盖层。
- 搜索无结果：显示“没有找到符合当前条件的公开网页”。
- 加入热点池成功：按钮变为“已加入”，并使用 `aria-live` 反馈。
- 导入链接：空输入禁用、读取失败就地显示、保存成功不清空预读信息，直到用户继续导入。
- 来源配置：添加和删除成功后不使用浏览器 Alert，改为来源区就地反馈。

- [ ] **Step 7: 运行测试和构建**

Run:

```powershell
node --test tests/web-information-architecture.test.mjs tests/intelligence-ui-contract.test.mjs tests/model-settings-layout.test.mjs
npm run typecheck
npm run build
```

Expected: 全部通过。

- [ ] **Step 8: 提交**

```powershell
git add content-engine/src/main.tsx content-engine/tests/web-information-architecture.test.mjs
git commit -m "fix workspace navigation feedback"
```

---

### Task 6: 按 Taste 规范完成视觉、卡片和响应式重构

**Files:**
- Create: `content-engine/tests/web-responsive-contract.test.mjs`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/src/main.tsx:314-369`

**Interfaces:**
- Consumes: 新应用壳、发现工作区、设置工作区的 className。
- Produces: 统一响应式布局、热点三列卡片、设置二级导航和低动效状态反馈。

- [ ] **Step 1: 写响应式和视觉失败测试**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Web 页面不再锁死 1180 像素最小宽度', () => {
  assert.doesNotMatch(styles, /body\s*\{[^}]*min-width:\s*1180px/s);
});

test('热点卡片使用三二一列响应式网格', () => {
  assert.match(styles, /\.intelligence-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(styles, /@media \(max-width:\s*1199px\)[\s\S]*\.intelligence-grid\s*\{[^}]*repeat\(2,/);
  assert.match(styles, /@media \(max-width:\s*767px\)[\s\S]*\.intelligence-grid\s*\{[^}]*1fr/);
});

test('侧栏和设置导航具有窄屏回退', () => {
  assert.match(styles, /@media \(max-width:\s*959px\)[\s\S]*\.app-shell/);
  assert.match(styles, /@media \(max-width:\s*719px\)[\s\S]*\.sidebar/);
  assert.match(styles, /@media \(max-width:\s*959px\)[\s\S]*\.settings-subnav/);
});

test('普通面板不使用旧偏移硬阴影', () => {
  assert.doesNotMatch(styles, /\.panel\s*\{[^}]*box-shadow:\s*[468]px\s+[468]px/s);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test tests/web-responsive-contract.test.mjs
```

Expected: FAIL，现有 CSS 仍锁定 `min-width:1180px` 且缺少目标响应式结构。

- [ ] **Step 3: 重构全局布局**

核心 CSS：

```css
body { margin: 0; min-width: 320px; background: var(--paper); }

.app-shell {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  grid-template-rows: 62px minmax(0, 1fr);
}

.main-content {
  min-width: 0;
  width: 100%;
  max-width: 1600px;
  padding: 28px clamp(20px, 3vw, 44px) 48px;
}
```

- [ ] **Step 4: 重构侧栏高亮和控制形状**

```css
.nav-item {
  min-height: 42px;
  border-radius: var(--radius-control);
  transition: background-color 160ms ease, color 160ms ease, transform 120ms ease;
}

.nav-item.active {
  color: var(--ink);
  background: var(--surface-active);
  box-shadow: inset 3px 0 0 var(--accent);
}

.button:active,
.nav-item:active { transform: translateY(1px); }
```

不得为普通导航和面板保留红色偏移阴影。

- [ ] **Step 5: 重构热点卡片**

在 `Discover` 中将列表容器 class 改为 `intelligence-grid`，卡片结构固定为：来源色条、标题、摘要、标签区、时间和操作区。

```css
.intelligence-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: 14px;
}

.intelligence-card {
  display: grid;
  grid-template-rows: auto auto minmax(72px, 1fr) auto auto;
  min-width: 0;
  min-height: 270px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  background: var(--surface);
}
```

保留现有稳定哈希配色函数，禁止使用 `Math.random()`。

- [ ] **Step 6: 重构网络搜索和设置布局**

- 网络搜索表单在 1280 以上使用 `grid-template-columns: minmax(280px, 1fr) 160px 190px auto`。
- 1024 宽度时分为两行。
- 768 以下单列。
- 设置工作区在桌面使用 `220px + minmax(0,1fr)`。
- 960 以下二级导航变为横向滚动页签。
- 来源目录在宽屏三列、中屏两列、窄屏一列。

- [ ] **Step 7: 增加四档响应式规则**

```css
@media (max-width: 1199px) {
  .intelligence-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 959px) {
  .app-shell { grid-template-columns: 72px minmax(0, 1fr); }
  .nav-item span, .nav-group-label { display: none; }
  .settings-workspace { grid-template-columns: 1fr; }
  .settings-subnav { display: flex; overflow-x: auto; }
}

@media (max-width: 767px) {
  .intelligence-grid { grid-template-columns: 1fr; }
  .web-search-query { grid-template-columns: 1fr; }
}

@media (max-width: 719px) {
  .app-shell { display: block; }
  .sidebar { position: fixed; inset: 62px auto 0 0; transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
  .main-content { padding-inline: 16px; }
}
```

在 `App` 中增加明确的移动端菜单状态：

```ts
const [sidebarOpen, setSidebarOpen] = useState(false);
```

顶部栏增加 `aria-label="打开导航"` 的菜单按钮；点击导航项后调用 `setSidebarOpen(false)`。侧栏使用 `sidebarOpen ? 'sidebar open' : 'sidebar'`，并在打开时渲染可点击遮罩，遮罩点击后关闭导航。

- [ ] **Step 8: 加入 Reduced Motion**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

不新增 Anime.js 动画。现有模型配置动画保持原逻辑，但必须继续执行 `scope.revert()` 清理。

- [ ] **Step 9: 运行自动化测试、类型检查和构建**

Run:

```powershell
node --test tests/web-responsive-contract.test.mjs tests/web-information-architecture.test.mjs tests/intelligence-ui-contract.test.mjs tests/model-settings-layout.test.mjs
npm run typecheck
npm run build
```

Expected: 全部通过。

- [ ] **Step 10: 启动 Web 并进行浏览器验收**

Run:

```powershell
npm run dev
```

使用 Playwright 或浏览器检查：

1. 1280 宽度：侧栏展开，热点三列，设置左侧二级导航。
2. 1024 宽度：热点两列，无横向滚动。
3. 768 宽度：热点单列，设置页签横向滚动。
4. 390 宽度：表单单列，内容不被侧栏遮挡，按钮文字不换两行。
5. 刷新热点、搜索加载、导入空输入、配置缺失均有清晰状态。

Expected: `document.documentElement.scrollWidth === document.documentElement.clientWidth`。

- [ ] **Step 11: 提交**

```powershell
git add content-engine/src/styles.css content-engine/src/main.tsx content-engine/tests/web-responsive-contract.test.mjs
git commit -m "style responsive web workspace"
```

---

### Task 7: 更新产品文档并执行完整回归验收

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`
- Verify: `content-engine/tests/*.test.mjs`

**Interfaces:**
- Consumes: Task 1 至 Task 6 的最终导航、组件和测试结果。
- Produces: 与代码一致的产品文档、实施记录和验收日志。

- [ ] **Step 1: 更新 PRD 信息架构**

将旧导航段替换为：

```text
今天            今日任务和内容进度
发现            热点情报、网络搜索、导入链接
规划            选题池、立项和系列栏目
创作            核心 Agent、文案、图片、口播和平台版本
发布            内容日历、账号、待发布和发布记录
复盘            内容表现和复盘结论
素材库          云端素材、品牌素材和模板
设置            工作空间、资讯来源、模型与 API、飞书 Base、账号授权
```

明确“主动搜索和导入链接属于发现，自动来源管理属于设置”。

- [ ] **Step 2: 更新 PLAN**

记录：

- 已完成纯 Web 一级导航收敛。
- 已完成发现和设置局部工作区。
- 已移除辅助渠道独立页面。
- 下一验收关口仍是使用真实 Tavily Key 和公开链接跑通采集，再执行受控 AI 热点分析。

- [ ] **Step 3: 更新 IMPLEMENT**

记录实际文件和状态结构：

```text
View
DiscoverSection
SettingsSection
DiscoverWorkspace
SettingsWorkspace
WorkspaceTabs
PageHeader
```

历史执行说明：当时 Electron 兼容分支仍保留。该状态已被 2026-07-26 的 Web-only 架构决策取代，Electron 代码与依赖现已删除。

- [ ] **Step 4: 更新验收日志**

写入真实执行结果，不预填“通过”。必须包含：

- Node 测试数量和结果。
- TypeScript 类型检查结果。
- Vite 构建结果。
- 1280、1024、768、390 四档浏览器结果。
- 未通过项及原因。

- [ ] **Step 5: 运行完整自动化回归**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: 全部退出码为 0。

- [ ] **Step 6: 检查旧文案和旧一级 View 残留**

Run:

```powershell
rg -n "DESKTOP|V0\.1|桌面客户端|剪藏链接|辅助渠道|view === 'sources'|view === 'clip'|view === 'automation'|view === 'models'" src tests
```

Expected:

- `src` 中不存在用户可见旧文案和旧一级渲染分支。
- 测试文件中只允许出现“禁止旧文案”的负向断言。

- [ ] **Step 7: 检查工作区和差异**

Run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: 没有空白错误，修改范围只包含本计划列出的代码、测试和文档。

- [ ] **Step 8: 提交文档和最终验收结果**

```powershell
git add docs/01_PRD_内容引擎.md docs/02_PLAN_内容引擎.md docs/03_IMPLEMENT_内容引擎.md docs/04_ACCEPTANCE_LOG_内容引擎.md
git commit -m "docs web workspace acceptance"
```

- [ ] **Step 9: 推送主分支**

Run:

```powershell
git push origin main
```

Expected: 当前所有重构提交成功推送到 `emajjsky/zimeiti.git` 的 `main` 分支。

---

## Final Acceptance Checklist

- [ ] 侧栏只出现今天、发现、规划、创作、发布、复盘、素材库、设置。
- [ ] 发现内只有热点情报、网络搜索、导入链接三个局部页签。
- [ ] 设置内只有工作空间、资讯来源、模型与 API、飞书 Base、账号授权五个局部入口。
- [ ] 资讯来源页不包含辅助渠道卡片、搜索按钮或导入链接按钮。
- [ ] 网络搜索来源下拉包含全网、微博、今日头条、央视网、X、公众号、财经媒体和官方公告。
- [ ] Tavily 缺失时跳到设置中的检索 API。
- [ ] RSS 来源缺失时跳到设置中的资讯来源。
- [ ] 导入链接空输入时按钮禁用。
- [ ] 热点卡片已立项标签随选题创建和删除同步。
- [ ] 模型与 API 的保存、检测、编辑、删除、任务策略和调用记录仍可用。
- [ ] 用户可见界面没有 Desktop、V0.1、桌面客户端、GPU 和本地路径文案。
- [ ] 1280、1024、768、390 像素无横向溢出。
- [ ] Loading、Empty、Error、Success 状态完整。
- [ ] `npm test`、`npm run typecheck`、`npm run build` 全部通过。
- [ ] PRD、PLAN、IMPLEMENT 和验收日志与实际代码一致。
