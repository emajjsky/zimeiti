# 简化研究工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将内容项目研究阶段改为一键执行、可读结果、可采用进入正文的工作流，同时保留来源、事实核验和审计能力。

**Architecture:** 新增一个统一的 `PROJECT_RESEARCH_WORKFLOW` 运行，前端只创建和观察这一次运行；Worker 在其内部顺序执行研究计划、来源读取、相关性过滤和事实核验，并最终保存一份 `RESEARCH_RESULT` 产物。现有研究计划、来源和核验表继续保留为可展开的审计明细，但不再成为前台必经确认步骤。

**Tech Stack:** React + TypeScript + Vite、Fastify、PostgreSQL、BullMQ Worker、Zod、现有百炼 CLI 与 Tavily 集成、Node test、Playwright Python E2E。

## Global Constraints

- 前台主流程只保留规划 → 研究 → 正文 → 平台版本 → 配图 → 排版 → 审核；研究页不得显示第二套项目进度。
- 研究主路径只有“开始研究”和“采用并进入正文”两个必经动作；计划、来源选择、核验确认全部是内部步骤。
- 用户草稿、创作参考和视觉素材默认不进入事实核验；仅可写入正文的外部客观主张进入核验候选。
- 无关来源不得默认进入核验；未确认主张不得作为正文 Agent 的确定事实。
- UI 实现前必须读取并遵循 `design-taste-frontend` skill；不要新增冗余说明卡或技术术语。
- 保留旧研究 API 和历史产物的只读兼容性；新 UI 不再调用旧 prepare/confirm 链路。

---

## File Structure

- Create: `content-engine/server/migrations/021_simplified_research_workflow.sql`：注册统一运行版本、扩展研究结果产物约束、保存最终研究结果。
- Create: `content-engine/server/services/simplified-research.cjs`：统一研究结果 Zod 契约、资料分流、来源相关性过滤和正文事实投影。
- Create: `content-engine/tests/simplified-research-workflow.test.mjs`：纯服务、迁移与 API 路由契约回归。
- Modify: `content-engine/server/index.cjs`：开始研究、采用结果、跳过研究 API；将正文运行读取已采用研究结果。
- Modify: `content-engine/server/worker.cjs`：新增统一研究 Worker，串联既有计划、来源和核验能力。
- Modify: `content-engine/server/services/project-agent.cjs`：识别统一运行和 `RESEARCH_RESULT`，为上下文返回其可读负载。
- Modify: `content-engine/src/domain/creative.ts`：添加研究结果和统一运行的前端类型。
- Modify: `content-engine/src/data/webApi.ts`：替换研究页的多段 prepare/confirm 客户端调用。
- Modify: `content-engine/src/workspaces/create/ProjectMaterials.tsx`：删除重复进度、资料勾选与研究步骤条；提供可选资料和研究页回调。
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`：研究状态、结果预览、补充研究、采用/跳过入口；移除来源勾选和多次确认卡。
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`：接受研究完成或跳过后的正文跳转，并刷新项目阶段。
- Modify: `content-engine/src/styles.css`：研究页与结果预览的紧凑布局、详情折叠、移动端回归。
- Modify: `content-engine/tests/project-research-agent.test.mjs`、`content-engine/tests/source-verification.test.mjs`、`content-engine/tests/project-research-sources.test.mjs`：移除依赖旧 UI 行为的断言，增加兼容性断言。
- Modify: `tests/creative-workspace.e2e.py`：覆盖一键研究、结果采用、跳过研究及 1440px/390px 视觉与交互回归。
- Modify: `docs/01_PRD_内容引擎.md`、`docs/02_PLAN_内容引擎.md`、`docs/03_IMPLEMENT_内容引擎.md`、`docs/04_ACCEPTANCE_LOG_内容引擎.md`：更新完成边界与验收证据。

### Task 1: 统一研究结果的数据契约与迁移

**Files:**
- Create: `content-engine/server/migrations/021_simplified_research_workflow.sql`
- Create: `content-engine/server/services/simplified-research.cjs`
- Create: `content-engine/tests/simplified-research-workflow.test.mjs`
- Modify: `content-engine/src/domain/creative.ts`

