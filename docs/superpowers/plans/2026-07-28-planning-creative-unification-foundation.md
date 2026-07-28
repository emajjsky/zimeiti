# Planning And Creative Unification Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除独立选题链路，把热点、手工想法和旧选题统一为内容项目，并交付可保存、可确认、可刷新恢复的“规划”第一步。

**Architecture:** `ContentProject` 成为规划到发布的唯一业务对象，`stage` 表示固定七步流程，旧 `ProjectStatus` 暂时作为发布侧兼容字段。服务端通过事务锁定 `workspace_snapshots` 创建和更新项目，规划的不可变确认版本单独写入 PostgreSQL；前端“创作”先进入项目中心，选择项目后再进入七步工作台。

**Tech Stack:** React 19、TypeScript、Vite、Fastify 5、PostgreSQL、Zod、Node Test Runner、Playwright、原生 CSS、Lucide React

## Global Constraints

- 产品形态保持纯 Web，不恢复 Electron、桌面进程或本地客户端入口。
- 直接在 `main` 实施，不创建分支或 worktree；每个任务通过后单独提交。
- 严格 TDD：新增行为先写失败测试，确认失败原因正确后再写最小实现。
- 自动测试不得调用百炼、Tavily、生图、视频或其它付费接口。
- `ContentProject` 是唯一持续业务对象；`TopicCandidate` 只允许出现在旧状态迁移输入中。
- 固定阶段为 `PLANNING`、`RESEARCH`、`MASTER_WRITING`、`PLATFORM_ADAPTATION`、`VISUAL`、`LAYOUT`、`REVIEW`、`COMPLETED`。
- 固定来源为 `HOTSPOT`、`MANUAL`、`DRAFT`、`IMPORT`、`LEGACY`。
- “应用修改”和“完成阶段”继续保持不同动作；本计划只实现规划正式版本，不扩展后续 Agent 执行器。
- 旧 `view=plan`、`view=topicEditor` 和 `topic` URL 必须兼容跳转，不能刷新后进入空白页。
- 不在页面添加大段教程、示例墙、假按钮、假数据或未实现功能入口。
- 前端视觉按 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`，波普怀旧清新配色，统一 12-16px 圆角，动画只承担状态反馈。
- 复杂工作台使用现有产品组件体系；`design-taste-frontend` 只约束视觉一致性、可访问性、反馈、响应式和反模板化细节。

## File Structure

- `content-engine/server/services/project-planning.cjs`：项目规范化、旧状态迁移、热点转项目、规划校验和阶段推进纯函数。
- `content-engine/server/migrations/018_planning_creative_unification.sql`：规划不可变版本和旧选题映射表。
- `content-engine/server/index.cjs`：项目列表、创建、热点加入、规划读取、保存和确认 API。
- `content-engine/src/domain/content.ts`：统一项目来源、阶段、规划工作稿和规划版本类型。
- `content-engine/src/data/localRepository.ts`：加载时幂等迁移旧 `topics`，正式状态不再保存选题数组。
- `content-engine/src/data/webApi.ts`：统一项目和规划 API 客户端。
- `content-engine/src/workspaces/create/CreativeProjectCenter.tsx`：创作项目中心和空白项目创建入口。
- `content-engine/src/workspaces/create/PlanningWorkspace.tsx`：规划字段编辑、保存状态和确认推进。
- `content-engine/src/workspaces/create/CreateWorkspace.tsx`：七步项目工作台编排。
- `content-engine/src/workspaces/discover/IntelligenceInbox.tsx`：热点“加入创作”和已加入状态。
- `content-engine/src/app/navigation.mjs`：移除独立规划与选题编辑路由，增加 `stage` URL。
- `content-engine/src/main.tsx`：删除旧 Topic 状态机，统一项目选择与创建。
- `content-engine/tests/planning-creative-foundation.test.mjs`：迁移、项目创建、规划确认和阶段映射测试。
- `content-engine/tests/web-navigation.test.mjs`：七项一级导航和旧 URL 兼容测试。
- `content-engine/tests/creative-workspace.e2e.py`：热点加入、空白创建、规划保存、确认和刷新恢复验收。

---

### Task 1: 统一项目领域契约与旧状态迁移

**Files:**
- Create: `content-engine/server/services/project-planning.cjs`
- Create: `content-engine/server/migrations/018_planning_creative_unification.sql`
- Create: `content-engine/tests/planning-creative-foundation.test.mjs`
- Modify: `content-engine/src/domain/content.ts`
- Modify: `content-engine/src/data/localRepository.ts`
- Modify: `content-engine/server/index.cjs`

**Interfaces:**
- Consumes: 旧 `TopicCandidate[]`、旧 `ContentProject[]`、热点 `IntelligenceItem`。
- Produces: `migrateLegacyCreativeState(state, now?)`、`createBlankProject(input, now?)`、`createProjectFromIntelligence(item, analysis, angleIndex, now?)`、`planningDraftForProject(project)`、`confirmProjectPlanning(project, planning, now?)`。

- [ ] **Step 1: 写旧状态迁移失败测试**

```js
test('旧选题被幂等迁移为规划阶段项目且不再保留 topics', () => {
  const legacy = {
    workspace: { enabledPlatforms: ['WECHAT'] },
    topics: [{
      id: 'topic-1', title: '普通人怎么用 AI 做图', category: 'AI',
      platforms: ['WECHAT'], urgency: '高', status: 'PENDING',
      coreViewpoint: '先解决真实问题', targetAudience: '新手',
      factsToVerify: ['核对价格'], sourceIds: ['intel-1'],
    }],
    projects: [],
  };
  const first = migrateLegacyCreativeState(legacy, '2026-07-28T08:00:00.000Z');
  const second = migrateLegacyCreativeState(first, '2026-07-28T09:00:00.000Z');
  assert.equal('topics' in first, false);
  assert.equal(first.projects.length, 1);
  assert.equal(first.projects[0].stage, 'PLANNING');
  assert.equal(first.projects[0].originType, 'HOTSPOT');
  assert.equal(first.projects[0].legacyTopicId, 'topic-1');
  assert.deepEqual(second, first);
});
```

- [ ] **Step 2: 运行测试并确认服务模块不存在**

Run: `node --test tests/planning-creative-foundation.test.mjs`

Expected: FAIL，错误包含 `project-planning.cjs` 不存在。

- [ ] **Step 3: 定义统一领域类型**

```ts
export type ProjectOriginType = 'HOTSPOT' | 'MANUAL' | 'DRAFT' | 'IMPORT' | 'LEGACY';
export type ProjectStage =
  | 'PLANNING'
  | 'RESEARCH'
  | 'MASTER_WRITING'
  | 'PLATFORM_ADAPTATION'
  | 'VISUAL'
  | 'LAYOUT'
  | 'REVIEW'
  | 'COMPLETED';

