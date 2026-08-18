# 内容导入交互与多模态输出契约实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让新建创作成为独立工作态，消除取消动作歧义，并让公众号等富媒体链接读取使用稳定、可诊断的内容理解输出契约。

**Architecture:** `CreativeProjectCenter` 只负责在台账态和新建态之间切换；`ContentIngestionPanel` 只负责创建、读取和停止当前摄取任务。服务端继续使用一次 Qwen Omni 联合理解正文与媒体，但输出解析收敛到独立的规范化函数，结构错误转换为稳定业务错误并记录字段级摘要。

**Tech Stack:** React + TypeScript、Fastify、BullMQ、Node test runner、Zod、阿里云百炼 CLI `omni`。

## Global Constraints

- 不执行真实百炼付费调用。
- 不部署、不提交、不推送。
- 不改动与本任务无关的用户未提交修改。
- 不用默认标题、空摘要或伪造媒体分析结果掩盖模型失败。
- 公众号链接的正文、图片、视频必须进入同一次 Omni 联合理解调用。

### Task 1: 新建创作独立工作态

**Files:**
- Modify: `src/workspaces/create/CreativeProjectCenter.tsx`
- Modify: `src/workspaces/create/ContentIngestionPanel.tsx`
- Test: `tests/content-ingestion-ui.test.mjs`

- [ ] 写测试：创建态渲染时不渲染项目台账；读取进行中只出现“停止读取”，不出现第二个底部“取消读取”与“取消”并列；关闭按钮语义为“关闭”。
- [ ] 运行定向测试确认旧代码失败。
- [ ] 将台账渲染放入 `!creating` 分支；创建面板单独占据中心工作区。
- [ ] 将读取中的动作收敛为“停止读取”，关闭按钮调用 `onClose`，不隐式取消后台任务；文案明确关闭后的后台行为。
- [ ] 运行定向测试和类型检查。

### Task 2: 富媒体内容理解输出规范化

**Files:**
- Modify: `server/services/content-understanding.cjs`
- Modify: `server/services/rich-content-understanding.cjs`
- Test: `tests/content-ingestion.test.mjs`

- [ ] 写测试：模型返回带 fenced JSON、对象式章节、额外 `mediaInsights`/`imageAnalysis` 字段时，能规范为标准结果并保留图片/视频理解摘要；缺少 `summary` 时返回稳定错误码。
- [ ] 运行定向测试确认旧解析器失败。
- [ ] 增加 `normalizeContentUnderstandingOutput`，只对结构等价形式做明确归一，不截断有效数组、不凭空生成内容。
- [ ] 将媒体分析字段合并到 `visualClues` 或 `reusableElements`，保留来源类型标记；无效字段返回 `MODEL_OUTPUT_INVALID` 业务错误及字段路径摘要。
- [ ] 运行定向测试和完整测试。

### Task 3: 摄取错误可诊断化

**Files:**
- Modify: `server/services/content-ingestions.cjs`
- Modify: `server/worker.cjs`
- Test: `tests/content-ingestion.test.mjs`

- [ ] 写测试：模型结构失败时 ingestion 记录 `MODEL_OUTPUT_INVALID`，错误文案指向具体字段，不泄漏完整模型输出或 Zod 堆栈。
- [ ] 运行定向测试确认旧错误映射失败。
- [ ] 将结构解析错误携带稳定 `code`、`fieldPaths`，Worker 按业务错误保存摘要；任务进入 FAILED，不伪装 READY。
- [ ] 保留 API 返回 `errorCode`/`errorMessage`，前端直接展示可执行提示。
- [ ] 运行完整测试、类型检查和构建。

### Task 4: 本地验收

**Files:**
- No production changes.

- [ ] 确认本地前后端服务运行。
- [ ] 使用已登录浏览器检查创建态、关闭态和错误态；不点击真实百炼按钮。
- [ ] 运行 `npm test`、`npm run typecheck`、`npm run build`、`git diff --check`。