**Interfaces:**
- Produces `SIMPLIFIED_RESEARCH_WORKFLOW_VERSION = 'project-research-workflow:1.0.0'`。
- Produces `researchResultSchema`：`summary`、`facts`、`cautions`、`angles`、`sources`、`materialContext` 和 `process`。
- Produces `buildResearchResult({ plan, sources, verification, materials })`，只将 `VERIFIED` 与允许的 `SINGLE_SOURCE` 投影为 `facts`。
- Produces前端 `ProjectArtifactType` 中的 `RESEARCH_RESULT` 与 `ProjectAgentRun.action` 中的 `PROJECT_RESEARCH_WORKFLOW`。

- [ ] **Step 1: 写出失败的契约测试**

```js
test('研究结果只把可用事实投影给正文，并保留暂未确认项', () => {
  const result = buildResearchResult({
    plan: { claims: [{ claim: '已核验事实' }, { claim: '暂未确认事实' }] },
    sources: [{ id: 'source-a', status: 'CAPTURED', title: '官方公告', url: 'https://example.com', summary: '...' }],
    verification: {
      summary: '核验完成',
      claims: [
        { claim: '已核验事实', status: 'VERIFIED', explanation: '两条独立来源支持', evidence: [] },
        { claim: '暂未确认事实', status: 'NEEDS_REVIEW', explanation: '没有证据', evidence: [] },
      ],
    },
    materials: [{ id: 'draft-1', kind: 'DRAFT', role: 'USER_CONTENT' }],
  });
  assert.deepEqual(result.facts.map((item) => item.claim), ['已核验事实']);
  assert.deepEqual(result.cautions.map((item) => item.claim), ['暂未确认事实']);
  assert.equal(result.materialContext.userContent[0].id, 'draft-1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- simplified-research-workflow.test.mjs`

Expected: FAIL，提示找不到 `simplified-research.cjs` 或 `buildResearchResult`。

- [ ] **Step 3: 建立迁移与纯服务契约**

```sql
ALTER TABLE project_artifacts
  DROP CONSTRAINT IF EXISTS project_artifacts_artifact_type_check,
  DROP CONSTRAINT IF EXISTS project_artifacts_type_platform_check;

ALTER TABLE project_artifacts
  ADD CONSTRAINT project_artifacts_artifact_type_check
    CHECK (artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'RESEARCH_VERIFICATION', 'RESEARCH_RESULT', 'OUTLINE', 'CONTENT_MASTER', 'PLATFORM_COPY')),
  ADD CONSTRAINT project_artifacts_type_platform_check
    CHECK ((artifact_type IN ('RESEARCH_PLAN', 'RESEARCH_SOURCES', 'RESEARCH_VERIFICATION', 'RESEARCH_RESULT', 'CONTENT_MASTER') AND platform IS NULL)
      OR (artifact_type IN ('OUTLINE', 'PLATFORM_COPY') AND platform IS NOT NULL));

CREATE TABLE project_research_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  generation_run_id uuid NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL UNIQUE REFERENCES project_artifacts(id) ON DELETE CASCADE,
  output_json jsonb NOT NULL CHECK (jsonb_typeof(output_json) = 'object'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

在 `simplified-research.cjs` 中用 Zod 定义结果结构；将 `FACT` 参考及可验证外部陈述归入 `verificationCandidates`，将 `OPINION`、`STRUCTURE`、`VOICE`、`HOOK`、`NEGATIVE` 归入 `creativeReferences`，将 `VISUAL` 和非文本文件归入 `visualAssets`，将 `IDEA`、`DRAFT`、`NOTE`、`TRANSCRIPT` 归入 `userContent`。输入资料缺少可读正文时只保留元数据，不能制造事实。

- [ ] **Step 4: 更新前端类型并运行聚焦测试**

Run: `npm test -- simplified-research-workflow.test.mjs`

Expected: PASS；迁移断言包含 `RESEARCH_RESULT`，投影测试证明 `NEEDS_REVIEW` 不进入 `facts`。

- [ ] **Step 5: 提交数据契约**

```bash
git add content-engine/server/migrations/021_simplified_research_workflow.sql content-engine/server/services/simplified-research.cjs content-engine/tests/simplified-research-workflow.test.mjs content-engine/src/domain/creative.ts
git commit -m "feat: add simplified research result contract"
```

### Task 2: 开始研究、统一运行与内部编排

**Files:**
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-agent.cjs`
- Modify: `content-engine/tests/simplified-research-workflow.test.mjs`