export interface ProjectPlanning {
  title: string;
  category: string;
  angle: string;
  objective: string;
  targetAudience: string;
  coreMessage: string;
  targetPlatforms: Platform[];
  timing: 'TODAY' | 'THREE_DAYS' | 'ONE_WEEK' | 'EVERGREEN';
  plannedPublishAt?: string;
  sourceRequirements: string;
  constraints: string;
}

export interface ContentProject {
  id: string;
  title: string;
  originType: ProjectOriginType;
  originReferenceId?: string;
  legacyTopicId?: string;
  stage: ProjectStage;
  status: ProjectStatus;
  planning: ProjectPlanning;
  planningVersion: number;
  planningConfirmedAt?: string;
  coreViewpoint: string;
  factChecks: string[];
  versions: ContentVersion[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: 实现幂等迁移和创建纯函数**

`migrateLegacyCreativeState()` 必须先规范已有项目，再迁移尚未映射的旧选题；已有项目按标题或 `legacyTopicId` 匹配后只补字段，不重复创建。旧项目状态映射固定为：`BRIEF -> PLANNING`、`WRITING -> MASTER_WRITING`、`VISUAL/VIDEO -> VISUAL`、`REVIEW/SCHEDULED -> REVIEW`、`PARTIALLY_PUBLISHED/PUBLISHED/RETROSPECTIVE/ARCHIVED -> COMPLETED`。

热点项目读取分析角度、受众、待核验项、推荐平台和时效；没有分析时使用资讯标题、摘要、分类和工作空间默认平台。项目版本只为目标平台创建，不把核心观点伪装成已完成正文。

- [ ] **Step 5: 增加规划版本与旧映射迁移**

```sql
CREATE TABLE project_planning_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED')),
  planning_json jsonb NOT NULL,
  source_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (workspace_id, project_id, version_number)
);

CREATE TABLE legacy_topic_project_mappings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_topic_id text NOT NULL,
  project_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, legacy_topic_id),
  UNIQUE (workspace_id, project_id)
);
```

- [ ] **Step 6: 将默认服务端状态改为无选题、无示例项目**

`defaultState()` 只返回真实空数组 `sources`、`intelligence`、`projects`，不再写 `topics`。`loadState()` 和前端 `normalizeState()` 都执行相同幂等迁移，保证旧用户首次刷新自动转换。

- [ ] **Step 7: 运行领域测试和类型检查**

Run: `node --test tests/planning-creative-foundation.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: 可能因旧 UI 仍引用 Topic 而失败；失败只能来自下一任务明确要删除的旧调用点，不允许出现新服务类型错误。

- [ ] **Step 8: 提交领域基础**

```powershell
git add content-engine/server/services/project-planning.cjs content-engine/server/migrations/018_planning_creative_unification.sql content-engine/tests/planning-creative-foundation.test.mjs content-engine/src/domain/content.ts content-engine/src/data/localRepository.ts content-engine/server/index.cjs
git commit -m "feat: unify planning project domain"
```

### Task 2: 项目与规划服务端 API

**Files:**
- Modify: `content-engine/server/services/project-planning.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/tests/planning-creative-foundation.test.mjs`

**Interfaces:**
- Consumes: Task 1 的迁移和项目纯函数。
- Produces: `GET /creative/projects`、`POST /creative/projects`、`POST /creative/projects/from-intelligence/:itemId`、`GET/PUT /creative/projects/:projectId/planning`、`POST /creative/projects/:projectId/planning/complete`。

- [ ] **Step 1: 写事务仓储失败测试**

```js
test('项目仓储在事务锁内迁移并写回 snapshot', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT state_json/.test(sql)) return { rows: [{ state_json: { topics: [], projects: [] } }] };
      return { rows: [] };
    },
  };
  await updateCreativeState(client, 'workspace-1', (state) => ({ ...state, projects: [] }));
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls.at(-1).sql, /UPDATE workspace_snapshots/);
});
```

- [ ] **Step 2: 运行测试并确认 `updateCreativeState` 缺失**

Run: `node --test tests/planning-creative-foundation.test.mjs`

Expected: FAIL，错误指向导出不存在。

- [ ] **Step 3: 实现事务状态更新器**

```js
async function updateCreativeState(client, workspaceId, mutate, now = new Date().toISOString()) {
  const result = await client.query(
    'SELECT state_json FROM workspace_snapshots WHERE workspace_id = $1 FOR UPDATE',
    [workspaceId],
  );
  const migrated = migrateLegacyCreativeState(result.rows[0]?.state_json ?? {}, now);
  const next = await mutate(migrated);
  await client.query(
    'UPDATE workspace_snapshots SET state_json = $2, revision = revision + 1, updated_at = now() WHERE workspace_id = $1',
    [workspaceId, JSON.stringify(next)],
  );
  return next;
}
```

- [ ] **Step 4: 实现项目 API**

空白创建请求只接受 `originType`、`title`、`category`、`draftText`、`importUrl` 和 `targetPlatforms`；服务端生成 ID 与时间。热点创建先按 `originReferenceId` 幂等查找，已存在时返回 `{ project, created: false }`，不存在时冻结资讯与分析快照并返回 201。

- [ ] **Step 5: 实现规划 API 和版本写入**

`PUT planning` 只更新工作稿并写 `DRAFT` 版本；同一内容重复保存不得增加版本。`POST planning/complete` 校验标题、角度、目标、受众、核心表达和至少一个平台，写 `CONFIRMED` 版本，更新 `stage=RESEARCH`、`planningConfirmedAt`、`title`、`coreViewpoint`、`factChecks` 和平台版本占位。

- [ ] **Step 6: 增加前端强类型客户端**

```ts
export const webProjects = {
  list: () => request<{ projects: ContentProject[] }>('/creative/projects'),
  create: (input: CreateProjectInput) => request<{ project: ContentProject; created: boolean }>('/creative/projects', { method: 'POST', body: JSON.stringify(input) }),
  fromIntelligence: (itemId: string, input: { angleIndex?: number }) => request<{ project: ContentProject; created: boolean }>(`/creative/projects/from-intelligence/${encodeURIComponent(itemId)}`, { method: 'POST', body: JSON.stringify(input) }),
  planning: (projectId: string) => request<{ project: ContentProject; planning: ProjectPlanning }>(`/creative/projects/${encodeURIComponent(projectId)}/planning`),
  savePlanning: (projectId: string, planning: ProjectPlanning) => request<{ project: ContentProject; planning: ProjectPlanning }>(`/creative/projects/${encodeURIComponent(projectId)}/planning`, { method: 'PUT', body: JSON.stringify(planning) }),
  completePlanning: (projectId: string) => request<{ project: ContentProject }>(`/creative/projects/${encodeURIComponent(projectId)}/planning/complete`, { method: 'POST', body: '{}' }),
};
```

- [ ] **Step 7: 运行服务端测试和语法检查**

Run: `node --test tests/planning-creative-foundation.test.mjs`

Expected: PASS。

Run: `node --check server/index.cjs; node --check server/services/project-planning.cjs`

Expected: 全部 exit 0。

- [ ] **Step 8: 提交 API**

```powershell
git add content-engine/server content-engine/src/data/webApi.ts content-engine/tests/planning-creative-foundation.test.mjs
git commit -m "feat: add planning project api"
```

### Task 3: 创作项目中心与导航收口

**Files:**
- Create: `content-engine/src/workspaces/create/CreativeProjectCenter.tsx`
- Modify: `content-engine/src/app/navigation.mjs`
- Modify: `content-engine/src/app/navigation.d.mts`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/web-navigation.test.mjs`

