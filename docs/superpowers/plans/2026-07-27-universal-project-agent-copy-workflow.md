# Universal Project Agent And Four-Platform Copy Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将研究专用对话与旧文案 Agent 统一为项目级通用 Agent，并跑通公众号、小红书、知乎、微博的受控文案候选、差异审核、采用和刷新恢复。

**Architecture:** PostgreSQL 保存项目消息、阶段摘要、通用产物索引、内容母版和平台文案版本；Fastify 的 Project Agent API 将自由输入确定性映射到已注册动作，prepare 只冻结上下文，confirm 后由 BullMQ Worker 调用百炼或外部文本模型。React 使用一个 `ProjectAgent` 组件贯穿研究与文案阶段，正式正文仍兼容写回 `workspace_snapshots`，但模型结果必须先进入候选产物。

**Tech Stack:** React 19、TypeScript、Vite、Fastify、PostgreSQL、Redis/BullMQ、Zod、Node Test Runner、Playwright、Lucide React

## Global Constraints

- 运行形态保持纯 Web，不引入 Electron、桌面端进程或浏览器本地 Key。
- 直接在 `main` 实施，不创建分支或 worktree；每个任务通过后单独提交。
- 自动测试不得调用百炼、Tavily 或其它付费接口，Worker 输出统一使用 Mock 或纯函数测试。
- 一个项目共用一个 Agent 和完整时间线；默认读取当前阶段与前序摘要，完整历史按需请求。
- 聊天消息、任务运行和正式产物分离；只有已保存或已采用的真实资产推进项目进度。
- prepare 阶段不调用模型；confirm 后才入队；Worker 结果先写候选，accept 后才更新正式文案。
- 文案首批平台为 `WECHAT`、`XIAOHONGSHU`、`ZHIHU`、`WEIBO`；`VIDEO_CHANNEL` 继续留在独立视频流程。
- 公众号与知乎只复用长内容基础规则，小红书与微博只复用短内容基础规则，平台提示词和正式版本必须隔离。
- 内容母版是底层共享资产，不增加强制页面；单平台可直接创建候选，多平台派生不得静默覆盖人工版本。
- 未核验事实可以进入候选，但必须保留 `factsToVerify`，在后续审核和导出阶段阻断。
- 配图、排版、审核执行器不属于本计划，不显示未实现按钮。
- 登录、验证码、付费墙、挑战页和权限不明来源保持 `HUMAN_INPUT_REQUIRED` 边界，不增加绕过逻辑。
- 前端实施时使用 `design-taste-frontend`，参数保持 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`，不添加展示性动画或冗余说明。

## File Structure

- `content-engine/server/migrations/015_universal_project_agent.sql`：通用消息字段、阶段摘要、产物、母版、平台策略和平台文案表。
- `content-engine/server/migrations/016_four_platform_creative_contracts.sql`：知乎/微博 Skill、旧候选表四平台约束和平台默认数据。
- `content-engine/server/migrations/017_project_copy_actions.sql`：八个受控文案动作及其不可变版本。
- `content-engine/server/services/project-agent.cjs`：Agent 阶段、消息、摘要、产物 DTO 和工作空间/项目隔离仓储。
- `content-engine/server/services/project-copy-action.cjs`：文案动作解析、平台规则、提示词、严格输出 Schema 和候选 DTO。
- `content-engine/server/index.cjs`：Project Agent 上下文、prepare/confirm/cancel/accept、启用平台和兼容旧动作 API。
- `content-engine/server/worker.cjs`：`PROJECT_COPY_ACTION` 执行、一次结构修复、产物/消息/用量事务。
- `content-engine/src/domain/content.ts`：四个图文平台与视频号的共享平台类型和展示名。
- `content-engine/src/domain/creative.ts`：Project Agent、动作、产物、平台策略和平台文案类型。
- `content-engine/src/data/webApi.ts`：Project Agent 和平台版本 API 客户端。
- `content-engine/src/workspaces/create/ProjectAgent.tsx`：研究与文案阶段共用的时间线、确认卡、运行状态、候选和输入框。
- `content-engine/src/workspaces/create/CopyWorkspace.tsx`：四平台策略、编辑器、候选差异和版本采用。
- `content-engine/src/workspaces/create/CopyCandidateDialog.tsx`：大纲/全文候选审核与差异视图。
- `content-engine/src/workspaces/create/ProjectMaterials.tsx`：保留资料选择，将研究侧栏替换为通用 Agent。
- `content-engine/src/workspaces/create/CreateWorkspace.tsx`：只负责阶段、项目资产和子工作区编排，移出旧 Agent 状态机。
- `content-engine/src/workspaces/settings/PromptTemplateSettings.tsx`：四平台大纲、初稿、修订模板选择。
- `content-engine/tests/project-agent-foundation.test.mjs`：迁移、仓储、上下文与项目隔离。
- `content-engine/tests/project-copy-action.test.mjs`：动作解析、平台模板、Schema、prepare/confirm/accept 契约。
- `content-engine/tests/creative-platforms.test.mjs`：四平台目录、Skill、Prompt Scope 和项目版本创建。
- `content-engine/tests/creative-workspace.e2e.py`：通用时间线、四平台候选、采用和刷新恢复浏览器验收。

---

### Task 1: 通用 Agent 与产物数据基础

**Files:**
- Create: `content-engine/server/migrations/015_universal_project_agent.sql`
- Create: `content-engine/tests/project-agent-foundation.test.mjs`
- Modify: `content-engine/server/services/project-research.cjs`

**Interfaces:**
- Consumes: 迁移 014 的 `project_agent_messages`、`project_research_plans` 和现有 `generation_runs`。
- Produces: `project_agent_messages.action_run_id`、`project_stage_summaries`、`project_artifacts`、`content_master_versions`、`platform_strategies`、`platform_content_versions`。

- [ ] **Step 1: 写迁移失败测试**

```js
test('015 建立通用 Agent、阶段摘要和四平台产物', () => {
  const sql = fs.readFileSync(new URL('../server/migrations/015_universal_project_agent.sql', import.meta.url), 'utf8');
  assert.match(sql, /RENAME COLUMN generation_run_id TO action_run_id/);
  assert.match(sql, /stage text NOT NULL DEFAULT 'RESEARCH'/);
  assert.match(sql, /CREATE TABLE project_stage_summaries/);
  assert.match(sql, /CREATE TABLE project_artifacts/);
  assert.match(sql, /CREATE TABLE content_master_versions/);
  assert.match(sql, /CREATE TABLE platform_strategies/);
  assert.match(sql, /CREATE TABLE platform_content_versions/);
  assert.match(sql, /'WECHAT'.*'XIAOHONGSHU'.*'ZHIHU'.*'WEIBO'/s);
});
```

- [ ] **Step 2: 运行测试并确认因迁移不存在而失败**

Run: `node --test tests/project-agent-foundation.test.mjs`

Expected: FAIL，错误包含 `ENOENT` 和 `015_universal_project_agent.sql`。

- [ ] **Step 3: 编写迁移**

迁移必须包含以下核心结构，并为所有项目表建立 `(workspace_id, project_id)` 索引：

```sql
ALTER TABLE project_agent_messages
  RENAME COLUMN generation_run_id TO action_run_id;

