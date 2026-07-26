# AI 热点分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让用户用任务策略指定的真实文本模型，完成单条资讯到确认卡、五维热点分析和选题预填的 Web 闭环。

**Architecture:** 独立分析服务负责评分、Schema、提示词拼装和持久化；Fastify 负责模板与确认接口；BullMQ Worker 负责调用模型和写入运行记录。前端只扩展现有设置页和热点详情抽屉。

**Tech Stack:** React、TypeScript、Vite、Fastify、PostgreSQL、BullMQ、Redis、Zod、Node test、百炼 CLI、OpenAI 兼容 API。

## Global Constraints

- 第一版只支持单条资讯，不实现批量分析、聚类或多 Agent 评审。
- 只能使用 INTELLIGENCE_ANALYSIS 任务策略；不得硬编码模型名。
- Key 只在服务端解密使用，浏览器不读取或回显。
- 系统约束、来源要求和 JSON Schema 不可编辑；用户只编辑业务提示词。
- 综合分由服务端按 20/25/25/15/15 计算，平台适配分不参与综合分。
- 格式错误只允许一次修复；失败或取消不得覆盖上次成功结果。
- 所有模板、运行、分析和查询都必须按 workspace_id 隔离。
- 前端只修改设置页和详情抽屉，不增加一级导航或假模板功能。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| server/migrations/007_intelligence_analysis.sql | 模板版本和正式分析表、索引与约束。 |
| server/services/intelligence-analysis.cjs | 评分、Schema、提示词分层、模板和分析读写。 |
| server/services/text-model.cjs | 根据策略调用百炼 CLI 或外部 OpenAI 兼容文本 API。 |
| server/worker.cjs | 执行已确认的热点分析任务，记录运行和用量。 |
| server/index.cjs | 模板、准备、确认、取消、最新结果 API。 |
| src/domain/content.ts | 分析结果和工作空间定位类型。 |
| src/data/webApi.ts | 前端模板与分析 API 客户端。 |
| src/workspaces/settings/PromptTemplateSettings.tsx | 可编辑热点分析模板。 |
| src/workspaces/settings/WorkspaceProfileSettings.tsx | 账号定位与目标受众。 |
| src/workspaces/discover/IntelligenceInbox.tsx | 平台勾选、确认、轮询、结果和选题预填。 |
| tests/intelligence-analysis.test.mjs | 评分、Schema、模板变量测试。 |
| tests/text-model.test.mjs | 策略路由和外部响应解析测试。 |
| tests/intelligence-analysis-api.test.mjs | 准备、确认、取消、失败保护测试。 |

## Task 1: 分析契约与评分规则

**Files:**
- Create: server/services/intelligence-analysis.cjs
- Create: tests/intelligence-analysis.test.mjs

**Interfaces:**
- Produces: calculateOverallScore(dimensions), decisionForScore(score), validateAnalysisOutput(output, platforms), validateTemplate(body), buildAnalysisPrompt(input).

- [ ] Step 1: 写失败测试

~~~js
test('按固定权重计算综合分并返回建议状态', () => {
  const score = analysis.calculateOverallScore({
    timeliness: { score: 80 }, accountFit: { score: 90 }, contentValue: { score: 70 },
    spreadPotential: { score: 60 }, feasibilityAndSafety: { score: 100 },
  });
  assert.equal(score, 80);
  assert.equal(analysis.decisionForScore(score), 'FOLLOW');
});

test('拒绝与用户勾选平台不一致的模型结果', () => {
  assert.throws(
    () => analysis.validateAnalysisOutput({ platforms: [{ platform: 'WECHAT', fitScore: 80, recommendedFormat: '解读', reason: '适合' }] }, ['XIAOHONGSHU']),
    /平台/,
  );
});
~~~

- [ ] Step 2: 运行 node --test tests/intelligence-analysis.test.mjs，确认因模块不存在而失败。
- [ ] Step 3: 实现固定权重、FOLLOW/WATCH/SKIP 阈值、五维和平台结果 Schema、变量白名单和三层提示词拼装。限制角度 3 条、风险和待核验项各 5 条、分数 0-100。
- [ ] Step 4: 再次运行 node --test tests/intelligence-analysis.test.mjs，确认通过。
- [ ] Step 5: 提交 feat: add intelligence analysis contract。

