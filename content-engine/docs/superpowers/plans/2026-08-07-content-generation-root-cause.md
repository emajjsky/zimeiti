# 内容生成与稳定性根因修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一阿里云 CLI 正文生成链路，隔离未核验事实、让五类正文动作只接收纯正文，并修复 502/首屏失败的真实状态传播。

**Architecture:** 以结构化事实 ID 和事实状态作为唯一安全边界，规划、研究、正文生成共享同一 WritingPacket；模型只输出正文，标题、变更说明和待核验项由服务端生成。HTTP 层保留真实 5xx，前端显式区分 loading、ready、error 并对可恢复请求重试。

**Tech Stack:** Node.js CommonJS、Fastify、BullMQ、SQLite、阿里云 Bailian CLI、React、Vite、Vitest/Node test runner。

## Global Constraints

- 正文生成、重构、润色、扩写、压缩不得调用 Tool，必须通过阿里云 CLI 开启推理并读取纯文本正文。
- Skill 只负责写作规则、账号声音和平台表达规范，不把未核验事实升级为已证实事实。
- 不使用字符串片段猜测事实引用；事实安全门只依据结构化事实 ID/状态。
- 不用 seedState 冒充后端真实状态；API 失败必须可见、可重试。
- 每个行为变更先写失败回归测试并确认失败，再写最小实现。

### Task 1: 统一事实边界与 WritingPacket

**Files:**
- Modify: `server/services/project-planning.cjs`
- Modify: `server/services/simplified-research.cjs`
- Modify: `server/services/project-copy-action.cjs`
- Test: `tests/project-copy-action.test.mjs`, `tests/planning-creative-foundation.test.mjs`, `tests/simplified-research-workflow.test.mjs`

- [x] 写回归测试：未核验主张不能同时出现在 `coreMessage` 和 `forbiddenClaims`；标题必须去除确定性结论；结构化 claim id 在 packet 中保持稳定。
- [x] 运行指定测试，确认因现有 packet 原样透传而失败。
- [x] 在规划确认和正文入口拒绝携带待核验结论的标题，并从核心表达中剔除未核验主张。
- [x] 让 `buildWritingPacket()` 输出 `verifiedClaims`、`unresolvedClaims`，正文 prompt 只消费安全后的主题和事实摘要。
- [x] 运行相关测试并确认全绿。

### Task 2: 统一五类正文动作的纯正文协议与事实安全门

**Files:**
- Modify: `server/services/project-copy-action.cjs`
- Modify: `server/worker.cjs`
- Modify: `server/services/text-model.cjs`
- Test: `tests/project-copy-action.test.mjs`, `tests/text-model.test.mjs`, `tests/copy-run-lifecycle.test.mjs`

- [x] 写失败测试：初次和修改动作均只接受正文纯文本；讨论“尚未确认”的 claim 不误判；正文中把 unresolved claim 当事实时拒绝。
- [x] 运行测试确认现有协议和事实启发式导致失败。
- [x] 修改任务模型只输出纯正文，服务端锁定标题并计算变更说明、待核验项；初次与修改共用正文验证函数。
- [x] 通过 claim 状态摘要传播事实边界，模型输出只读取 `message.content`。
- [x] 根据目标字数计算 maxTokens，避免长文被默认 1800 tokens 截断。
- [x] 运行相关测试和真实任务回归。

### Task 3: 修复 HTTP 真实错误状态和队列瞬时失败

**Files:**
- Modify: `server/index.cjs`
- Modify: `server/queue.cjs`
- Test: `tests/http-errors.test.mjs`, `tests/copy-run-lifecycle.test.mjs`

- [x] 写失败测试：业务 500/502/503/504 保留原状态；模型/网络瞬时失败按任务级策略重试并记录最终原因。
- [x] 运行测试确认当前统一映射为 400 且队列无 attempts/backoff。
- [x] 保留 Fastify 错误的真实 statusCode，仅对未知错误使用 500；为正文任务设置有限 attempts 和指数退避，并只在最终尝试写 FAILED。
- [x] 运行相关测试。

### Task 4: 首屏加载、Agent 轮询和开发启动健康状态

**Files:**
- Modify: `src/data/localRepository.ts`
- Modify: `src/main.tsx`
- Modify: `src/data/webApi.ts`
- Modify: `src/workspaces/create/ProjectAgent.tsx`
- Modify: `package.json`, `vite.config.ts`, `启动内容引擎.cmd`
- Test: `tests/web-runtime.test.mjs`, `tests/workspace-context.test.mjs`, `tests/project-agent-foundation.test.mjs`

- [x] 以现有运行时回归和首屏/Agent 调用链为失败基线，确认首屏 catch 后仍渲染 seedState 且重试覆盖不足。
- [x] 运行相关测试确认旧链路存在上述问题。
- [x] 建立明确的 `loading/ready/error` 状态，失败时不渲染伪造数据；首屏、Agent 上下文和运行查询接入统一瞬时错误重试。
- [x] 保存 React root 单例；开发 API 进程不再 watch 重启，避免代理目标被主动切断。
- [x] 运行前端测试、构建和类型检查。

### Task 5: 清理遗留协议与不可达代码

本轮先不删除仍被现有单元测试直接覆盖的历史领域模块；正文旧分段协议已从生产 Worker 脱离，待专门迁移测试后再移除兼容解析器。

**Files:**
- Modify/Delete: `server/services/project-copy-action.cjs`（迁移测试后删除未使用旧协议导出）
- Delete: `src/domain/channel-workflow.mjs`, `src/domain/project-agent-composer.mjs`, `src/domain/research-source-selection.mjs`, `src/domain/stateMachine.ts`, `src/domain/writing-brief-platforms.mjs`（仅在依赖确认后）
- Test: 受影响测试文件

- [ ] 先生成模块依赖清单并确认无运行时/测试引用。
- [ ] 写/迁移必要测试，删除旧协议和不可达文件。
- [ ] 运行全量测试、构建、类型检查，确认无残留测试和垃圾代码。

### Task 6: 真实链路验证与交付

- [ ] 用真实项目样本运行内容生成、重构、润色、扩写、压缩各一遍（当前环境未重复调用真实模型额度）。
- [ ] 检查数据库中的 packet、claim 状态、正文和错误记录（保留给接入真实模型后的链路验收）。
- [x] 检查首屏 API 健康状态、API 进程启动冲突和 502 重试行为。
- [x] 全量测试、构建、类型检查通过；提交和推送等待用户确认。