ALTER TABLE project_agent_messages
  ADD COLUMN stage text NOT NULL DEFAULT 'RESEARCH'
    CHECK (stage IN ('RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW')),
  ADD COLUMN message_type text NOT NULL DEFAULT 'MESSAGE'
    CHECK (message_type IN ('MESSAGE', 'CONFIRMATION', 'RUN_STATUS', 'ARTIFACT', 'SYSTEM_EVENT')),
  ADD COLUMN artifact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE project_stage_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW')),
  platform text CHECK (platform IS NULL OR platform IN ('WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  through_message_id uuid REFERENCES project_agent_messages(id) ON DELETE SET NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, stage, platform, version)
);
```

`project_artifacts` 使用 `artifact_type IN ('RESEARCH_PLAN','OUTLINE','CONTENT_MASTER','PLATFORM_COPY')` 和 `status IN ('CANDIDATE','ACCEPTED','REJECTED')`；三张具体产物表通过 `artifact_id` 唯一引用通用索引。`platform_content_versions` 保存 `title`、`body`、`facts_to_verify_json`、`change_summary`、`parent_version_id` 和递增 `version_number`。

- [ ] **Step 4: 更新研究 DTO 的运行字段名**

将 `researchRunView` 及相关查询从 `generation_run_id` 改为 `action_run_id`，API 仍向前端返回 `runId`，避免暴露数据库重命名：

```js
messages: rows.map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  runId: row.action_run_id ?? null,
  stage: row.stage,
  messageType: row.message_type,
  artifactRefs: row.artifact_refs_json ?? [],
  createdAt: row.created_at,
}))
```

- [ ] **Step 5: 应用迁移并运行测试**

Run: `npm run db:migrate`

Expected: exit 0，迁移表记录包含 `015_universal_project_agent.sql`。

Run: `node --test tests/project-agent-foundation.test.mjs tests/project-research-agent.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交数据基础**

```powershell
git add content-engine/server/migrations/015_universal_project_agent.sql content-engine/server/services/project-research.cjs content-engine/tests/project-agent-foundation.test.mjs
git commit -m "feat: add universal project agent schema"
```

### Task 2: 四平台契约、Skill 与可见提示词