**Interfaces:**
- Consumes: `ContentProject[]`、`ProjectStage`、`webProjects.create()`。
- Produces: `<CreativeProjectCenter projects onOpenProject onCreateProject />` 和 `stage` URL 状态。

- [ ] **Step 1: 写导航行为失败测试**

```js
test('一级导航移除规划并把旧规划 URL 映射到创作', () => {
  assert.equal(navigationGroups.flatMap((group) => group.items).some((item) => item.view === 'plan'), false);
  const route = readWorkspaceLocation({ search: '?view=plan&topic=topic-1' });
  assert.equal(route.view, 'create');
  assert.equal(route.legacyTopicId, 'topic-1');
});

test('创作 URL 保存项目和阶段', () => {
  const url = workspaceLocationUrl({
    view: 'create', projectId: 'project-1', stage: 'research',
    discoverSection: 'inbox', settingsSection: 'workspace', modelSection: null,
    intelligenceId: null, legacyTopicId: null, platform: 'WECHAT',
  }, { href: 'http://localhost/' });
  assert.equal(url, '/?view=create&project=project-1&stage=research&platform=WECHAT');
});
```

- [ ] **Step 2: 运行测试并确认旧导航仍存在**

Run: `node --test tests/web-navigation.test.mjs`

Expected: FAIL，显示 `plan` 仍在导航或路由仍返回 `plan`。