## Task 2: 数据迁移与工作空间定位

**Files:**
- Create: server/migrations/007_intelligence_analysis.sql
- Modify: src/data/localRepository.ts
- Modify: src/domain/content.ts
- Modify: src/workspaces/settings/WorkspaceProfileSettings.tsx
- Test: tests/intelligence-analysis.test.mjs

**Interfaces:**
- Consumes: Task 1 的模板校验。
- Produces: WorkspaceProfile.accountPositioning、WorkspaceProfile.targetAudience、prompt_template_versions、intelligence_analyses。

- [ ] Step 1: 为未知提示词变量和超过 12000 字符写失败测试。
- [ ] Step 2: 运行 node --test tests/intelligence-analysis.test.mjs，确认失败。
- [ ] Step 3: 创建迁移。prompt_template_versions 按 workspace_id、scope、version 唯一；intelligence_analyses 关联 workspace、intelligence_item、generation_run，保存平台、输出、综合分、建议状态，并为最近成功结果建立索引。
- [ ] Step 4: 扩展 WorkspaceProfile 和工作空间设置。账号定位、目标受众为空时允许保存；确认卡必须标记按通用受众分析。主要题材为空时不得准备任务。
- [ ] Step 5: 运行 node --test tests/intelligence-analysis.test.mjs，确认通过；提交 feat: add analysis storage and workspace profile。

## Task 3: 模板 API 与设置界面

**Files:**
- Modify: server/index.cjs
- Modify: src/data/webApi.ts
- Create: src/workspaces/settings/PromptTemplateSettings.tsx
- Modify: src/main.tsx
- Modify: src/styles.css
- Test: tests/intelligence-analysis-api.test.mjs

**Interfaces:**
- Consumes: Task 1 的 validateTemplate 和 Task 2 的模板表。
- Produces: GET、PUT、reset 热点分析模板 API 和模型设置页签。

- [ ] Step 1: 写失败测试：保存自定义模板后 reset 默认模板创建版本 2，版本 1 仍可查询。
- [ ] Step 2: 运行 node --test tests/intelligence-analysis-api.test.mjs，确认失败。
- [ ] Step 3: 实现 GET/PUT /settings/prompt-templates/INTELLIGENCE_ANALYSIS 与 POST reset。其它 Scope 返回尚未接入执行器。
- [ ] Step 4: 在现有 ModelSettingsScreen 增加提示词模板页签；展示 textarea、变量清单、版本、保存和恢复默认。不得显示固定系统提示词。
- [ ] Step 5: 运行 node --test tests/intelligence-analysis-api.test.mjs 和 npm run typecheck；提交 feat: add editable intelligence analysis prompts。

## Task 4: 统一文本执行器与 Worker

**Files:**
- Create: server/services/text-model.cjs
- Modify: server/services/intelligence-analysis.cjs
- Modify: server/worker.cjs
- Test: tests/text-model.test.mjs
- Test: tests/intelligence-analysis-api.test.mjs

**Interfaces:**
- Consumes: INTELLIGENCE_ANALYSIS 策略、服务端加密凭据、模板和资讯快照。
- Produces: runText(input) 返回 content 与 token；INTELLIGENCE_ANALYSIS Worker 写运行、用量和正式结果。

- [ ] Step 1: 写失败测试：BAILIAN_CLI 使用现有 CLI，EXTERNAL_API 使用连接的 chat/completions，二者解析出同一 content。
- [ ] Step 2: 运行 node --test tests/text-model.test.mjs，确认失败。
- [ ] Step 3: 实现 runText。百炼路径调用 runBailianCli；外部路径请求 baseUrl/chat/completions 并用服务端解密的 Bearer Key。两条路径均不得输出 Key。
- [ ] Step 4: Worker 增加 INTELLIGENCE_ANALYSIS：调用模型、校验 JSON，首次结构错误仅请求一次修复，成功写 intelligence_analyses 和 generation_runs，成功/失败均写 api_usage_logs。
- [ ] Step 5: 运行 node --test tests/text-model.test.mjs tests/intelligence-analysis-api.test.mjs；提交 feat: execute intelligence analysis jobs。

