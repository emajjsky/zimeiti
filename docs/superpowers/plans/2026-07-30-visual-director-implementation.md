# 视觉导演 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有配图提示词页面升级为支持结构判断、风格继承、模板、参考图和真实图生图的视觉导演工作台。

**Architecture:** `visual-plan.mjs` 负责纯函数形式的结构判断、默认方案与提示词编译，React 工作台只编辑结构化方案并触发真实 API。最终图片和参考图继续复用项目素材库，服务端根据是否携带参考图选择百炼 CLI 的 `image generate` 或 `image edit`。

**Tech Stack:** React、TypeScript、Node.js、Fastify、Zod、百炼 CLI、Node test runner、Playwright。

## Global Constraints

- 页面不得自动搜索或自动生成图片。
- 项目默认风格可被单张图覆盖，单张图可恢复继承。
- 提示词只出现在高级设置。
- 视觉方案版本为 4，升级不得丢失已绑定最终图片。
- 参考图最多三张，并明确参考维度。

---

### Task 1: 视觉导演领域模型

**Files:**
- Modify: `content-engine/src/domain/content.ts`
- Modify: `content-engine/src/domain/visual-plan.mjs`
- Modify: `content-engine/src/domain/visual-plan.d.mts`
- Test: `content-engine/tests/visual-plan.test.mjs`

**Interfaces:**
- Produces: `visualStylePresets()`、`visualTemplatesFor(type)`、`updateVisualPlanItem(item, patch, context, styleProfile)`。
- Produces: `CreativeVisualStyleProfile` 和扩展后的 `CreativeVisualPlanItem`。

- [ ] **Step 1: Write the failing tests**

新增断言覆盖思维导图、流程图、时间线、对比图的自动判断，项目风格继承、单图覆盖和提示词重新编译，以及 v3 方案升级保留绑定。

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/visual-plan.test.mjs`
Expected: FAIL，缺少新视觉类型、继承字段和编译函数。

- [ ] **Step 3: Implement the domain model**

将方案版本升级为 4；增加视觉类型、风格预设、各类型模板、`sourceExcerpt`、`contentBlocks`、`references`；用正文信号选择结构并将结构、风格、模板、参考维度编译进提示词。

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/visual-plan.test.mjs`
Expected: PASS。

### Task 2: 保存协议与真实参考图生成

**Files:**
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/data/webApi.ts`
- Test: `content-engine/tests/delivery-workflow.test.mjs`

**Interfaces:**
- Consumes: `CreativeVisualPlanItem.references`。
- Produces: `generateImage(projectId, { platform, prompt, size, referenceImageIds })`。

- [ ] **Step 1: Write the failing API contract tests**

断言保存 schema 接受新字段，生成接口接受最多三张参考图，并存在 `image edit` 与 `IMAGE_TO_IMAGE` 调用路径。

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/delivery-workflow.test.mjs`
Expected: FAIL，服务端尚无参考图协议。

- [ ] **Step 3: Implement validation and CLI routing**

扩展 Zod schema；通过 `researchSnapshot(workspaceId, projectId, [], referenceImageIds)` 校验项目图片；无参考图执行 `image generate`，有参考图执行 `image edit` 并追加多个 `--image` 参数；调用日志记录真实任务类型。

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/delivery-workflow.test.mjs`
Expected: PASS。

### Task 3: 视觉导演工作台

**Files:**
- Modify: `content-engine/src/workspaces/create/VisualWorkspace.tsx`
- Modify: `content-engine/src/styles.css`
- Test: `content-engine/tests/visual-workspace.e2e.py`

**Interfaces:**
- Consumes: `visualStylePresets()`、`visualTemplatesFor(type)`、`updateVisualPlanItem(...)`。
- Produces: 可编辑并自动保存的项目风格、单图结构、模板、策划内容与参考图选择。

- [ ] **Step 1: Extend the E2E expectations**

验收项目默认风格下拉、视觉结构和模板下拉、策划折叠区、参考图选择、参考维度、图生图请求，以及刷新恢复。

- [ ] **Step 2: Run E2E to verify it fails**

Run: `python tests/visual-workspace.e2e.py`
Expected: FAIL，页面尚无视觉导演控件。

- [ ] **Step 3: Implement the workspace**

头部加入项目默认风格；AI 生图区加入结构、模板、继承风格、参考图与比例；策划内容和高级提示词分层折叠；所有结构化改动重新编译提示词并沿用 650ms 自动保存。

- [ ] **Step 4: Apply production UI styling**

保持现有波普怀旧清新视觉，使用紧凑表单、清晰选择态和稳定三栏/单栏响应式布局；不平铺全部选项，不添加功能说明文本。

- [ ] **Step 5: Run E2E**

Run: `python tests/visual-workspace.e2e.py`
Expected: PASS，1440px 与 390px 均无横向溢出。

### Task 4: 回归、文档和交付

**Files:**
- Modify: `01_PRD_内容引擎.md`
- Modify: `02_PLAN_内容引擎.md`
- Modify: `03_IMPLEMENT_内容引擎.md`
- Modify: `04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Consumes: Tasks 1-3 的最终行为。

- [ ] **Step 1: Run all automated tests**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 2: Run type and production builds**

Run: `npm run typecheck`
Expected: PASS。

Run: `npm run build`
Expected: PASS。

- [ ] **Step 3: Run the visual E2E and inspect screenshots**

Run: `python tests/visual-workspace.e2e.py`
Expected: PASS，并生成桌面与移动截图。

- [ ] **Step 4: Update project documents**

记录视觉导演的数据结构、真实调用链、版本兼容、测试结果和用户验收路径。

- [ ] **Step 5: Commit and push**

Run: `git add content-engine docs 01_PRD_内容引擎.md 02_PLAN_内容引擎.md 03_IMPLEMENT_内容引擎.md 04_ACCEPTANCE_LOG_内容引擎.md && git commit -m "feat: add visual director workflow" && git push origin main`
Expected: `main` 推送成功。