- [ ] **Step 3: 收口导航类型与 URL**

`View` 删除 `plan`、`topicEditor`；增加 `CreateStageRoute = 'planning' | 'research' | 'master' | 'platform' | 'visual' | 'layout' | 'review'`。读取旧 URL 时把 `view=plan`、`view=topicEditor` 转成 `view=create` 并保留 `legacyTopicId`；新 URL 不再写 `topic`。

- [ ] **Step 4: 实现项目中心**

项目中心顶部只有标题、“新建创作”和阶段筛选。项目卡显示项目标题、来源、阶段、目标平台、更新时间和单一下一步按钮；没有项目时只显示“新建第一篇内容”。筛选为待规划、研究中、正文中、平台制作中、待审核、已完成。

- [ ] **Step 5: 删除 `main.tsx` 旧选题状态机**

删除 `selectedTopicId`、`editingTopicId`、`createTopicFromIntel()`、`openTopicEditor()`、`saveTopic()`、`deleteTopic()`、`createProjectFromTopic()`、`TopicEditor`、`Plan` 和顶部“新建选题”。顶部按钮改为“新建创作”，进入无项目的创作中心并展开创建面板。

- [ ] **Step 6: 运行导航和类型检查**

Run: `node --test tests/web-navigation.test.mjs tests/today-workspace.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: 只允许发现页仍等待下一任务接入的属性错误；导航、项目中心和 `main.tsx` 不得有错误。

- [ ] **Step 7: 提交项目中心**

```powershell
git add content-engine/src content-engine/tests/web-navigation.test.mjs content-engine/tests/today-workspace.test.mjs
git commit -m "feat: add creative project center"
```

### Task 4: 规划第一步与七步工作台

**Files:**
- Create: `content-engine/src/workspaces/create/PlanningWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/planning-creative-foundation.test.mjs`

**Interfaces:**
- Consumes: `ContentProject.planning`、`webProjects.savePlanning()`、`webProjects.completePlanning()`。
- Produces: 七步单一导航和可保存、可确认的规划工作稿。

- [ ] **Step 1: 写规划校验与阶段推进失败测试**

```js
test('确认规划需要完整核心字段并推进研究阶段', () => {
  const project = createBlankProject({ originType: 'MANUAL', title: 'AI 写作是否会让人变懒', targetPlatforms: ['WECHAT'] }, '2026-07-28T08:00:00.000Z');
  assert.throws(() => confirmProjectPlanning(project, project.planning, '2026-07-28T08:05:00.000Z'), /创作角度/);
  const confirmed = confirmProjectPlanning(project, {
    ...project.planning,
    angle: '从认知外包边界切入', objective: '帮助普通人建立使用边界',
    targetAudience: '使用 AI 写作的普通创作者', coreMessage: 'AI 应该辅助判断而不是替代判断',
  }, '2026-07-28T08:05:00.000Z');
  assert.equal(confirmed.stage, 'RESEARCH');
  assert.equal(confirmed.planningVersion, 1);
});
```

- [ ] **Step 2: 运行测试并确认校验或推进尚未完成**

Run: `node --test tests/planning-creative-foundation.test.mjs`

Expected: FAIL，错误来自缺失的规划确认行为。

- [ ] **Step 3: 实现规划工作台**

字段按用户决策顺序排列：选题标题、题材、创作角度、创作目标、目标受众、核心表达、目标平台、时效、计划发布时间、来源与核验要求、禁止表达与必须保留内容。目标篇幅不放在规划阶段，留到正文或平台版本阶段。

保存使用明确按钮和状态文字；确认按钮为“确认规划，开始研究”。保存失败显示表单内错误，不用全局 alert；确认成功更新父级项目并切到研究阶段。

- [ ] **Step 4: 重构 CreateWorkspace 七步导航**

固定标签为“规划、研究、正文、平台版本、配图、排版、审核”。只显示一条导航；已完成阶段可返回，未解锁阶段禁用。现有 `ProjectMaterials` 映射到研究，现有 `CopyWorkspace` 暂时映射到正文；平台版本、配图、排版、审核未实现时只显示真实阶段空状态，不显示可点击假功能。

- [ ] **Step 5: 完成响应式和状态样式**

桌面工作台最大宽度 1400px，规划表单两列且长文本跨两列；小于 900px 单列；390px 无横向滚动。按钮、输入、焦点和错误文本满足对比度；只使用 CSS hover/active 状态，不增加 Anime.js 动画。

- [ ] **Step 6: 运行规划、类型和构建测试**

Run: `node --test tests/planning-creative-foundation.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: exit 0。

