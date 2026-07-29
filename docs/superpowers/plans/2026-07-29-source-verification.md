# 来源筛选与事实核验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从已保存来源中选择可信材料，并在确认调用后生成可追溯的事实核验结论。

**Architecture:** 来源执行阶段补充质量元数据和推荐选择。独立 `SOURCE_VERIFICATION` 服务负责严格输出契约，API 使用 prepare/confirm 两段式运行，Worker 保存核验产物。现有项目 Agent 负责选择、确认卡、运行状态、结果预览和采用。

**Tech Stack:** React 19、TypeScript、Fastify、PostgreSQL、BullMQ、Zod、Node test、Playwright Python。

## Global Constraints

- 纯 Web，不恢复桌面端。
- 未经用户确认不得调用模型。
- 未选来源不得进入模型上下文。
- 未核验来源不得伪装成事实。
- 前端保持 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 7`。
- 页面不增加冗余说明，不增加假入口。

---

### Task 1: 来源质量与选择契约

**Files:**
- Create: `content-engine/server/migrations/020_source_verification.sql`
- Modify: `content-engine/server/services/project-research-sources.cjs`
- Modify: `content-engine/server/services/tavily.cjs`
- Modify: `content-engine/server/worker.cjs`
- Test: `content-engine/tests/project-research-sources.test.mjs`

**Interfaces:**
- Produces: 来源 `metadata`、`selected`、`recommendSourceSelection(sources, limit)`。

- [ ] 写失败测试：搜索结果保留相关度、语言、发布时间和来源类型，推荐选择最多八条且优先官方高相关来源。
- [ ] 运行 `node --test tests/project-research-sources.test.mjs`，确认因缺少字段和函数失败。
- [ ] 实现最小来源归一化、排序、持久化和迁移。
- [ ] 再次运行测试，确认通过。

### Task 2: 核验模型服务与后端运行

**Files:**
- Create: `content-engine/server/services/source-verification.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-agent.cjs`
- Modify: `content-engine/src/domain/integrations.ts`
- Modify: `content-engine/src/main.tsx`
- Test: `content-engine/tests/source-verification.test.mjs`

**Interfaces:**
- Produces: `SOURCE_VERIFICATION_VERSION`、`buildSourceVerificationPrompt(input)`、`parseSourceVerification(content, context)`。
- Produces: `POST /creative/projects/:projectId/research/verification/prepare`、`POST /creative/source-verification-runs/:id/confirm|cancel`。

- [ ] 写失败测试：严格状态、来源 ID、引用归属和单来源状态校验。
- [ ] 运行单测，确认因服务不存在失败。
- [ ] 实现 Zod 契约、Prompt、修复 Prompt 和模型任务 Scope。
- [ ] 写失败契约测试：prepare 不入队，confirm 才入队，Agent 能恢复核验活动运行。
- [ ] 实现路由、Worker、持久化、调用日志和产物。
- [ ] 运行相关测试，确认通过。

### Task 3: 来源选择和核验结果交互

**Files:**
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/styles.css`
- Test: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes: 来源质量字段、核验 prepare/confirm API、`RESEARCH_VERIFICATION` 产物。

- [ ] 写失败浏览器测试：来源可勾选和批量选择，零选择禁用，prepare 显示模型和来源数，刷新恢复。
- [ ] 运行浏览器测试，确认选择工具条和核验按钮缺失。
- [ ] 实现来源选择列表、批量操作、核验确认卡、运行状态和结果预览。
- [ ] 校验 1440px 与 390px 无横向溢出、按钮可达、无重叠。

### Task 4: 文档、全量验证与交付

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

- [ ] 同步产品边界、实施状态、下一步和验收日志。
- [ ] 运行 `npm test`、`npm run typecheck`、`npm run build`、`python tests/creative-workspace.e2e.py`、`npm audit --omit=dev`、`git diff --check`。
- [ ] 重启 API、Web、Worker并检查 `/health`。
- [ ] 提交并推送 `main`，给出用户验收路径。
