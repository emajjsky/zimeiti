# 富内容理解、标题建议与视频拉片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一解读型任务的多模态调用，修正 Qwen 模型能力分类，在文案助手增加成稿标题建议，移除内容预检，并新增仅支持上传文件的视频拉片与关键帧素材链路。

**Architecture:** 服务端新增无业务语义的富内容执行器，业务任务只负责组装内容包、提示词和结果 Schema。视频拉片复用现有素材上传与队列，百炼 Omni 负责时间轴理解，FFmpeg 负责关键帧截取；标题建议复用草稿 revision 和 PATCH 保存机制。

**Tech Stack:** React、TypeScript、Fastify、Node.js、PostgreSQL、BullMQ、Zod、阿里云百炼 CLI、FFmpeg、Node test runner。

## Global Constraints

- 所有解读型任务把正文、图片、视频和音频放入同一次 `bl omni` 调用。
- 不静默降级为纯文本调用。
- Qwen 3.6—3.8 多模态能力与目录能力合并，不被旧目录标签覆盖。
- 标题建议只在文案助手中基于当前正文和配图生成。
- 完整删除 `CONTENT_PREFLIGHT_REVIEW` 链路。
- 视频拉片首版只支持上传本地视频文件，不实现视频链接读取。
- 视频关键帧由 FFmpeg 截取并作为素材入库。
- 用户选择的创作素材最多 9 个。
- 所有生产代码遵循测试先行。
- 本地验证通过前不部署服务器，不主动执行计费模型调用。

---

### Task 1: 统一模型能力判定

**Files:**
- Modify: `server/index.cjs`
- Modify: `src/main.tsx`
- Modify: `src/domain/integrations.ts`
- Test: `tests/model-settings-layout.test.mjs`
- Test: `tests/content-ingestion.test.mjs`

**Interfaces:**
- Produces: `classifyModelCapabilities(model, catalogCapabilities)` 的等价服务端规则。
- Produces: 前端 `modelSupportsTask(item, task)` 与服务端能力要求一致。

- [ ] **Step 1: 写失败测试**