## Task 5: 分析准备、确认、取消与查询 API

**Files:**
- Modify: server/index.cjs
- Modify: server/services/intelligence-analysis.cjs
- Modify: src/data/webApi.ts
- Test: tests/intelligence-analysis-api.test.mjs

**Interfaces:**
- Consumes: Task 2 数据和 Task 4 Worker 任务契约。
- Produces: prepare、confirm、cancel、latest API。

- [ ] Step 1: 写失败测试：prepare 创建 DRAFT 且不入队；cancel 后 latest 仍返回之前成功结果。
- [ ] Step 2: 运行 node --test tests/intelligence-analysis-api.test.mjs，确认失败。
- [ ] Step 3: 实现 POST /intelligence/items/:id/analyses/prepare，校验资讯、平台、题材、模板、策略和凭据，返回确认卡。
- [ ] Step 4: 实现 POST /generation-runs/:id/confirm、cancel 和 GET /intelligence/items/:id/analyses/latest。confirm 原子更新为 QUEUED、创建 jobs(INTELLIGENCE_ANALYSIS) 并 enqueue；价格未知返回 null，受众缺失返回 generalAudienceWarning。
- [ ] Step 5: 运行 node --test tests/intelligence-analysis-api.test.mjs；提交 feat: add analysis confirmation workflow。

## Task 6: 热点详情闭环与选题预填

**Files:**
- Modify: src/domain/content.ts
- Modify: src/data/localRepository.ts
- Modify: src/data/webApi.ts
- Modify: src/main.tsx
- Modify: src/workspaces/discover/IntelligenceInbox.tsx
- Modify: src/styles.css
- Test: tests/web-workspace-navigation.test.mjs

**Interfaces:**
- Consumes: Task 5 的确认卡、任务状态、最新结果 API。
- Produces: 平台勾选、确认、轮询、五维结果和分析驱动的选题预填。

- [ ] Step 1: 写失败测试：详情源码包含平台选择、确认分析和 overallScore 展示。
- [ ] Step 2: 运行 node --test tests/web-workspace-navigation.test.mjs，确认失败。
- [ ] Step 3: 用 prepare → confirm → jobs 轮询 → latest 替换当前 AI 分析占位错误。默认勾选已启用平台。
- [ ] Step 4: 在抽屉展示综合分/状态、五条等高评分条、最多三项可选角度、勾选平台建议和非空风险区。使用现有组件与色彩变量，不在卡片内嵌卡片。
- [ ] Step 5: 创建选题时使用选中角度的标题和观点、分析返回的平台和待核验项；未分析时保留现有人工创建。
- [ ] Step 6: 运行 node --test tests/web-workspace-navigation.test.mjs、npm run typecheck、npm run build；提交 feat: add intelligence analysis workspace flow。

## Task 7: 真实验收与文档收尾

**Files:**
- Modify: docs/01_PRD_内容引擎.md
- Modify: docs/02_PLAN_内容引擎.md
- Modify: docs/03_IMPLEMENT_内容引擎.md
- Modify: docs/04_ACCEPTANCE_LOG_内容引擎.md

- [ ] Step 1: 运行 npm test、npm run typecheck、npm run build、node --check server/index.cjs、node --check server/worker.cjs、node --check server/services/intelligence-analysis.cjs、node --check server/services/text-model.cjs、git diff --check。
- [ ] Step 2: 使用真实可用文本模型，修改一次模板后分析真实热点，勾选两个平台，验证确认卡、评分、角度、平台建议、调用记录和选题预填。
- [ ] Step 3: 更新四份文档。真实模型权限失败时只记录实际失败原因，不标记通过。
- [ ] Step 4: 提交 docs: record intelligence analysis acceptance 并推送 origin/main。

## Plan Self-Review

- [x] 覆盖五维评分、平台勾选、提示词分层、模型策略、确认卡、Worker、运行记录、失败保护、选题预填和真实验收。
- [x] 每个业务任务都有失败测试、最小实现和验证步骤。
- [x] 类型与接口名称在后续任务中保持一致。
- [x] 没有占位步骤、假模板功能或新增一级导航。