**Files:**
- Create: `content-engine/tests/creative-platforms.test.mjs`
- Create: `content-engine/server/migrations/016_four_platform_creative_contracts.sql`
- Modify: `content-engine/src/domain/content.ts`
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/data/localRepository.ts`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/services/intelligence-analysis.cjs`
- Modify: `content-engine/server/services/creativeSkills.cjs`
- Modify: `content-engine/server/services/creative-outline.cjs`
- Modify: `content-engine/server/services/creative-draft.cjs`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/settings/PromptTemplateSettings.tsx`

**Interfaces:**
- Consumes: `Platform`、Creative Skill 目录、Prompt Template Store。
- Produces: `CreativePlatform = 'WECHAT' | 'XIAOHONGSHU' | 'ZHIHU' | 'WEIBO'`，四平台大纲/初稿 Scope 和渠道 Skill。

- [ ] **Step 1: 写四平台失败测试**

```js
test('图文平台目录包含公众号、小红书、知乎和微博', () => {
  const content = fs.readFileSync(new URL('../src/domain/content.ts', import.meta.url), 'utf8');
  assert.match(content, /'WECHAT'.*'XIAOHONGSHU'.*'ZHIHU'.*'WEIBO'.*'VIDEO_CHANNEL'/s);
  assert.match(content, /ZHIHU: '知乎'/);
  assert.match(content, /WEIBO: '微博'/);
});

test('四平台拥有独立大纲和初稿提示词 Scope', () => {
  for (const platform of ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']) {
    assert.equal(outlineTemplateScope(platform), `CREATIVE_OUTLINE_${platform}`);
    assert.equal(draftTemplateScope(platform), `CREATIVE_DRAFT_${platform}`);
  }
  assert.match(defaultDraftTemplate('ZHIHU'), /问题语境|论证/);
  assert.match(defaultDraftTemplate('WEIBO'), /单条|串文|时效/);
});

test('016 增加知乎微博 Skill 并扩展旧候选平台约束', () => {
  const sql = fs.readFileSync(new URL('../server/migrations/016_four_platform_creative_contracts.sql', import.meta.url), 'utf8');
  assert.match(sql, /creative-channel-zhihu/);
  assert.match(sql, /creative-channel-weibo/);
  assert.match(sql, /creative_outline_candidates_platform_check/);
  assert.match(sql, /creative_draft_candidates_platform_check/);
});
```

- [ ] **Step 2: 运行测试并确认平台与 Scope 缺失**

Run: `node --test tests/creative-platforms.test.mjs`

Expected: FAIL，至少包含 `ZHIHU` 或 `CREATIVE_OUTLINE_ZHIHU` 缺失。

- [ ] **Step 3: 扩展平台类型和服务端枚举**

```ts
export type Platform = 'WECHAT' | 'XIAOHONGSHU' | 'ZHIHU' | 'WEIBO' | 'VIDEO_CHANNEL';
export type CreativePlatform = Exclude<Platform, 'VIDEO_CHANNEL'>;

export const platformName: Record<Platform, string> = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
  ZHIHU: '知乎',
  WEIBO: '微博',
  VIDEO_CHANNEL: '视频号',
};
```

服务端 WritingBrief、项目资料、热点分析平台 Zod 枚举统一包含五个平台；写作相关接口只使用四个 `CreativePlatform`。`defaultState().workspace.enabledPlatforms` 和前端 seed 同步加入 `ZHIHU`、`WEIBO`。

- [ ] **Step 4: 增加知乎、微博 Skill 和平台默认映射**

迁移增加 `creative-layout-zhihu`、`creative-layout-weibo`、`creative-channel-zhihu`、`creative-channel-weibo` 及 `:1.0.0` 版本。`creativeSkills.cjs` 使用平台展示映射，不再用二元判断：

```js
const PLATFORM_NAMES = { WECHAT: '公众号', XIAOHONGSHU: '小红书', ZHIHU: '知乎', WEIBO: '微博' };
if (!platformSelection?.CHANNEL) throw new Error(`请先配置${PLATFORM_NAMES[platform]}写作规则。`);
```

- [ ] **Step 5: 增加四平台提示词模板并在设置中可见**

`OUTLINE_TEMPLATE_SCOPES`、`DRAFT_TEMPLATE_SCOPES` 增加知乎、微博。默认模板必须分别体现：知乎问题语境/结论前置/论证链，微博单条/长微博/串文/时效。设置页平台类型改为四个平台：

```ts
type PromptPlatform = 'WECHAT' | 'XIAOHONGSHU' | 'ZHIHU' | 'WEIBO';
const platforms = [
  { id: 'WECHAT', label: '公众号图文' },
  { id: 'XIAOHONGSHU', label: '小红书图文' },
  { id: 'ZHIHU', label: '知乎回答' },
  { id: 'WEIBO', label: '微博内容' },
] as const;
```

- [ ] **Step 6: 运行四平台及既有分析测试**

Run: `node --test tests/creative-platforms.test.mjs tests/creative-outline.test.mjs tests/creative-draft.test.mjs tests/intelligence-analysis.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 7: 提交四平台契约**