Run: `npm run build`

Expected: exit 0。

- [ ] **Step 7: 提交规划工作台**

```powershell
git add content-engine/src/workspaces/create content-engine/src/styles.css content-engine/tests/planning-creative-foundation.test.mjs
git commit -m "feat: add planning workspace"
```

### Task 5: 发现、今天与复盘接入统一项目

**Files:**
- Modify: `content-engine/src/workspaces/discover/IntelligenceInbox.tsx`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/domain/today.mjs`
- Modify: `content-engine/tests/intelligence-presentation.test.mjs`
- Modify: `content-engine/tests/today-workspace.test.mjs`

**Interfaces:**
- Consumes: `webProjects.fromIntelligence()` 和 `ContentProject.originReferenceId`。
- Produces: “加入创作”、已加入标签、今日项目任务和复盘项目跳转。

- [ ] **Step 1: 写热点幂等加入失败测试**

```js
test('热点已加入状态只由项目来源引用决定', () => {
  const projects = [{ id: 'project-1', originType: 'HOTSPOT', originReferenceId: 'intel-1' }];
  assert.equal(projectForIntelligence(projects, 'intel-1')?.id, 'project-1');
  assert.equal(projectForIntelligence(projects, 'intel-2'), undefined);
});
```

- [ ] **Step 2: 运行测试并确认 helper 缺失**

Run: `node --test tests/intelligence-presentation.test.mjs tests/today-workspace.test.mjs`

Expected: FAIL，错误指向 `projectForIntelligence` 或旧 Topic 行为。

- [ ] **Step 3: 修改热点行动语义**

`IntelligenceInbox` 移除 `topics`、`onCreateTopic`、`onOpenTopic`，改为 `onAddToCreative(itemId, analysis?, angleIndex?)`、`onOpenProject(projectId)`。未加入显示“加入创作”，已加入显示右上角“已加入”并提供“继续创作”。

- [ ] **Step 4: 修改 Today 和 Review**

今日任务只从项目 `stage` 派生：待规划、继续研究、继续正文、制作平台版本、处理配图、继续排版、完成审核。复盘页不再链接旧选题；没有已发布项目时显示真实空状态。

- [ ] **Step 5: 运行发现、今天和类型测试**

Run: `node --test tests/intelligence-presentation.test.mjs tests/today-workspace.test.mjs tests/web-navigation.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 6: 提交入口闭环**