**Interfaces:**
- Consumes `buildResearchResult`、既有 `buildResearchPlanPrompt`、`researchSourceActions`、`recommendSourceSelection`、`buildSourceVerificationPrompt`。
- Produces `POST /api/v1/creative/projects/:projectId/research/start`，请求体为 `{ request?: string }`，响应为已入队的 `ProjectAgentRun`。
- Produces Worker Job `PROJECT_RESEARCH_WORKFLOW`，一个 `generation_runs` 贯穿整个用户研究动作。
- Produces运行快照 `source_snapshot_json.process = { phase: 'PLANNING'|'SOURCES'|'VERIFYING'|'COMPLETE', progress: number }`。

- [ ] **Step 1: 写出失败的 API 和 Worker 路径测试**

```js
test('开始研究直接入队统一任务，未创建 DRAFT 确认卡', async () => {
  const source = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /projects\/:projectId\/research\/start/);
  assert.match(source, /'PROJECT_RESEARCH_WORKFLOW'/);
  assert.doesNotMatch(source.slice(source.indexOf("/research/start"), source.indexOf("/research/start") + 6000), /'DRAFT'/);
});

test('Worker 以计划、来源、核验顺序完成一份研究结果', () => {
  const worker = fs.readFileSync(new URL('../server/worker.cjs', import.meta.url), 'utf8');
  assert.match(worker, /queueJob\.name === 'PROJECT_RESEARCH_WORKFLOW'/);
  assert.match(worker, /phase: 'SOURCES'/);
  assert.match(worker, /phase: 'VERIFYING'/);
  assert.match(worker, /type: 'RESEARCH_RESULT'/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- simplified-research-workflow.test.mjs`

Expected: FAIL，当前服务器没有 `/research/start`，Worker 没有统一任务。

- [ ] **Step 3: 实现直接入队的开始研究 API**

新增路由应读取项目、写作 Brief 和全部 `scope IN ('PROJECT', 'RESEARCH')` 的项目资料，调用 `projectResearchMaterialSnapshot`，并在同一事务中：取消同项目旧的 `QUEUED` 或 `RUNNING` 统一研究运行、创建状态为 `QUEUED` 的 `generation_runs`、写入用户请求消息和“正在检索”运行状态消息、创建 `PROJECT_RESEARCH_WORKFLOW` job。路由只将“规划模型不可用”作为阻断错误；Tavily 或核验模型缺失由 Worker 记录为可恢复的部分失败，不生成假证据。

扩展 `actionName()` 和 `context()` 的活动运行查询，使统一运行在研究阶段始终优先展示。保留旧 `/agent/prepare`、来源和核验接口供历史记录和旧自动化读取，但新客户端不再调用它们。

- [ ] **Step 4: 实现 Worker 的四阶段顺序执行**

Worker 新增 `generateSimplifiedResearchWorkflow({ jobId, workspaceId, runId })`：

```js
await setResearchPhase(runId, 'PLANNING', 15);
const plan = await generatePlanForWorkflow(snapshot);
await setResearchPhase(runId, 'SOURCES', 45);
const capturedSources = await captureWorkflowSources(plan, snapshot);
const selectedSources = recommendSourceSelection(capturedSources, 8);
await setResearchPhase(runId, 'VERIFYING', 75);
const verification = await verifyWorkflowClaims(plan.claims, selectedSources, snapshot);
const result = buildResearchResult({ plan, sources: capturedSources, verification, materials: snapshot.materials });
await saveResearchResult(runId, result);
await setResearchPhase(runId, 'COMPLETE', 100);
```

`captureWorkflowSources` 复用 Tavily、公开网页读取、去重与失败快照；每条 `SEARCH_WEB` 最多保留 5 条候选，相关性排序后仅前 8 条进入核验。`ASK_USER` 记录为“需要补充”，不阻塞结果。没有来源或没有配置核验模型时，将全部客观主张列入 `cautions`，并在 `process` 记录明确原因；不得调用模型补写证据。