新增断言：远端目录仅返回 `TEXT` 时，`qwen3.6-*`、`qwen3.7-*`、`qwen3.8-max` 最终仍包含 `TEXT`、`IMAGE`、`VIDEO`、`VISION`、`MULTIMODAL`；普通纯文本模型不被误标。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests/model-settings-layout.test.mjs tests/content-ingestion.test.mjs`

- [ ] **Step 3: 实现能力合并规则**

将目录能力与本地可信识别结果做集合合并；为富内容任务定义统一的多模态要求，前端筛选和后端策略校验使用相同语义。

- [ ] **Step 4: 运行专项测试**

Run: `node --test tests/model-settings-layout.test.mjs tests/content-ingestion.test.mjs`

---

### Task 2: 抽取统一富内容执行器

**Files:**
- Create: `server/services/rich-content-understanding.cjs`
- Modify: `server/services/content-understanding.cjs`
- Modify: `server/worker.cjs`
- Test: `tests/content-ingestion.test.mjs`

**Interfaces:**
- Produces: `normalizeRichContentPackage(input)`。
- Produces: `buildRichContentOmniArgs({ model, system, message, content, maxTokens })`。
- Produces: `parseStructuredOmniOutput(raw, schema, label)`。

- [ ] **Step 1: 写富内容规范化和 CLI 参数失败测试**

测试正文、图片、视频、音频在一个参数数组中；重复媒体去重；无效媒体类型不进入调用；本地素材使用安全绝对路径。

- [ ] **Step 2: 运行测试并确认失败原因是接口不存在**

Run: `node --test tests/content-ingestion.test.mjs`

- [ ] **Step 3: 实现最小统一执行器**

执行器只处理内容包、媒体参数和结构化输出，不包含热点、声音、标题等业务提示词。

- [ ] **Step 4: 将现有内容理解改为调用统一执行器**

删除 `content-understanding.cjs` 内重复的 Omni 参数拼装，保留内容解读 Schema 和提示词。

- [ ] **Step 5: 运行专项测试**

Run: `node --test tests/content-ingestion.test.mjs`

---

### Task 3: 改造热点、声音、配图与模板分析的富媒体输入

**Files:**
- Modify: `server/services/public-web.cjs`
- Modify: `server/services/browser-reader.cjs`
- Modify: `server/services/visual-planning.cjs`
- Modify: `server/services/wechat-layout-templates.cjs` or current template analysis service
- Modify: `server/worker.cjs`
- Test: `tests/intelligence-analysis.test.mjs`
- Test: `tests/voice-calibration.test.mjs`
- Test: `tests/visual-planning.test.mjs`
- Test: `tests/wechat-layout-templates.test.mjs`

**Interfaces:**
- Consumes: Task 2 的统一富内容执行器。
- Produces: 各任务的冻结 `RichContentPackage` 和原有结构化业务结果。

- [ ] **Step 1: 分别写四类任务的失败测试**

每个测试断言调用参数同时包含完整正文与关联媒体；热点任务不再只传标题摘要；模板分析包含结构信号和截图。

- [ ] **Step 2: 运行四组测试并确认失败**

Run: `node --test tests/intelligence-analysis.test.mjs tests/voice-calibration.test.mjs tests/visual-planning.test.mjs tests/wechat-layout-templates.test.mjs`

- [ ] **Step 3: 逐任务接入统一执行器**

保留现有输出 Schema 与业务流程，只替换输入准备和模型调用边界。

- [ ] **Step 4: 运行四组专项测试**

Run: `node --test tests/intelligence-analysis.test.mjs tests/voice-calibration.test.mjs tests/visual-planning.test.mjs tests/wechat-layout-templates.test.mjs`

---

### Task 4: 将选题建议改造成文案助手标题建议

**Files:**
- Modify: `src/domain/integrations.ts`
- Modify: `server/services/content-understanding.cjs`
- Modify: `server/routes/content-drafts.cjs`
- Modify: `server/index.cjs`
- Modify: `src/data/webApi.ts`
- Modify: current copy assistant component under `src/workspaces/create/`
- Modify: `src/styles.css`
- Test: `tests/content-drafts.test.mjs`
- Test: `tests/copy-action-panel.test.mjs`
- Test: `tests/content-ingestion.test.mjs`

**Interfaces:**
- Produces: `POST /api/v1/content-drafts/:draftId/title-recommendations`。
- Produces: `{ draftId, revision, recommendations, policy }`。
- Produces: `TITLE_RECOMMENDATION` 模型任务。

- [ ] **Step 1: 写服务端失败测试**

覆盖：正文为空返回 400；revision 冲突返回 409 且不调用模型；合法草稿传入正文和素材并返回 3—5 个标题。

- [ ] **Step 2: 运行服务端测试确认失败**

Run: `node --test tests/content-drafts.test.mjs`

- [ ] **Step 3: 实现标题建议 Schema、提示词和接口**

候选结构仅包含 `title` 和 `angle`；替换标题继续使用现有 PATCH，不增加第二套保存逻辑。

- [ ] **Step 4: 写前端失败测试**

覆盖正文为空禁用、生成状态、替换标题、放弃、正文变化后候选过期。

- [ ] **Step 5: 实现文案助手候选面板**

移除内容导入阶段的自动选题建议调用与展示。

- [ ] **Step 6: 运行标题建议专项测试**

Run: `node --test tests/content-drafts.test.mjs tests/copy-action-panel.test.mjs tests/content-ingestion.test.mjs`

---

### Task 5: 完整删除内容预检

**Files:**
- Delete: `server/services/content-preflight.cjs`
- Delete: `tests/content-preflight.test.mjs`
- Modify: `server/routes/content-drafts.cjs`
- Modify: `server/services/content-drafts.cjs`
- Modify: `server/index.cjs`
- Modify: `src/domain/content-drafts.ts`
- Modify: `src/domain/integrations.ts`
- Modify: `src/workspaces/create/DraftResultWorkspace.tsx`
- Modify: `src/styles.css`
- Create: next numbered migration after current latest migration
- Test: `tests/content-drafts.test.mjs`
- Test: `tests/model-settings-layout.test.mjs`

**Interfaces:**
- Produces: `draftStore.complete(workspaceId, draftId, revision)`，不接收预检结果。
- Removes: `CONTENT_PREFLIGHT_REVIEW`、`ContentPreflightReport`、`preflight_json`。

- [ ] **Step 1: 写失败测试证明草稿完成不触发预检且响应无 preflight**

- [ ] **Step 2: 运行测试确认当前旧行为导致失败**

Run: `node --test tests/content-drafts.test.mjs tests/model-settings-layout.test.mjs`

- [ ] **Step 3: 删除服务、注入、类型、UI 和策略**

新增迁移删除数据库字段并清理历史任务策略，不修改历史迁移。

- [ ] **Step 4: 删除只服务于预检的测试文件和样式**

- [ ] **Step 5: 运行专项测试**

Run: `node --test tests/content-drafts.test.mjs tests/model-settings-layout.test.mjs`

---

### Task 6: 视频上传拉片服务与关键帧入库

**Files:**
- Create: `server/services/video-analysis.cjs`
- Create: `server/routes/video-analyses.cjs`
- Create: next numbered video analysis migration
- Modify: `server/index.cjs`
- Modify: `server/worker.cjs`
- Modify: `server/queue.cjs`
- Modify: `server/services/assetStorage.cjs`
- Modify: `src/domain/content-ingestion.ts` or create focused `src/domain/video-analysis.ts`
- Modify: `src/data/webApi.ts`
- Test: `tests/video-analysis.test.mjs`

**Interfaces:**
- Produces: `POST /api/v1/video-analyses`，输入 `{ assetId }`。
- Produces: `GET /api/v1/video-analyses/:analysisId`。
- Produces: 状态 `ANALYZING | EXTRACTING_FRAMES | SUCCEEDED | FAILED`。
- Produces: `VideoShotAnalysis` 与关键帧素材列表。

- [ ] **Step 1: 写视频任务状态与输入校验失败测试**

覆盖非视频素材、缺失文件、重复创建、任务状态转换和工作空间隔离。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/video-analysis.test.mjs`

