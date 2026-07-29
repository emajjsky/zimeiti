# 创作自动保存与最小输入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让规划、研究和正文以自动继承与自动保存工作，用户不再因手动保存缺失而被 Agent 阻塞。

**Architecture:** 保留 `ProjectPlanning` 与 `WritingBrief` 的数据结构。服务端在确认规划时补全可推导字段；前端使用 700ms 防抖保存规划和写作策略；首次进入正文立即持久化默认策略。研究补充输入仅在用户主动要求补充时展开。

**Tech Stack:** React 19、TypeScript、Node.js CommonJS、PostgreSQL、node:test、Playwright。

**Status:** Completed on 2026-07-29. All four tasks were implemented and verified in the current workspace.

## Global Constraints

- 不新增模型、检索、浏览器或发布调用。
- 不删除字段或改写用户已经保存的显式值。
- 用户可见文本使用简体中文；不增加冗余说明。
- 自动保存固定使用 700ms 防抖；失败必须保留本地值并允许重试。
- 桌面和 390px 移动端不得横向溢出。

---

### Task 1: 规划默认值与最小输入

**Files:**
- Modify: `content-engine/server/services/project-planning.cjs`
- Modify: `content-engine/src/domain/creative-flow.mjs`
- Modify: `content-engine/src/workspaces/create/PlanningWorkspace.tsx`
- Modify: `content-engine/src/styles.css`
- Test: `content-engine/tests/creative-flow.test.mjs`
- Test: `content-engine/tests/creative-workflow.test.mjs`

- [ ] 先增加失败测试：只有标题和目标平台的规划确认后，`angle`、`objective`、`targetAudience`、`coreMessage` 均非空；规划工作台包含 `已自动保存`，不再渲染 `计划发布时间` 或 `保存规划`。
- [ ] 运行 `node --test tests/creative-flow.test.mjs tests/creative-workflow.test.mjs`，确认当前行为失败。
- [ ] 增加 `planningWithDefaults(input)`：以标题、题材和平台生成确定性默认角度、目标、受众和核心表达；`saveProjectPlanning` 和确认校验使用它；前端验证仅要求标题和至少一个平台。
- [ ] 规划页只显示标题、平台、时效和可选补充要求；详情使用折叠区；字段变化 700ms 调用 `webProjects.savePlanning`；确认前等待最后保存完成。
- [ ] 运行上述测试及 `npm run typecheck`，通过后提交 `feat: autosave minimal planning workspace`。

### Task 2: 研究补充按需展开

**Files:**
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/styles.css`
- Test: `content-engine/tests/creative-workflow.test.mjs`

- [ ] 先增加失败测试，断言存在 `showResearchSupplement` 和“展开补充研究”。
- [ ] 运行 `node --test tests/creative-workflow.test.mjs`，确认当前补充输入永久显示而失败。
- [ ] 结果存在时默认只显示“采用并进入正文”和次级“补充研究”；点击后才显示可选单行输入与“开始补充”；空输入仍可调用既有 `webCreative.startResearch`。
- [ ] 运行测试，通过后提交 `feat: make research supplement optional`。

### Task 3: 正文策略自动落库与同步

**Files:**
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CopyWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Test: `content-engine/tests/creative-workflow.test.mjs`
- Test: `content-engine/tests/project-agent-composer.test.mjs`

- [ ] 先增加失败测试：无 Brief 时，`defaultBrief` 必须通过 `webCreative.saveBrief(project.id, defaults)` 持久化；策略变更包含 700ms 自动保存，Agent 阻断文案为“正在保存创作设定”。
- [ ] 运行 `node --test tests/creative-workflow.test.mjs tests/project-agent-composer.test.mjs`，确认当前默认策略只有前端状态。
- [ ] 新增 `briefState`（`loading`、`saving`、`saved`、`error`）：首次正文加载时保存默认策略，成功后才显示“已自动保存”；策略变更防抖保存；失败保留编辑值并显示“重试保存”。
- [ ] 将 Agent `blockedReason` 限制为真实 `saving` 或 `error` 状态；成功后立即恢复发送。
- [ ] 运行相关测试、`npm run typecheck` 和 `npm run build`，通过后提交 `fix: autosave writing strategy before agent use`。

### Task 4: 浏览器回归与产品文档

**Files:**
- Modify: `content-engine/tests/creative-workspace.e2e.py`
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

- [ ] 扩展 Mock E2E：最小规划自动保存、研究直接采用、首次正文自动写入 Brief、策略保存中禁用 Agent、成功后允许发送；检查 1440px 与 390px 无横向溢出。
- [ ] 运行 `npm test && npm run typecheck && npm run build && python tests/creative-workspace.e2e.py && git diff --check`。
- [ ] 将最小输入、自动保存、失败重试和无外部调用边界更新到 PRD、计划、实施和验收文档。
- [ ] 提交 `docs: verify creative autosave workflow` 并推送 `main`。