```powershell
git add content-engine
git commit -m "feat: add four-platform writing contracts"
```

### Task 3: 项目 Agent 仓储、阶段摘要与上下文 API

**Files:**
- Create: `content-engine/server/services/project-agent.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/tests/project-agent-foundation.test.mjs`
- Modify: `content-engine/server/worker.cjs`

**Interfaces:**
- Consumes: Task 1 的消息、摘要和产物表。
- Produces: `createProjectAgentStore({ query, transaction })`、`GET /api/v1/creative/projects/:projectId/agent`、统一 `ProjectAgentContext` DTO。

- [ ] **Step 1: 写仓储隔离与时间线失败测试**

```js
test('项目 Agent 上下文按工作空间、项目、阶段和平台隔离', async () => {
  const calls = [];
  const store = createProjectAgentStore({
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  await store.context('workspace-a', 'project-a', { stage: 'COPY', platform: 'ZHIHU', history: 'CURRENT' });
  assert.ok(calls.every(({ params }) => params[0] === 'workspace-a' && params[1] === 'project-a'));
  assert.ok(calls.some(({ sql }) => /stage = \$3/.test(sql)));
  assert.ok(calls.some(({ sql }) => /platform/.test(sql)));
});
```

- [ ] **Step 2: 运行测试并确认仓储模块不存在**

Run: `node --test tests/project-agent-foundation.test.mjs`

Expected: FAIL，错误包含 `project-agent.cjs`。

- [ ] **Step 3: 实现聚焦仓储接口**

```js
function createProjectAgentStore({ query, transaction }) {
  return {
    context(workspaceId, projectId, filter),
    appendMessage(workspaceId, projectId, input),
    createArtifact(client, input),
    acceptArtifact(workspaceId, artifactId),
    upsertStageSummary(client, input),
  };
}
```

`context()` 在 `history=CURRENT` 时返回当前阶段最近 100 条消息、所有早期阶段的最新摘要、当前平台活动运行和最近 20 个产物；`history=ALL` 时返回项目最新 200 条消息并按时间正序。任何 artifact/message 查询都必须同时包含 `workspace_id` 和 `project_id`。

- [ ] **Step 4: 增加上下文 API 和严格查询 Schema**

```js
const projectAgentQuery = z.object({
  stage: z.enum(['RESEARCH', 'COPY', 'VISUAL', 'LAYOUT', 'REVIEW']),
  platform: z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']).optional(),
  history: z.enum(['CURRENT', 'ALL']).default('CURRENT'),
});
```

API 固定返回以下形状，后续前端不得另造字段名：

```ts
type ProjectAgentContext = {
  stage: ProjectAgentStage;
  platform: CreativePlatform | null;
  messages: ProjectAgentMessage[];
  summaries: { id: string; stage: ProjectAgentStage; platform: CreativePlatform | null; summary: string; version: number; createdAt: string }[];
  activeRun: ProjectAgentRun | null;
  artifacts: ProjectArtifact[];
  usedMaterialIds: { inputIds: string[]; referenceIds: string[] };
};

type ProjectAgentRun = {
  id: string;
  action: 'PROJECT_RESEARCH_PLAN' | CopyAction;
  status: 'DRAFT' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  request: string;
  confirmation: { model: string; promptVersion: number | null; skillNames: string[]; materialCount: number; writeScope: string };
  error?: string;
  createdAt: string;
};

type ProjectArtifact = {
  id: string;
  type: 'RESEARCH_PLAN' | 'OUTLINE' | 'CONTENT_MASTER' | 'PLATFORM_COPY';
  status: 'CANDIDATE' | 'ACCEPTED' | 'REJECTED';
  platform: CreativePlatform | null;
  version: number;
  parentArtifactId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  acceptedAt: string | null;
};
```

GET 路由先调用 `creativeProject(workspace.id, projectId)` 验证项目存在，再调用仓储，避免猜测其它项目 ID。

- [ ] **Step 5: 将研究成功结果接入产物和摘要**

`generateProjectResearchPlan()` 成功事务中新增：`RESEARCH_PLAN` artifact、`ARTIFACT` 助手消息和研究阶段摘要；旧 `project_research_plans` 继续保存专用结构。已有消息默认迁移为 `RESEARCH`，刷新结果保持兼容。

- [ ] **Step 6: 运行仓储、研究与服务端语法测试**

Run: `node --test tests/project-agent-foundation.test.mjs tests/project-research-agent.test.mjs`

Expected: PASS。

Run: `node --check server/index.cjs; node --check server/worker.cjs; node --check server/services/project-agent.cjs`

Expected: 全部 exit 0。