- [ ] **Step 3: 实现视频分析存储、路由和队列任务**

Omni 输入为上传视频本地路径；提示词返回时间轴、叙事结构、钩子、可复用文案和关键帧时间点。

- [ ] **Step 4: 写 FFmpeg 关键帧失败测试**

使用受控执行器断言每个合法时间点生成一张图片、失败片段不写入素材库、元数据保留源视频与秒数。

- [ ] **Step 5: 实现关键帧截取与素材入库**

通过参数数组调用 FFmpeg，不拼接 shell 字符串；输出路径位于素材存储目录。

- [ ] **Step 6: 运行视频分析专项测试**

Run: `node --test tests/video-analysis.test.mjs tests/assets.test.mjs`

---

### Task 7: 新建创作入口与拉片工作区

**Files:**
- Modify: `src/workspaces/create/CreativeProjectCenter.tsx`
- Modify: `src/workspaces/create/ContentIngestionPanel.tsx`
- Create: `src/workspaces/create/VideoAnalysisWorkspace.tsx`
- Modify: `src/styles.css`
- Modify: navigation/state owner that selects the project workspace
- Test: `tests/creative-project-center.test.mjs`
- Test: `tests/content-ingestion.test.mjs`
- Test: `tests/asset-library-ui.test.mjs`

**Interfaces:**
- Consumes: Task 6 的视频分析 API。
- Produces: 第四张“视频拉片”卡片和拉片时间轴/关键帧瀑布墙。

- [ ] **Step 1: 写入口布局失败测试**

断言四张卡顺序固定，“视频拉片”位于“继续已有内容”右侧，选择后不显示题材、链接、正文和多素材输入。

- [ ] **Step 2: 写拉片状态与关键帧交互失败测试**

覆盖上传预览、分析状态、失败状态、时间轴、瀑布墙、最多选择 9 张并加入创作素材。

- [ ] **Step 3: 运行 UI 专项测试确认失败**

Run: `node --test tests/creative-project-center.test.mjs tests/content-ingestion.test.mjs tests/asset-library-ui.test.mjs`

- [ ] **Step 4: 实现四卡布局与视频专用表单**

按钮文案为“创建并开始拉片”，上传成功后创建项目和分析任务。

- [ ] **Step 5: 实现拉片工作区**

时间轴显示片段起止时间、画面描述与口播；关键帧只显示图片预览和必要选择状态，复用素材库选择规则。

- [ ] **Step 6: 运行 UI 专项测试**

Run: `node --test tests/creative-project-center.test.mjs tests/content-ingestion.test.mjs tests/asset-library-ui.test.mjs`

---

### Task 8: 数据迁移与完整验证

**Files:**
- Modify: migrations created in Tasks 5 and 6 if verification finds schema issues
- Modify: only files directly responsible for discovered regressions

- [ ] **Step 1: 运行数据库迁移**

Run: `npm run db:migrate`

- [ ] **Step 2: 运行全量测试**

Run: `npm test`

- [ ] **Step 3: 运行类型检查与生产构建**

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 4: 运行服务端语法检查**

Run: `node --check server/index.cjs`

Run: `node --check server/worker.cjs`

Run: `node --check server/services/rich-content-understanding.cjs`

Run: `node --check server/services/video-analysis.cjs`

- [ ] **Step 5: 检查差异质量**

Run: `git diff --check`

检查无残留预检代码、无视频链接入口、无调试日志、无临时测试文件、无静默纯文本降级。

- [ ] **Step 6: 启动本地服务并进行非计费真实 UI 联调**

验证新建创作四卡布局、视频上传流程、标题建议入口、策略设置页和草稿完成链路。需要真实百炼模型结果的步骤在用户明确同意计费调用后执行。