保存时创建 `RESEARCH_RESULT` 候选产物和 `project_research_results` 行，写入一条引用该产物的研究 Agent 消息以及研究阶段摘要。计划、来源、核验的旧表可以继续写入以支持审计，但不创建要求用户确认的消息。

- [ ] **Step 5: 运行聚焦测试**

Run: `npm test -- simplified-research-workflow.test.mjs project-research-sources.test.mjs source-verification.test.mjs`

Expected: PASS；测试证明新运行无 DRAFT 确认、Worker 生成 `RESEARCH_RESULT`、旧来源和核验纯服务契约仍通过。

- [ ] **Step 6: 提交统一运行**

```bash
git add content-engine/server/index.cjs content-engine/server/worker.cjs content-engine/server/services/project-agent.cjs content-engine/tests/simplified-research-workflow.test.mjs
git commit -m "feat: run project research in one workflow"
```

### Task 3: 采用结果、跳过研究与正文事实读取

**Files:**
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/services/project-agent.cjs`
- Modify: `content-engine/tests/simplified-research-workflow.test.mjs`

**Interfaces:**
- Produces `POST /api/v1/creative/research-results/:artifactId/accept`。
- Produces `POST /api/v1/creative/projects/:projectId/research/skip`。
- Produces `researchContext`，正文 `sourceSnapshot` 读取 `facts`、`cautions`、`creativeReferences`、`userContent` 与 `visualAssets`。

- [ ] **Step 1: 写出失败的采用与正文上下文测试**

```js
test('采用研究结果会推进项目并仅向正文传递已确认事实', () => {
  const source = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /research-results\/:artifactId\/accept/);
  assert.match(source, /stage = 'MASTER_WRITING'/);
  assert.match(source, /researchContext/);
  assert.match(source, /verifiedFacts/);
  assert.doesNotMatch(source.slice(source.indexOf('researchContext'), source.indexOf('researchContext') + 2500), /NEEDS_REVIEW.*verifiedFacts/s);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- simplified-research-workflow.test.mjs`

Expected: FAIL，因为不存在研究结果采用和跳过路由。

- [ ] **Step 3: 实现采用和跳过 API**

采用路由在一个事务中锁定候选 `RESEARCH_RESULT`、拒绝同项目旧的已采用研究结果、接受当前产物、填充 `project_research_results.accepted_at`、写入研究阶段摘要与系统消息、将项目阶段从 `RESEARCH` 更新为 `MASTER_WRITING`。响应返回 `{ artifact, project }`，供前端刷新并切换正文。

跳过路由不创建研究结果；它写入“用户选择跳过研究”的系统消息及阶段摘要，并将项目推进至 `MASTER_WRITING`。正文审核后续必须能根据缺失的已采用研究结果提示外部事实风险。

在文案 prepare 的 `sourceSnapshot` 中加入：

```js
researchContext: acceptedResearch ? {
  verifiedFacts: acceptedResearch.output_json.facts,
  cautions: acceptedResearch.output_json.cautions,
  creativeReferences: acceptedResearch.output_json.materialContext.creativeReferences,
  userContent: acceptedResearch.output_json.materialContext.userContent,
  visualAssets: acceptedResearch.output_json.materialContext.visualAssets,
} : { verifiedFacts: [], cautions: [], creativeReferences: [], userContent: materials, visualAssets: [] },
```

正文 prompt 只把 `verifiedFacts` 称为事实；`cautions` 必须以待确认表达处理，创作参考只影响结构和语气，视觉素材不得进入事实判断。

- [ ] **Step 4: 运行聚焦测试**

Run: `npm test -- simplified-research-workflow.test.mjs project-copy-action.test.mjs`

Expected: PASS；采用/跳过可推进项目，正文上下文不含未确认事实。

- [ ] **Step 5: 提交正文衔接**

```bash
git add content-engine/server/index.cjs content-engine/server/services/project-agent.cjs content-engine/tests/simplified-research-workflow.test.mjs
git commit -m "feat: carry accepted research into copy generation"
```

### Task 4: 重构研究页为一键研究与可展开结果

**Files:**
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/create/ProjectMaterials.tsx`
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/project-research-agent.test.mjs`

**Interfaces:**
- Consumes `webCreative.startResearch(projectId, { request? })`、`acceptResearchResult(artifactId)` 与 `skipResearch(projectId)`。
- Produces `onResearchComplete(project)`，由 `CreateWorkspace` 刷新项目并调用 `onStage('master')`。
- Produces `ResearchResultPreview`：默认展示结论、可用事实、谨慎项、正文角度；过程和来源明细折叠。

- [ ] **Step 1: 写出失败的页面契约测试**

```js
test('研究页只有开始研究、补充研究、采用并进入正文和跳过研究主路径', () => {
  const materials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../src/workspaces/create/ProjectAgent.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(materials, /项目进度[\s\S]*研究计划/);
  assert.match(agent, /开始研究/);
  assert.match(agent, /采用并进入正文/);
  assert.match(agent, /无需研究，直接进入正文/);
  assert.doesNotMatch(agent, /准备查找资料|准备事实核验|确认研究结论/);
  assert.doesNotMatch(agent, /research-source-row|research-source-toolbar/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- project-research-agent.test.mjs`

Expected: FAIL，当前页面仍渲染重复进度、来源选择与多段确认动作。

- [ ] **Step 3: 按 `design-taste-frontend` 约束实现研究页**

删除 `ProjectMaterials` 中的 `project-progress-band`、资料总选择栏和研究资料复选框；资料页签只服务于添加、打开、编辑和删除。保留资料编辑内的“参考用途”，但不在列表或开始研究前要求用户理解分类。

`ProjectAgent` 的研究分支只显示：

```tsx
<button className="button primary" onClick={() => void startResearch()}>
  <Search size={16}/>开始研究
</button>
<button className="text-button" onClick={() => void skipResearch()}>
  无需研究，直接进入正文
</button>
```

活跃运行以 `phase` 显示“正在检索 / 正在整理 / 正在核验”，不要显示模型、Prompt、来源数量或内部动作确认卡。完成后将 `RESEARCH_RESULT` 打开为结果卡：顶部一句总结，随后是“可采用信息”“暂未确认”“正文角度”，底部为“补充研究”“采用并进入正文”。来源、证据与调用记录以 `<details>` 折叠显示；原始枚举统一映射为“暂未确认”“存在冲突”“单一来源”。

`CreateWorkspace` 将研究完成回调连接到 `onProjectAccepted(project)` 与 `onStage('master')`。研究页在 1100px 以下变为单列，在 460px 以下所有主要动作全宽且无横向滚动。

- [ ] **Step 4: 运行单元和类型检查**

Run: `npm test -- project-research-agent.test.mjs project-materials.test.mjs && npm run typecheck`

Expected: PASS；旧来源选择 UI 断言消失，新增按钮、结果预览和移动布局断言通过。

- [ ] **Step 5: 提交研究页重构**

```bash
git add content-engine/src/domain/creative.ts content-engine/src/data/webApi.ts content-engine/src/workspaces/create/ProjectMaterials.tsx content-engine/src/workspaces/create/ProjectAgent.tsx content-engine/src/workspaces/create/CreateWorkspace.tsx content-engine/src/styles.css content-engine/tests/project-research-agent.test.mjs
git commit -m "feat: simplify the project research experience"
```

### Task 5: 端到端、视觉与旧链路兼容回归

**Files:**
- Modify: `tests/creative-workspace.e2e.py`
- Modify: `content-engine/tests/source-verification.test.mjs`
- Modify: `content-engine/tests/project-research-sources.test.mjs`
- Modify: `content-engine/tests/creative-workflow.test.mjs`

**Interfaces:**
- Consumes Mock API 中的统一研究运行和 `RESEARCH_RESULT`。
- Produces桌面 `research-simplified-desktop.png` 与移动 `research-simplified-mobile.png` 证据。

- [ ] **Step 1: 先写失败的浏览器场景**

```python
def test_simplified_research_flow(page):
    page.get_by_role('button', name='开始研究').click()
    expect(page.get_by_text('正在检索')).to_be_visible()
    expect(page.get_by_text('正在核验')).to_be_visible()
    expect(page.get_by_text('可采用信息')).to_be_visible()
    expect(page.get_by_text('暂未确认')).to_be_visible()
    expect(page.get_by_role('button', name='采用并进入正文')).to_be_visible()
    expect(page.get_by_text('准备查找资料')).not_to_be_visible()
    expect(page.get_by_text('准备事实核验')).not_to_be_visible()
```

新增“无需研究，直接进入正文”场景，断言正文标签可访问且研究页写入跳过事件；新增 1440×1000 和 390×844 截图断言，检查结果卡、折叠详情和按钮均在可见区域内。

- [ ] **Step 2: 运行 E2E 确认失败**

Run: `python tests/creative-workspace.e2e.py`

Expected: FAIL，当前页面需要多个 prepare/confirm 动作且无统一结果卡。

- [ ] **Step 3: 更新 Mock 和兼容性断言**

Mock `/research/start` 返回 `QUEUED`、`RUNNING`、`SUCCEEDED` 三个可轮询状态；完成状态返回一个 `RESEARCH_RESULT`，其中同时包含 `VERIFIED` 与 `NEEDS_REVIEW` 示例。旧来源与核验测试应保留服务契约和历史产物读取断言，但删除“新 UI 必须展示来源勾选”的断言。

- [ ] **Step 4: 运行完整前端验证**

Run: `npm test && npm run typecheck && npm run build && python tests/creative-workspace.e2e.py`

Expected: 全部 PASS；桌面和移动截图中没有重复进度、来源全选栏、内部状态码或不可点击的底部动作。

- [ ] **Step 5: 提交回归测试**

```bash
git add tests/creative-workspace.e2e.py content-engine/tests/source-verification.test.mjs content-engine/tests/project-research-sources.test.mjs content-engine/tests/creative-workflow.test.mjs
git commit -m "test: cover simplified research workflow"
```

### Task 6: 文档、迁移实跑与发布前验证

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Consumes Task 1-5 的真实测试结果、迁移状态和截图。
- Produces产品边界、实现记录和可复验验收日志。

- [ ] **Step 1: 更新四份主文档**

PRD 写明研究只有“开始、补充/调整、采用”三个用户可见动作；PLAN 写明旧来源与核验 API 转为内部审计能力；IMPLEMENT 记录统一运行、资料分流、正文读取规则和项目阶段推进；ACCEPTANCE_LOG 记录每条自动化命令、迁移编号、桌面与移动截图路径及跳过研究风险提示。

- [ ] **Step 2: 应用并核验迁移**

Run: `npm run migrate`

Expected: `021_simplified_research_workflow.sql` 成功应用；`project_artifacts` 接受 `RESEARCH_RESULT`，`project_research_results` 可插入并受外键保护。

- [ ] **Step 3: 运行发布前检查**

Run: `npm test && npm run typecheck && npm run build && python tests/creative-workspace.e2e.py && git diff --check`

Expected: 全部 PASS，且 `git diff --check` 无输出。

- [ ] **Step 4: 提交并推送完成记录**

```bash
git add docs/01_PRD_内容引擎.md docs/02_PLAN_内容引擎.md docs/03_IMPLEMENT_内容引擎.md docs/04_ACCEPTANCE_LOG_内容引擎.md
git commit -m "docs: record simplified research workflow"
git push origin main
```

## Plan Self-Review

- Spec coverage: 统一主链路由 Task 2 和 Task 4 实现；资料自动分流由 Task 1；来源过滤和事实边界由 Task 2；采用、跳过和正文继承由 Task 3；错误降级、移动端和视觉回归由 Task 2、Task 4、Task 5；四份产品文档由 Task 6 更新。
- Placeholder scan: 未使用 TBD、TODO、“适当处理”或跨任务省略；所有测试步骤、命令、接口名、运行版本和迁移名均已明确。
- Type consistency: `PROJECT_RESEARCH_WORKFLOW`、`RESEARCH_RESULT`、`researchContext`、`startResearch`、`acceptResearchResult` 和 `skipResearch` 在契约、服务端、前端和测试任务中名称一致。