```powershell
git add content-engine/src content-engine/tests
git commit -m "feat: connect intelligence to creative projects"
```

### Task 6: 浏览器验收、文档、迁移、提交和推送

**Files:**
- Modify: `content-engine/tests/creative-workspace.e2e.py`
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Consumes: Tasks 1-5 的完整纵向链路。
- Produces: A30 验收记录、可复现测试证据、迁移和远端 `main`。

- [ ] **Step 1: 增加浏览器 E2E**

使用 Playwright 路由 Mock 工作空间和新项目 API，覆盖：创作项目中心空状态、空白创建、热点加入创作、已加入标签、规划编辑、保存状态、确认进入研究、浏览器刷新恢复项目和阶段、旧 `view=plan&topic=` 兼容跳转、1024px 和 390px 无横向溢出。不得确认任何模型运行。

- [ ] **Step 2: 运行完整自动化**

Run: `npm test`

Expected: 0 failed。

Run: `npm run typecheck`

Expected: exit 0。

Run: `npm run build`

Expected: exit 0。

Run: `python tests/creative-workspace.e2e.py`

Expected: exit 0，且所有网络调用均为本地 Mock。

- [ ] **Step 3: 应用迁移并验证幂等**

Run: `npm run db:migrate`

Expected: exit 0；再次运行仍 exit 0，不重复创建表或版本记录。

- [ ] **Step 4: 同步四份产品文档**

PRD 写明规划已成为创作第一步；PLAN 将下一切片改为“研究阶段 Agent 基于零资料也可启动”；IMPLEMENT 记录状态迁移、API、组件、URL 兼容和旧 Topic 删除策略；ACCEPTANCE 新增 A30，记录测试命令、结果、未调用付费 API 和用户手工验收步骤。

- [ ] **Step 5: 最终检查和提交**

Run: `git diff --check`

Expected: 无输出，exit 0。

```powershell
git add content-engine docs
git commit -m "feat: unify planning and creative workflow"
```

- [ ] **Step 6: 推送并核对**

```powershell
git push origin main
git status --branch --short
```

Expected: push 显示 `main -> main`，status 只显示 `## main...origin/main`。
