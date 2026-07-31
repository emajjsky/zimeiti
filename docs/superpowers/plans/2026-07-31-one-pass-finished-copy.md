# One-Pass Finished Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首次正文生成改为核心 Agent 自动准备上下文、只调用一次写作模型并直接保存正式正文的完整链路。

**Architecture:** Worker 复用已有研究能力补齐上下文，再通过纯净 `WritingPacket` 隔离研究证据与最终写作。首次生成走 `ACCEPTED` 事务落库；用户主动修改才走可采用或放弃的 `CANDIDATE`，两条路径均不再调用 AI 审稿、声音重写或自动复审。

**Tech Stack:** Node.js CommonJS Worker、PostgreSQL、React + TypeScript、Node test runner、Vite。

**Execution Status:** 已完成实现与迁移；自动研究失败降级、完整回归和推送结果记录在 `docs/04_ACCEPTANCE_LOG_内容引擎.md` 的 A68。

## Global Constraints

- 当前会话直接在 `main` 实施，用户已明确授权，不创建分支或 worktree。
- 首次正文最终写作模型只调用一次，返回后不得调用 AI 修复、审稿、重写或复审。
- 用户不承担补齐资料的前置工作；Agent 按需复用已有研究或调用检索、读取、核验能力。
- 首次生成成功后正式正文必须直接进入编辑器并自动保存，产物状态直接为 `ACCEPTED`。
- 写作模型只接收顶层已核验事实，不接收 evidence quote 中未提升的旁支事实。
- 用户主动修改已有正文时保留候选差异，由用户选择“采用修改”或“放弃修改”。

---

### Task 1: 写作资料包与最终成稿契约

**Files:**
- Modify: `content-engine/server/services/project-copy-action.cjs`
- Test: `content-engine/tests/project-copy-action.test.mjs`

**Interfaces:**
- Produces: `buildWritingPacket(snapshot, preparedResearch?)`、`buildFinishedCopyPrompt(packet, template)`、`parseFinishedCopyBody(content, packet)`、`validateFinishedCopyBody(body, packet)`。

- [ ] 写失败测试，证明资料包只保留顶层已核验主张及来源 ID，不携带 evidence quote 和旧审稿信息。
- [ ] 运行 `node --test tests/project-copy-action.test.mjs`，确认因新接口不存在或旧上下文泄漏而失败。
- [ ] 实现资料包、纯文本 Prompt、解析与确定性校验；标题始终来自规划锁定标题。
- [ ] 重跑测试，确认新契约通过且既有状态应用测试无回归。

### Task 2: 首次正文单次生成与自动上下文准备

**Files:**
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-copy-action.cjs`
- Test: `content-engine/tests/project-copy-action.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `WritingPacket` 与最终成稿契约。
- Produces: `GENERATE_DRAFT` 的 `LOAD_CONTEXT -> RESEARCH_IF_NEEDED -> BUILD_WRITING_PACKET -> WRITE_FINAL_COPY` 执行路径。

- [ ] 写失败测试，证明首次生成不进入 repair、声音修正、质量审稿、自动重写或复审分支。
- [ ] 写失败测试，证明无可用研究时会复用现有研究函数准备上下文，并且最终写作只执行一次。
- [ ] 运行目标测试，确认旧 Worker 多次调用链路导致失败。
- [ ] 抽取自动上下文准备 helper；已有可靠研究优先复用，外部事实不足时按需研究，个人观点型内容不强制联网。
- [ ] 将首次生成改为单次纯文本成稿与本地技术校验；修改动作保留一次模型调用但不审稿。
- [ ] 重跑目标测试。

### Task 3: 首次正文直接正式落库

**Files:**
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-agent.cjs`
- Test: `content-engine/tests/project-copy-action.test.mjs`

**Interfaces:**
- Consumes: `applyAcceptedCopyToState(state, input)` 与 `updateCreativeState(client, workspaceId, mutate, now)`。
- Produces: 同一任务内创建 `ACCEPTED` 产物、正式内容版本并更新 `workspace_snapshots`。

- [ ] 写失败测试，证明首次生成产物状态为 `ACCEPTED` 且正式正文快照同步更新。
- [ ] 运行目标测试，确认旧实现仅创建 `CANDIDATE` 而失败。
- [ ] 在同一数据库事务中写入产物、版本和项目快照，并设置 `accepted_at`。
- [ ] 保持主动修改动作创建 `CANDIDATE`，不覆盖当前正式正文。
- [ ] 重跑目标测试。

### Task 4: 候选采用语义与历史兼容

**Files:**
- Modify: `content-engine/server/index.cjs`
- Create: `content-engine/server/migrations/023_finished_copy_workflow.sql`
- Test: `content-engine/tests/simplified-research-workflow.test.mjs`
- Test: `content-engine/tests/project-copy-action.test.mjs`

**Interfaces:**
- Produces: 新修改候选不受历史 `qualityReview.status` 阻断；旧 `NEEDS_REVIEW` 正文候选保留内容并迁移为 `REJECTED`。

- [ ] 写失败测试，证明采用接口不再读取 `qualityReview` 作为门禁，迁移只改变历史候选状态。
- [ ] 运行目标测试，确认旧门禁仍存在而失败。
- [ ] 移除采用门禁并增加幂等迁移。
- [ ] 重跑目标测试。

### Task 5: 前端首次生成与主动修改状态

**Files:**
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/workspaces/create/CopyWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CopyCandidateDialog.tsx`
- Modify: `content-engine/src/domain/copy-action-panel.mjs`
- Test: `content-engine/tests/creative-workflow.test.mjs`
- Test: `content-engine/tests/copy-action-panel.test.mjs`

**Interfaces:**
- Produces: 首次生成成功后刷新项目并显示编辑器正文；主动修改候选显示“采用修改/放弃修改”。

- [ ] 写失败测试，证明首次生成不显示“正文候选”“查看并采用”“正式文稿尚未改变”或审核提示。
- [ ] 写失败测试，证明运行中只显示准备资料/生成正文，修改候选使用新的操作文案。
- [ ] 运行前端契约测试，确认旧 UI 语义导致失败。
- [ ] 实现项目刷新回调和两条候选路径的 UI 区分。
- [ ] 重跑前端契约测试、类型检查与构建。

### Task 6: 文档、回归与交付

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Produces: 与已实现链路一致的产品、计划、实现和验收记录。

- [ ] 更新四份项目文档，删除首次生成需要候选审核或 AI 自动复审的旧描述。
- [ ] 运行目标测试、全量 `npm test`、`npm run typecheck`、`npm run build`、三个 Node 语法检查、创作工作台 E2E 与 `git diff --check`。
- [ ] 检查 Worker 已恢复运行且日志出现“Content Engine Worker 已启动”。
- [ ] 提交实现并推送 `main` 到 `emajjsky/zimeiti.git`。