- [ ] **Step 7: 提交 Agent 上下文**

```powershell
git add content-engine/server content-engine/tests/project-agent-foundation.test.mjs
git commit -m "feat: add project agent context"
```

### Task 4: 文案动作解析、平台规则与严格输出

**Files:**
- Create: `content-engine/server/services/project-copy-action.cjs`
- Create: `content-engine/tests/project-copy-action.test.mjs`
- Create: `content-engine/server/migrations/017_project_copy_actions.sql`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/settings/PromptTemplateSettings.tsx`

**Interfaces:**
- Consumes: Task 2 的四平台类型、WritingBrief/Skill 上下文、Task 3 的产物 DTO。
- Produces: `COPY_ACTIONS`、`resolveCopyAction(input)`、`copyActionVersion(action)`、`copyTemplateScope(platform)`、`buildCopyPrompt(snapshot)`、`parseCopyOutput(content, action)`。

- [ ] **Step 1: 写动作解析与平台差异失败测试**

```js
test('文案请求确定性映射到注册动作', () => {
  assert.equal(resolveCopyAction({ request: '把这篇文章润色一下', hasBody: true }).action, 'POLISH_EXISTING_DRAFT');
  assert.equal(resolveCopyAction({ request: '压缩到 800 字', hasBody: true }).action, 'SHORTEN_DRAFT');
  assert.equal(resolveCopyAction({ request: '改成微博串文', hasBody: true, targetPlatform: 'WEIBO' }).action, 'ADAPT_PLATFORM');
  assert.equal(resolveCopyAction({ request: '把选中的两段改得更清楚', hasBody: true, selection: '原文' }).action, 'REVISE_SELECTION');
});

test('无法唯一判断的请求要求澄清且不创建动作', () => {
  assert.deepEqual(resolveCopyAction({ request: '处理一下', hasBody: true }), {
    needsClarification: true,
    question: '你希望润色、重构、扩写还是压缩当前文案？',
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `node --test tests/project-copy-action.test.mjs`

Expected: FAIL，错误包含 `project-copy-action.cjs`。

- [ ] **Step 3: 注册文案动作版本**

迁移注册以下动作，均 `requires_confirmation=true`：

```js
const COPY_ACTIONS = [
  'GENERATE_OUTLINE',
  'GENERATE_DRAFT',
  'POLISH_EXISTING_DRAFT',
  'RESTRUCTURE_DRAFT',
  'EXPAND_DRAFT',
  'SHORTEN_DRAFT',
  'REVISE_SELECTION',
  'ADAPT_PLATFORM',
];
```

动作版本 ID 使用 `project-copy-<kebab-action>:1.0.0`。生成类使用模型 Scope `CONTENT_WRITING`，修改/适配类使用 `CONTENT_REWRITE`。

- [ ] **Step 4: 实现确定性解析和严格 Schema**

解析优先级固定为：选区修改 → 平台适配 → 压缩 → 扩写 → 重构 → 润色 → 生成大纲 → 生成正文。未知或多义请求返回单个澄清问题，不调用模型。

```js
const copyOutputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(80).max(30000),
  changeSummary: z.string().trim().min(1).max(500),
  factsToVerify: z.array(z.string().trim().min(1).max(300)).max(20),
});
```

大纲继续使用现有 `outlineSchema`；其它动作使用 `copyOutputSchema`。Prompt 明确禁止把 `factsToVerify` 改写为已确认事实，且只返回 JSON。

- [ ] **Step 5: 增加四平台修订提示词并在设置中可见**

新增 `CREATIVE_REVISION_WECHAT`、`CREATIVE_REVISION_XIAOHONGSHU`、`CREATIVE_REVISION_ZHIHU`、`CREATIVE_REVISION_WEIBO`。设置页增加“修改文案”任务页签；服务端 `promptTemplateScope()` 仅接受真正接入执行器的这四个 Scope。

- [ ] **Step 6: 运行动作、模板和类型测试**

Run: `node --test tests/project-copy-action.test.mjs tests/creative-platforms.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 7: 提交文案动作层**

```powershell
git add content-engine/server content-engine/src/data/webApi.ts content-engine/src/workspaces/settings/PromptTemplateSettings.tsx content-engine/tests
git commit -m "feat: add controlled copy actions"
```

### Task 5: Project Agent prepare/confirm/Worker/accept 闭环

**Files:**
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-agent.cjs`
- Modify: `content-engine/server/services/project-copy-action.cjs`
- Modify: `content-engine/tests/project-copy-action.test.mjs`

**Interfaces:**
- Consumes: `resolveCopyAction()`、Project Agent Store、模型任务策略和 Prompt Template Store。
- Produces: `POST /creative/projects/:projectId/agent/prepare`、`POST /creative/agent-runs/:id/confirm`、`POST /creative/agent-runs/:id/cancel`、`POST /creative/project-artifacts/:id/accept`、`PROJECT_COPY_ACTION` Worker。

- [ ] **Step 1: 写确认前不调用、确认后入队和采用后写正式版本的失败测试**

```js
test('Project Agent prepare 不入队，confirm 才创建 Worker Job', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const prepare = routeSlice(server, "/agent/prepare", "/agent-runs/:id/confirm");
  const confirm = routeSlice(server, "/agent-runs/:id/confirm", "/agent-runs/:id/cancel");
  assert.match(prepare, /status.*DRAFT/s);
  assert.doesNotMatch(prepare, /await enqueue/);
  assert.match(confirm, /PROJECT_COPY_ACTION/);
  assert.match(confirm, /await enqueue/);
});

test('采用候选才更新 workspace snapshot 正式正文', () => {
  const server = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  const accept = routeSlice(server, "/project-artifacts/:id/accept", "/agent/skills");
  assert.match(accept, /FOR UPDATE/);
  assert.match(accept, /workspace_snapshots/);
  assert.match(accept, /platform_content_versions/);
  assert.match(accept, /project_stage_summaries/);
});
```

- [ ] **Step 2: 运行测试并确认新路由缺失**

Run: `node --test tests/project-copy-action.test.mjs`

Expected: FAIL，错误指出 prepare/confirm/accept 路由不存在。

- [ ] **Step 3: 实现 prepare**

请求契约：

```js
const agentPrepareInput = z.object({
  stage: z.enum(['RESEARCH', 'COPY']),
  platform: z.enum(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']).optional(),
  request: z.string().trim().min(1).max(2000),
  selection: z.object({ text: z.string().max(12000), start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
  inputIds: z.array(z.string().uuid()).max(20).default([]),
  referenceIds: z.array(z.string().uuid()).max(20).default([]),
});
```

COPY prepare 读取项目、Brief、当前平台正式正文、最新已采用母版、研究摘要、当前 Skill、Prompt 和模型路由；保存不可变 snapshot、DRAFT run、USER message 和 CONFIRMATION message。`resolveCopyAction()` 返回澄清时只保存助手问题，不创建 run。

- [ ] **Step 4: 实现 confirm/cancel 和 Worker**

confirm 仅允许该工作空间中 DRAFT 的 Project Agent action version，创建 `PROJECT_COPY_ACTION` Job。Worker 使用 `textRunner.runText()`，第一次严格校验失败只允许一次修复；成功事务写 `platform_content_versions`、`project_artifacts(CANDIDATE)`、助手 ARTIFACT 消息、运行结果和 `api_usage_logs(operation='PROJECT_COPY')`，不更新 snapshot 正文。

- [ ] **Step 5: 实现 accept 事务与内容母版快照**

accept 锁定候选 artifact 和 workspace snapshot。若没有已采用母版，则根据冻结的核心表达、研究摘要、资料引用和 `factsToVerify` 创建 `content_master_versions` 与 `CONTENT_MASTER` artifact；随后拒绝同平台旧 ACCEPTED 文案、采用当前候选、写回 snapshot 中相同平台版本、合并待核验事实并更新 COPY 阶段摘要。

- [ ] **Step 6: 增加启用项目平台接口**

`POST /api/v1/creative/projects/:projectId/platforms/:platform` 只接受四个图文平台；事务锁定 snapshot，不存在时创建空 DRAFT `ContentVersion`，已存在则幂等返回。禁止通过该接口创建 `VIDEO_CHANNEL`。

- [ ] **Step 7: 运行服务端闭环测试**

Run: `node --test tests/project-copy-action.test.mjs tests/project-agent-foundation.test.mjs tests/creative-outline.test.mjs tests/creative-draft.test.mjs`

Expected: PASS。

Run: `node --check server/index.cjs; node --check server/worker.cjs; node --check server/services/project-agent.cjs; node --check server/services/project-copy-action.cjs`

Expected: 全部 exit 0。

- [ ] **Step 8: 提交执行闭环**

```powershell
git add content-engine/server content-engine/tests
git commit -m "feat: execute project copy actions"
```

### Task 6: 通用 ProjectAgent 前端与研究迁移

**Files:**
- Create: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/create/ProjectMaterials.tsx`
- Delete: `content-engine/src/workspaces/create/ProjectResearchAgent.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/project-research-agent.test.mjs`

**Interfaces:**
- Consumes: Task 3/5 的 Agent Context、prepare/confirm/cancel API。
- Produces: `<ProjectAgent projectId stage platform selectedMaterials selection onArtifactAccepted onOpenSettings />`。

- [ ] **Step 1: 使用前端设计技能并写组件契约失败测试**

执行前完整读取 `C:/Users/Administrator/.codex/skills/taste-skill/SKILL.md`。随后增加静态契约测试：

```js
test('研究与文案共用一个 ProjectAgent 组件', () => {
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  const materials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
  assert.match(agent, /history.*CURRENT.*ALL/s);
  assert.match(agent, /CONFIRMATION.*RUN_STATUS.*ARTIFACT/s);
  assert.match(materials, /<ProjectAgent/);
  assert.doesNotMatch(materials, /ProjectResearchAgent/);
});
```

- [ ] **Step 2: 运行测试并确认新组件不存在**

Run: `node --test tests/project-research-agent.test.mjs`

Expected: FAIL，错误包含 `ProjectAgent.tsx` 不存在。

- [ ] **Step 3: 增加前端类型和 API**

```ts
export type ProjectAgentStage = 'RESEARCH' | 'COPY' | 'VISUAL' | 'LAYOUT' | 'REVIEW';
export type ProjectAgentMessageType = 'MESSAGE' | 'CONFIRMATION' | 'RUN_STATUS' | 'ARTIFACT' | 'SYSTEM_EVENT';
export type CopyAction = 'GENERATE_OUTLINE' | 'GENERATE_DRAFT' | 'POLISH_EXISTING_DRAFT' | 'RESTRUCTURE_DRAFT' | 'EXPAND_DRAFT' | 'SHORTEN_DRAFT' | 'REVISE_SELECTION' | 'ADAPT_PLATFORM';
```

`webCreative.agentContext()`、`prepareAgent()`、`confirmAgentRun()`、`cancelAgentRun()` 和 `acceptArtifact()` 必须返回强类型 DTO。

组件属性固定为：

```ts
type ProjectAgentProps = {
  projectId: string;
  stage: 'RESEARCH' | 'COPY';
  platform?: CreativePlatform;
  selectedMaterials?: { inputIds: string[]; referenceIds: string[] };
  selection?: { text: string; start: number; end: number };
  onArtifactAccepted: (artifact: ProjectArtifact, project?: ContentProject) => void;
  onOpenSettings: (target: 'agent' | 'policies') => void;
};
```

- [ ] **Step 4: 实现单一 ProjectAgent 时间线**

组件只渲染五类消息；确认卡显示动作、平台、模型、Prompt 版本、Skill、资料数量和写入范围；QUEUED/RUNNING 每 1.5 秒轮询上下文；FAILED 显示真实错误；ARTIFACT 提供“查看候选”，不在消息卡内塞全文编辑器。顶部使用“当前阶段/完整历史”分段控件，页头显示如“文案 · 知乎”。

- [ ] **Step 5: 迁移资料与研究页面**

`ProjectMaterials` 继续管理资料选择，把 `selectedInputIds`/`selectedReferenceIds` 传给 `<ProjectAgent stage="RESEARCH">`。删除研究专用组件；研究计划结果作为 `RESEARCH_PLAN` artifact 卡展示，资料“研究已引用”逻辑继续使用上下文返回的引用 ID。

- [ ] **Step 6: 实现响应式布局**

桌面资料/Agent 双栏；`max-width:1100px` 单栏；390px 使用主区与 Agent 顺序布局，固定按钮和标签不导致横向滚动。动画只保留加载旋转并遵守 `prefers-reduced-motion`。

- [ ] **Step 7: 运行前端与研究回归**

Run: `npm run typecheck`

Expected: exit 0。

Run: `node --test tests/project-research-agent.test.mjs`

Expected: PASS。

- [ ] **Step 8: 提交通用 Agent UI**

```powershell
git add content-engine/src content-engine/tests/project-research-agent.test.mjs
git commit -m "feat: unify project agent interface"
```

### Task 7: 四平台文案工作区、候选差异与采用

**Files:**
- Create: `content-engine/src/workspaces/create/CopyWorkspace.tsx`
- Create: `content-engine/src/workspaces/create/CopyCandidateDialog.tsx`
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/tests/creative-workflow.test.mjs`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes: `<ProjectAgent stage="COPY">`、平台策略、平台文案候选和启用平台 API。
- Produces: 四平台标签页、写作策略、正式编辑器、版本历史、候选差异和采用后的项目更新。

- [ ] **Step 1: 写文案工作区失败测试**

```js
test('文案工作区支持四平台且不保留旧孤立 Agent', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(copy, /WECHAT.*XIAOHONGSHU.*ZHIHU.*WEIBO/s);
  assert.match(copy, /<ProjectAgent/);
  assert.match(copy, /CopyCandidateDialog/);
  assert.doesNotMatch(workspace, /creative-agent-panel/);
  assert.doesNotMatch(workspace, /prepareOutline|prepareDraft/);
});
```

- [ ] **Step 2: 运行测试并确认工作区不存在**

Run: `node --test tests/creative-workflow.test.mjs`

Expected: FAIL，错误包含 `CopyWorkspace.tsx` 不存在。

- [ ] **Step 3: 从 CreateWorkspace 提取文案职责**

`CreateWorkspace` 保留 stage、Brief 和项目级数据编排；旧 outline/draft useState、轮询、确认卡和弹层全部移入新工作区或删除。`CopyWorkspace` 接收：

```ts
type CopyWorkspaceProps = {
  project: ContentProject;
  brief: WritingBriefInput | null;
  skills: CreativeSkillDefinition[];
  activePlatform: CreativePlatform;
  onPlatform: (platform: CreativePlatform) => void;
  onProjectChange: (project: ContentProject) => void;
  onSaveBrief: (next: WritingBriefInput) => Promise<void>;
  onOpenModelSettings: () => void;
};
```

- [ ] **Step 4: 实现四平台标签和启用动作**

顶部只显示已启用图文平台，末尾使用带 Plus 图标的菜单增加缺失平台；调用 `enableProjectPlatform()` 后更新项目并切换过去。不得显示视频号。每个平台独立读取策略、正式正文、候选和 Agent COPY 上下文。

- [ ] **Step 5: 实现候选审核与差异**

`CopyCandidateDialog` 对大纲显示标题方案/结构，对文案显示标题、正文和 `changeSummary`。存在父版本时按段落生成只读 added/removed/unchanged 差异；没有父版本时展示完整候选。候选按钮只有“废弃”和“采用为当前版本”，不提供直接发布。

- [ ] **Step 6: 实现编辑选区交给 Agent**

正文 textarea 记录 `selectionStart`/`selectionEnd`，有选区时传给 ProjectAgent composer，并在输入框上方显示可删除的“已选择 N 字”；Agent prepare 冻结选区文本和父版本 ID，切换平台时清空选区。

- [ ] **Step 7: 扩展浏览器 E2E（全程 Mock 模型）**

E2E 必须覆盖：添加知乎版本、输入“把这篇文章润色一下”、确认卡、确认执行、候选不覆盖正文、打开差异、采用后正文更新、切换微博不串文案、刷新后恢复消息/候选/已采用状态、1024px 与 390px 无横向溢出。

- [ ] **Step 8: 运行文案工作区测试**

Run: `node --test tests/creative-workflow.test.mjs tests/creative-platforms.test.mjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: exit 0。

Run: `python tests/creative-workspace.e2e.py`

Expected: exit 0，且测试路由未调用真实模型。

- [ ] **Step 9: 提交文案工作区**

```powershell
git add content-engine/src content-engine/tests
git commit -m "feat: add four-platform copy workspace"
```

### Task 8: 全量回归、文档 A29 与推送

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Consumes: Tasks 1-7 的真实实现和测试结果。
- Produces: A29 验收记录、干净提交和 `origin/main` 推送。

- [ ] **Step 1: 应用最终迁移并确认幂等**

Run: `npm run db:migrate`

Expected: exit 0；再次运行仍 exit 0，且不会重复插入动作或 Skill。

- [ ] **Step 2: 运行完整自动化**

Run: `npm test`

Expected: 0 failed。

Run: `npm run typecheck`

Expected: exit 0。

Run: `npm run build`

Expected: Vite production build exit 0。

Run: `node --check server/index.cjs; node --check server/worker.cjs; node --check server/services/project-agent.cjs; node --check server/services/project-copy-action.cjs`

Expected: 全部 exit 0。

Run: `python tests/creative-workspace.e2e.py`

Expected: exit 0。

Run: `npm audit --omit=dev`

Expected: `found 0 vulnerabilities`；若 npm 审计接口网络失败，重试一次并在验收记录写明真实网络错误，不伪报通过。

- [ ] **Step 3: 人工检查服务与付费调用边界**

确认 `http://127.0.0.1:5173` 和 `http://127.0.0.1:8787/health` 可访问；检查 E2E 中所有 Project Agent confirm 请求均被 Playwright Mock 拦截；检查调用日志没有本轮测试产生的真实 `PROJECT_COPY` 记录。

- [ ] **Step 4: 更新四份文档**

PRD 写真实已实现范围；PLAN 将下一切片改为来源/证据 Agent 动作；IMPLEMENT 记录迁移、接口、组件和兼容策略；ACCEPTANCE 新增 A29，逐项记录自动化结果、截图、未触发付费模型和用户验收入口。不得把配图、排版、审核标成完成。

- [ ] **Step 5: 最终差异检查并提交**

Run: `git diff --check`

Expected: 无输出，exit 0。

```powershell
git add content-engine docs
git commit -m "feat: deliver universal project agent copy workflow"
```

- [ ] **Step 6: 推送并核对工作区**

```powershell
git push origin main
git status --branch --short
```

Expected: push 显示 `main -> main`，status 只显示 `## main...origin/main`。
