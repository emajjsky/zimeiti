# 内容引擎技术实施方案

## 2026-08-03 修复：配图严格工具调用与自动数量规划

- 根因是 `qwen3.7-flash-2026-07-15` 已完成一次模型请求，但普通文本结果顶层没有 `strategy/items`；旧文本模型封装只读取 `message.content`，即使百炼 CLI 支持工具定义，也没有传递和解析 `tool_calls`。本次不再针对局部字段增加兼容分支。
- `text-model.cjs` 新增可选严格工具调用：百炼 CLI 通过 `--tool` 传递工具定义，外部 API 通过 `tools + tool_choice` 指定函数；要求工具时只接受一个名称匹配且参数非空的调用。普通文本仍服务其它任务，配图策划不再把普通文本当结构化方案。
- `visual-planning.cjs` 的提示词版本升级为 `1.2.0`，使用唯一工具 `submit_visual_plan`。工具 JSON Schema 完整描述图片角色、插入位置、画面任务、可见主体、精准搜索词、正文依据、图内信息和最终生图指令；返回参数继续通过 Zod 和业务质量门验证。
- 配图请求改为显式 `quantityMode: AUTO | MANUAL`。自动模式不接受 `bodyItemCount`，严格校验 1 张 `COVER` 加 2 至 11 张 `BODY`；手动模式必须提交 2 至 11 并精确匹配。接口响应返回实际 `bodyItemCount` 和本次模式，路由内模型调用仍恰好一次。
- `VisualWorkspace.tsx` 默认自动规划；关闭后显示 2 至 11 张下拉框。`quantityMode/bodyItemCount` 与方案一起自动保存；旧方案缺少模式时按现有 BODY 数量恢复为手动，空方案默认自动。手动数量与现有方案不一致时刷新后仍显示“更新方案”，完成排版按钮保持禁用。
- 本次没有数据库迁移、历史数据改写或真实模型重跑。新增工具调用、自动数量边界、手动精确数量、请求字段、旧方案恢复、刷新持久化、单图数量保持及桌面/390px 布局回归。

## 2026-08-03 修复：正文生成完成后当前页面即时同步

- 根因不是模型或数据库写入失败。`028_content_draft_foundation.sql` 上线后，首次 `GENERATE_DRAFT` 由 Worker 在成功事务中直接写入公众号 `content_drafts`，不再创建 `ACCEPTED PLATFORM_COPY` 候选；前端却仍以该候选是否存在作为完成条件，因此服务端已有正文、当前编辑器仍保留生成前的空本地状态，只有切页重新加载草稿后才显示。
- 新增 `GET /api/v1/creative/agent-runs/:id`。接口按 JWT 当前用户、`X-Workspace-Id` 和工作空间成员角色读取单个 Agent 运行，限定研究/文案 Agent 动作版本，返回统一 `ProjectAgentRun` 终态；不存在或跨空间运行返回 404，不通过消息文案猜测成功状态。
- `ProjectAgent.tsx` 将研究产物采用与首次正文完成拆为两个显式事件。文案轮询记录具体运行 ID，活动运行消失后读取同一运行终态；只有 `SUCCEEDED + GENERATE_DRAFT` 才调用 `onDraftGenerated`，`FAILED` 展示真实错误，`CANCELLED` 和其它动作不刷新正式正文。并发轮询复用同一请求 Promise，完成回调成功前不清除观察状态，网络失败可继续重试且不会重复触发成功同步。
- `CopyWorkspace.tsx` 的 `applyServerDraft()` 同步更新 `draftRef`、`contentRef`、保存队列和受控 textarea 状态，首次正文无需卸载页面即可出现。已有正文状态以当前工作草稿内容为准，不再依赖已删除的首次候选语义；生成期间标题、正文和保存按钮锁定，正文或创作设定尚在保存时禁止启动任务，避免旧 revision 覆盖新成稿。
- 本次没有数据库迁移、数据删除、历史项目改写或模型重跑。真实项目中已经生成的正文继续保留；修复只调整运行状态读取和前端草稿同步。
- 回归新增运行生命周期领域测试、工作空间隔离的运行状态接口契约测试和完整 Playwright 场景。浏览器从点击“生成正文”开始模拟 `DRAFT -> QUEUED -> RUNNING -> SUCCEEDED`，验证当前 `stage=copy` 页面即时出现正文、运行期间不可编辑、完成后恢复编辑、无需刷新或切页，且后续五步流程、390px 页面和控制台检查继续通过。最终验证为全量 `446/446`、TypeScript、生产构建、API/Worker 语法和 `git diff --check` 全部通过。

## 2026-08-03 修复：热点固定公众号母稿与研究结果真实性

- 发现页删除 `defaultPlatforms`、平台 checkbox、本地平台状态和平台建议结果块。`prepareAnalysis` 改为空请求体，服务端使用 strict 空对象校验并固定 `['WECHAT']`；确认旧分析草稿时再次校验冻结平台，历史跨平台草稿不能进入队列。
- `createProjectFromIntelligence` 不再继承 `analysis.selectedPlatforms`，热点项目规划始终写入 `targetPlatforms: ['WECHAT']`。历史分析和项目数据不迁移、不删除。
- 研究来源预算改为原始资讯独立读取，再执行最多两项计划内自动动作。搜索结果相关性读取 `researchBrief.subject/keywords`，只有计划缺少主体信息时才回退项目标题。
- 统一研究结果新增 `sourceAttempts`、动作总数和失败数，保留 `CAPTURED/FAILED/NEEDS_USER`。前端按 `COMPLETE/PARTIAL/FAILED` 显示真实状态、核验说明和失败动作，不再把任意研究产物显示为“已就绪”。
- 证据校验继续要求引用可在来源摘要中直接定位。第一次严格校验失败后，修复输出按主张隔离仍不合法的引用；对应主张降为 `NEEDS_REVIEW`，其它合法结论保留，并将结果标为部分完成。
- 新增前后端双门禁：研究结果至少包含一条 `VERIFIED` 或 `SINGLE_SOURCE` 主张才可采用。服务端采用接口在零可用事实时返回 409，页面同步禁用按钮并保留补充研究入口。
- 采用成功后，内容准备页立即切换到公众号正文，不再停留在旧研究候选上。客户端使用同步 ref 锁阻止同一按钮在 React 状态提交前被快速重复触发；服务端采用接口对已经 `ACCEPTED` 的同一产物幂等返回当前产物和项目，不重复写消息，也不返回误导性的 409。
- 回归新增公众号分析契约、热点项目平台、原文加两次检索、奇点逃逸主体匹配、失败来源持久化、坏引用隔离、真实状态展示、采用门禁和采用幂等测试。全量 `npm test` 为 `441/441`，`npm run typecheck`、`npm run build`、`node --check server/index.cjs`、`node --check server/worker.cjs` 与 `git diff --check` 均通过。

## 2026-08-03 实现：公众号母稿派生与社交平台单页编辑器

- 完成草稿页现在展示公众号冻结排版预览，并提供“生成小红书草稿”“生成微博草稿”和“去发布”。首次点击只准备派生任务并展示真实 `Scope / Provider / Model / Prompt version`；用户确认后才创建队列任务，页面加载不会自动派生。公众号当前版本变化时，旧派生稿明确标为来源过期，必须由用户基于当前母稿重新生成。
- 新增小红书/微博共用的 `PlatformDraftEditor.tsx`。两个平台只保留一个“文字 + 图片”页面，不显示配图、排版或审核步骤。标题和正文以 650ms debounce、失焦保存和 revision 串行队列更新；图片顺序显式保存，最多 9 张，重复素材在领域层拒绝，首图统一为封面。
- 编辑器复用空间素材选择器和预览器。素材选择前可打开真实预览，选中后显示鉴权 Blob 缩略图并可再次完整预览；支持新增、替换、删除、上下移动和发布裁切比例。删除或替换图片同时清理其裁切与生图标记，不残留失效编辑状态。
- 小红书缺少 3:4 内容图时在同页显示明确任务。AI 生图只在用户打开任务面板并确认后运行；面板从任务策略 API 显示 `TEXT_TO_IMAGE` 或 `IMAGE_TO_IMAGE` 的实际 Provider/Model。服务端生图平台白名单扩展为 `WECHAT / XIAOHONGSHU / WEIBO`，公众号配图策划仍只接受 `WECHAT`；生图响应返回实际执行策略快照，不接受浏览器模型覆盖，也不回退其它模型。
- 派生编辑器使用 `draft` URL 参数恢复具体草稿，刷新后重新读取服务端工作副本；旧 `platform` 参数仍会被清理。无效或已删除的草稿 ID 会退出编辑器并恢复公众号流程导航。
- 自动化覆盖公众号完成、派生策略准备/确认/轮询、进入小红书编辑器、正文 revision 保存、素材选择前后预览、两图排序、裁切、删除、刷新恢复、1440px/390px 无横向溢出和无控制台错误。`npm test` 为 `432/432`，类型检查、生产构建、服务端语法检查、Playwright 和 `npm audit --omit=dev` 全部通过，依赖漏洞为 0。
- `028_content_draft_foundation.sql` 已于 2026-08-03 在正式数据库应用；`029_remove_legacy_platform_workflow.sql` 尚未创建或应用。下一步仍是发布账号管理与平台草稿任务，不把当前占位发布页记为已交付，也不提前删除旧平台表或项目 JSON 字段。

### 公众号母稿草稿域真实迁移与验收

- 迁移前停止 API 与 Worker 写入，只读确认正式库仅缺少 `028`。基线为 67 个用户、67 个工作空间、56 个项目、20 条旧平台版本、40 个空间素材、40 条项目素材关系、77 条生成运行和 94 条 API 用量记录；`content_drafts` 等新表当时不存在，原项目和素材数据仍完整。
- 新备份位于 `F:\zimeitiyunying\backups\content-drafts-20260803-082615`。PostgreSQL 自定义格式 dump 为 `content_engine.dump`，1,320,050 字节，SHA-256 为 `c2f7c5f616ad3f4633b0ca3aab4856fe524c5d86ec8e7f50d25b39f51220ce2c`；迁移前清单 `preflight\manifest.json` 的 SHA-256 为 `eb74e48a1a2ef282cbec8b935b20b96aa27f6cc0869970f5fa3d39698b7126f2`。
- 上传目录已完整复制到备份目录。40/40 个文件、68,701,643 字节逐文件对照数据库大小与 SHA-256，缺失 0、哈希不一致 0；`backup-integrity.json` 记录完整校验结果。迁移前归档识别到 7 个涉及知乎的项目、1 条知乎平台版本、2 条知乎策略、1 条知乎产物和 1 条知乎阶段摘要；`028` 不删除这些数据。
- dump 先恢复到独立数据库 `content_engine_rehearsal_20260803_082615`，只应用 `028` 并完成内容哈希、计数和引用核对后，才在停写窗口应用到正式库。正式库 `schema_migrations` 现为 28 条，最后一条为 `028_content_draft_foundation.sql`；`029` 未执行。
- 迁移后旧数据基线全部保持不变；新增 119 个正式草稿（公众号 56、小红书 56、微博 7）、128 个不可变草稿版本、58 条草稿素材关系、402 个系统模板和 402 个模板版本。标题/正文内容哈希不一致 0、断裂草稿素材引用 0、缺少公众号来源的派生草稿 0。完整结果记录在 `migration-result.json`。
- API 与 Worker 已恢复，`GET /health` 返回正常。真实 Chrome 登录态刷新原宇树科技项目后，公众号正文、版本 4 和完整正文均恢复，`relation "content_drafts" does not exist` 不再出现；可见错误横幅 0、页面横向溢出 0、项目自身控制台错误/警告 0。浏览器扩展自身的脚本错误不计入项目结果。

## 2026-08-01 实现：多工作空间与空间素材底座

- `027_workspace_asset_foundation.sql` 新增 `user_workspace_preferences`、`workspace_assets`、`project_asset_links` 和 `storage_deletion_jobs`。当前空间由用户偏好显式保存；素材二进制元数据属于空间，项目只保存素材关系，同一素材可被多个项目复用。
- `workspaces.cjs` 提供工作空间会话、创建、选择、重命名、删除影响预览和删除申请。空间内请求必须携带 `X-Workspace-Id`；服务端以 JWT 用户和数据库成员关系校验 `OWNER/EDITOR/VIEWER`，不接受客户端自报权限，也不隐式回退到首个空间。
- 工作空间管理页面支持多空间切换、创建、重命名和删除。删除前读取项目、素材、发布账号、发布记录、指标快照和复盘数量；仅 Owner 可输入完整空间名称确认。进入 `DELETING` 后空间立即不可访问，Worker 再删除物理目录与数据库记录。
- `assets.cjs` 与 `AssetLibrary.tsx` 建立空间素材库：上传、网络导入和 AI 生图统一进入 `workspace_assets`，按空间内 SHA-256 去重；支持筛选、预览、元数据修改、归档、项目选择和跨项目复用。
- `project_asset_links` 承担素材在项目中的用途、阶段 Scope、平台和备注。解除一个项目引用只删除关系；有任何项目引用时拒绝素材删除。无引用素材删除使用 `storage_deletion_jobs + STORAGE_DELETE`，Worker 物理删除失败会记录错误，启动恢复逻辑重新投递未完成任务。
- `project_references` 迁移后只保存公开链接；上传文件、网图和 AI 图片均由 `workspace_assets` 拥有。项目 JSON 中的 `assetReferenceId`、`assetReferenceIds`、`coverReferenceId` 和引用对象已一次性改写为素材 ID，迁移结束后删除非链接旧记录，不保留双写或旧字段兼容入口。

### 真实数据迁移与验收

- 应用迁移前先执行 `pg_dump`，备份为 `F:\zimeitiyunying\backups\workspace-assets-20260801-184718\content-engine.dump`；SHA-256：`DFA1608872225415A54744260245C7120E3981A4288FC77904FE98D34F28330C`。
- 迁移前有 56 个项目、44 条文件引用、4 条链接引用和 40 个去重文件；引用文件合计 69,109,358 字节。迁移后保持 56 个项目，生成 40 条 `workspace_assets` 和 40 条 `project_asset_links`，素材文件合计 68,701,643 字节。
- 40 个迁移后物理文件全部存在；逐文件大小不一致 0、SHA-256 不一致 0、断裂素材关系 0、失效项目 JSON 素材引用 0。项目 JSON 中素材 ID 共出现 62 次；旧 `assetReferenceId/coverReferenceId`、非 `LINK` 的 `project_references` 均为 0。
- `npm test` 368 项、`npm run typecheck`、`npm run build` 全部通过。`workspace-assets.e2e.py`、`creative-workspace.e2e.py`、`visual-workspace.e2e.py` 三套浏览器 E2E 全部通过；新增场景覆盖邮箱注册、多空间创建/切换、素材上传/预览、两项目复用、解除单项目引用、空间隔离、刷新恢复、390px 和空间删除确认。
- 真实浏览器已打开 `http://127.0.0.1:5173` 并确认登录页正常。浏览器没有现有用户登录态，因此未伪造 JWT、未冒充用户、未创建测试账号污染真实数据库；真实登录后的页面链路验收记录为受登录态限制。
- 本节只代表阶段 A 已完成。阶段 B 的四平台交付链路、阶段 C 的发布账号管理、发布记录与指标、正式复盘闭环仍未完成。

## 2026-07-31 实现：AI 配图导演 v6 与真实案例资产管线

- 新增 `server/services/visual-planning.cjs`。服务只读取公开任务策略 `WECHAT_VISUAL_PLANNING`，不回退到正文或其它模型；提示词包含公众号完整正文、用户指定的正文图数量、项目风格和现有配图上下文。
- 新增 `POST /api/v1/creative/projects/:projectId/visual/plan`。接口支持整套策划和 `currentItemId + request` 单图重策划，成功调用记录为 `WECHAT_VISUAL_PLANNING`，并保留参考图和已有素材绑定。
- 服务端严格验证图片数量、平台角色、正文依据、画面任务、搜图词、信息点和最终生图指令；空泛占位内容直接返回稳定中文错误。`VISUAL_PLAN_VERSION = 6`，前端 `safePlan()` 兼容旧记录缺失数组或 `prompt` 的情况。
- `VisualWorkspace.tsx` 首次进入显示主动生成入口。页头只保留图片数量和项目风格；当前配图项展示策划结果、参考图、单图自然语言修改、搜图、项目素材和“生成这一张”，不再暴露视觉结构、版式模板、单图风格或原始提示词。
- `visualStylePresets()` 为 13 个核心风格提供 `previewImage/featured`，并新增马卡龙卡通、清透赛博和像素复古模型提示词。选择器只展示核心案例；旧风格 ID 继续保留在领域层，确保历史项目可读取。
- `scripts/visual-style-previews.json` 保存同主题风格方向，`scripts/generate-visual-style-previews.ps1` 调用用户指定的 `apimart-imagegen` 脚本，默认使用 `gpt-image-2`、4:3、2k，支持 `-Only`、跳过已有文件和 `-Force` 重做。产物写入 `public/visual-style-previews/`。
- 前端案例组件优先渲染真实 `<img>`，加载失败显示明确空状态，不再生成抽象几何图冒充模板。密钥未配置时不执行图片调用，也不把未生成资产记为完成。

## 2026-07-30 实现：研究优先读取项目原始资讯

- `simplified-research.cjs` 新增 `workflowSourceActionsForProject()`：从 `project.sourceSnapshot.intelligence.url` 生成首个 `READ_LINK`，去重后与计划内补充搜索共同限制在自动来源上限内。
- `project-research.cjs` 将原始资讯标题、来源、URL 和摘要注入研究计划消息；模型可以基于原文提出核验主张，而不是只看到项目标题。
- `simplified-research.cjs` 新增 `projectOriginalSource()` 与 `sourceMatchesProject()`：原始资讯快照直接转为高相关来源，补充搜索按标题主体过滤无关结果。
- `worker.cjs` 的简化研究工作流把项目快照传入来源捕获；原始资讯有完整快照时不再重复联网读取，只有快照不完整时才读取公开链接。
- 研究结果仍只把 `VERIFIED` 主张传给正文上下文；`SINGLE_SOURCE`、冲突和无证据主张继续留在待复核区。
- 新增来源动作回归测试，验证原始链接优先、重复链接不重复读取、自动来源数量受限、原文快照复用和无关搜索结果过滤。

## 2026-07-30 实现：WritingBrief 平台恢复

- 新增 `src/domain/writing-brief-platforms.mjs`，集中实现图文平台过滤、去重与恢复优先级。对应 `.d.mts` 为 React/TypeScript 提供明确契约，Node 单测直接执行真实领域函数。
- `CreateWorkspace.tsx` 在 `planning` 阶段不请求或创建 Brief；进入创作后，已有空 Brief 从项目版本或规划目标恢复，无 Brief 则使用同一平台规则生成默认值。
- 默认账号声音自动绑定与手工/自动保存都先执行平台规范化，并通过 `platformSkillDefaults()` 补齐渠道规则和目标篇幅。保存入口不再以空平台直接返回。
- 新增 `server/services/http-errors.cjs`。Fastify 全局错误处理器识别 `ZodError` 并返回稳定中文信息，普通业务错误仍保留原提示。
- 测试包含初始化阶段与平台恢复 5 项、HTTP 错误收敛 2 项，并使用真实数据库项目验证 Brief 自动写入四个平台、刷新恢复及浏览器零控制台错误。

## 2026-07-30 实现：视觉导演 v4

- `visual-plan.mjs` 当前 `VISUAL_PLAN_VERSION` 为 5，并通过 `visualStylePresets()`、`visualTemplatesFor()` 和 `updateVisualPlanItem()` 统一重编译提示词。版本 5 移除独立负面提示词，把所有禁止项写入最终提示词，并为每套项目风格提供案例模板元数据。
- `CreativeVisualPlanItem` 新增 `stylePreset / templatePreset / sourceExcerpt / contentBlocks / references`。`CreativeVisualDelivery.styleProfile` 保存当前平台项目默认风格，`INHERIT` 项跟随项目，显式预设保持独立。
- `mergeVisualPlan()` 对 v3 方案执行无损升级：保留 `purpose / focus / avoidConcepts / searchQueries / informationPoints / size / assetReferenceId`，补齐视觉导演字段并替换旧提示词。v2 与 v1 继续使用既有迁移边界。
- `VisualWorkspace.tsx` 保留左侧图片位和右侧任务结构，新增项目风格、视觉结构、版式模板、单图风格、策划内容和参考图控制。结构化修改使用 650ms 自动保存；手工修改高级提示词不会被非结构操作覆盖。
- `POST /visual/generate` 接受最多三条 `referenceImageIds`，通过项目素材快照验证归属和图片 MIME。有参考图时执行 `bailian image edit` 并逐个追加 `--image`；无参考图时继续执行 `bailian image generate`。调用日志按实际路径记录 `IMAGE_TO_IMAGE` 或 `TEXT_TO_IMAGE`。
- UI 视觉参数保持 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`。主控制使用紧凑下拉，策划和提示词分层折叠；桌面双栏与移动单栏均无横向溢出。

## 2026-07-30 实现：图文信息图模式与大图预览

- `VISUAL_PLAN_VERSION` 升级为 3，`CreativeVisualPlanItem` 增加 `generationMode` 与 `informationPoints`。`buildVisualGenerationSpec()` 统一生成两种模式的提示词和负面约束，前端切换模式时复用同一规则，不复制字符串模板。
- `INFO_CARD / QUOTE_CARD / DATA_CHART / CARD` 默认选择 `INFOGRAPHIC`；其它类型默认选择 `ILLUSTRATION`。信息图从对应正文段落、视觉焦点和表达目的归纳 3 至 5 条短信息，提示词包含主标题、核心结论、信息点、渠道比例与阅读层级。
- v2 方案升级时按稳定配图项 ID 保留 `size` 和 `assetReferenceId`，同时使用 v3 规则替换旧的“禁止图片文字”提示词；v1 及更早错误方案继续只迁移封面，避免恢复已知的正文误绑定。
- `VisualWorkspace.tsx` 删除监听 `activeItem/sourceView` 的自动搜索 Effect。推荐词点击与搜索表单提交是仅有的检索入口。
- AI 生图区改为大图预览与操作侧栏。当前素材通过网络 URL 或鉴权 Blob URL 显示，生成后沿用 `assignAsset()` 绑定并由 650ms 自动保存；刷新后材料接口与私有文件接口恢复预览。
- 提示词和负面词放在原生 `details` 高级设置内。模式、比例和“生成这一张”保持直接可见；页面沿用深蓝边线、钴蓝和马卡龙实色，不增加装饰动画或说明卡片。
- 服务端 `visualPlanItemInput` 校验生成模式与信息点，实际生图接口保持不变，仍读取百炼 CLI `TEXT_TO_IMAGE` 策略并记录调用日志。

## 2026-07-30 实现：自动配图方案与任务式执行

- `src/domain/visual-plan.mjs` 导出 `VISUAL_PLAN_VERSION = 2`。规划器使用项目选题提取稳定主题，不再把渠道标题中的长钩子句作为搜索词；正文候选优先选择包含原理、关系、数据、应用和场景信息的段落及子句。
- 配图项新增 `visualType / focus / avoidConcepts`。封面按全文主题生成，正文按 `CONCEPT_DIAGRAM / SCENE / DATA_CHART / INFO_CARD` 等视觉意图生成不同第一搜索词；正文提示词默认避开封面新闻现场和前序概念。
- `ContentProject.delivery.platforms[platform].visual` 新增 `planVersion`。当前版本方案原样恢复；旧版或无版本方案只迁移封面，正文绑定清空但项目素材记录不删除，并通过 650ms 自动保存写回新版。
- `PUT /visual` 使用 Zod 校验版本、视觉类型和语义字段，同时拒绝同一素材 ID 或同一图片 URL 绑定到多个位置。
- `VisualWorkspace.tsx` 改为“左侧配图方案 + 右侧当前任务”。进入搜图自动执行第一组关键词，关键词标签可切换或编辑；AI 生图自动读取当前项提示词与比例；三种素材来源统一写回 `assetReferenceId`。
- `buildVisualPlan()` 支持 `bodyItemCount`，`visualPlanCountRange()` 统一声明各平台范围，`resizeVisualPlan()` 使用稳定配图项 ID 保留已有编辑和素材绑定。页头步进器调整正文数量后走原有 650ms 自动保存；减少数量不会删除 `ProjectReference`，重新规划和刷新从已保存方案恢复数量。
- “重新规划”读取当前正文并要求用户确认，只保留封面绑定。页面把原“完成”状态改为“已绑定”，避免把素材存在误报为匹配质量通过。
- `searchTavilyImages()` 调用 Tavily `include_images` 与 `include_image_descriptions`。返回结果标记“使用前确认版权与授权”；无配置、无结果或调用失败时回退 Wikimedia Commons。
- `documentForPlatform()` 读取配图顺序和插入位置。公众号/知乎 HTML 将封面放在标题后，并把正文图片按段落间隔插入；小红书/微博 Markdown 保留首图与配图位置。
- `visual-plan.test.mjs` 和 `visual-workspace.e2e.py` 覆盖正文首选词去重、平台数量边界、增减时绑定保留、旧版迁移、当前版本恢复、自动保存、重新规划与刷新保持数量、提示词预填以及 1440px/390px 无横向溢出。
- 视觉参数保持 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`。沿用现有深蓝边线、钴蓝与马卡龙状态色，不新增装饰动画。
- 渠道制作导航由上下两排等宽大按钮收敛为紧凑工具栏：桌面端渠道切换与正文/配图/排版/审核同排，移动端分为两条紧凑栏。组件局部覆盖全局 `nav` 内边距，避免平台栏被额外撑高；390px 下四个平台无需横向滚动。

## 2026-07-30 实现：创作内页导航与配图能力

- `CreateWorkspace.tsx` 新增渠道工作台导航。平台与步骤在一个固定区域内切换，`channelView` 只控制当前页面，不再用交付阶段条件卸载 `CopyWorkspace`、`VisualWorkspace`、`LayoutWorkspace` 或 `ReviewWorkspace`。
- `VisualWorkspace.tsx` 重构为“项目素材 / 搜图 / AI 生图”三个来源区域。项目文件通过带鉴权的下载接口读取为 Blob URL 预览；网络图片和私有文件使用同一素材选择、封面和保存逻辑。
- `GET /creative/image-search?q=` 请求 Wikimedia Commons API，仅返回带缩略图、原图、来源页、许可和署名的结果。选择后才创建项目视觉参考。
- `POST /creative/projects/:projectId/visual/generate` 读取 `TEXT_TO_IMAGE` 的百炼 CLI 策略，执行 `image generate`，把输出文件保存到私有上传目录并创建 `FILE/VISUAL/IMAGING` 参考记录；成功与失败均写入 `api_usage_logs`。
- `PUT /visual` 允许提前保存视觉选择；`POST /visual/complete` 仍保留正文与阶段约束，确保只有可交付的渠道进入排版。

> 版本：Web-only v1.0
> 更新：2026-07-28
> 适用阶段：P0-P2

## 1. 架构决策

产品采用 Web-only 架构。浏览器负责交互和内容编辑；服务端负责身份、主数据、外部调用、凭据保护和任务调度；异步 Worker 负责百炼 CLI、媒体任务和后续渲染。仓库不保留 Electron 兼容层、桌面打包配置或桌面专用依赖。

```text
React/Vite Web
      │ HTTPS / JSON API
Fastify API
      ├─ PostgreSQL：主数据与审计记录
      ├─ Redis/BullMQ：异步任务与调度
      ├─ OSS：图片、音频、视频、导出包
      ├─ 外部服务：RSS、Tavily、飞书、平台官方 API
      └─ Worker：百炼 CLI、媒体 API、Remotion/Hyperframer
```

## 2. 运行组件

| 组件 | 责任 | 当前状态 |
| --- | --- | --- |
| Web 前端 | 登录、项目中心、七步创作工作台和 API 客户端 | 已建立规划、研究、正文及后续真实空状态 |
| Fastify API | 认证、工作空间、凭据、情报、统一项目与任务 API | 已建立 |
| PostgreSQL | 用户、工作空间、凭据、情报、任务和审计主数据 | 已建立初始迁移 |
| Redis/BullMQ | 延迟任务、异步任务、重试与 Worker 通信 | 已建立骨架 |
| 百炼 CLI Runner | 每个任务临时注入 Key 并执行 CLI | 已建立骨架 |
| Agent 动作与 Skill 组合 | 受限动作计划、版本化创作规则、确认前运行记录 | 通用项目 Agent、研究计划、研究来源执行和八个四平台文案动作已建立；证据判定待实施 |
| RSS/剪藏/Tavily 服务 | 合规信息采集、统一分类和候选搜索 | RSS 目录与分类已验收，Tavily/剪藏待真实用户验收 |
| 飞书适配器 | OAuth、模板、字段映射、同步 | 未实现 |
| 发布扩展 | 浏览器预填与人工确认 | 未实现 |
| 媒体 Worker | 图像、ASR、视频、Remotion/Hyperframer | 未实现 |

## 3. 数据与所有权

### 3.1 主数据原则

- PostgreSQL 是唯一主数据库。
- 飞书 Base 是经授权后的协作镜像，不承担任务执行或密钥存储。
- OSS 只保存二进制资产，数据库保存对象键、元数据、版权信息和引用关系。
- 所有业务表必须带 `workspace_id`；API 从 JWT 推导工作空间，不信任客户端提交的工作空间 ID。

### 3.2 当前表

| 表 | 用途 |
| --- | --- |
| `users` / `workspaces` / `workspace_members` | 身份和工作空间边界 |
| `credential_vault` | 加密的 Tavily、百炼等凭据；百炼凭据由核心 Agent 与 Worker 复用，不重复保存 |
| `intelligence_sources` / `intelligence_items` | 资讯来源和情报记录；`matched_keywords` 保存真实命中词；服务端在读取与 RSS 刷新时删除超过 30 天的数据 |
| `jobs` / `api_usage_logs` | 异步任务、模型调用与错误记录 |
| `workspace_snapshots` | 从早期原型迁移的临时状态桥；正式 Web 不再整份覆盖写入 |
| `project_inputs` | 项目想法、草稿、笔记和转写；保存使用阶段与适用平台 |
| `project_references` | 公开链接的用途、Scope 与元数据；不再拥有上传文件 |
| `workspace_assets` | 空间级上传、网图和 AI 素材的二进制元数据、哈希、版权与存储键 |
| `project_asset_links` | 项目对空间素材的用途、Scope、平台与备注关系 |
| `user_workspace_preferences` | 用户显式选择的当前工作空间 |
| `storage_deletion_jobs` | 素材和空间的后台物理删除状态与错误记录 |
| `project_planning_versions` | 内容项目规划的草稿/确认不可变版本 |
| `legacy_topic_project_mappings` | 旧选题到统一内容项目的幂等迁移映射 |

阶段 1 首个迁移必须新增 `generation_runs`：记录确认卡、来源快照、Scope、模型、提示词版本、预估/实际用量、状态、错误和产物引用。阶段 3 必须新增 `publication_tasks`：一个平台版本可关联多次排期、提交、失败重试或取消。

`workspace_snapshots` 只能用于迁移阶段。阶段 1-3 必须逐步用题材、选题、项目、版本、素材和发布任务表替代它，禁止将其当作长期业务模型。

## 4. 身份、会话与凭据

### 4.1 身份

- 使用邮箱密码注册/登录，Fastify JWT 签发短期访问令牌。
- 后续增加刷新令牌、邮件验证、密码重置和飞书/第三方登录。
- 每次 API 请求必须验证 JWT，服务端查询用户所属工作空间和角色。

### 4.2 凭据

- 用户输入的 API Key 通过 TLS 发送到 API。
- 服务端使用 AES-256-GCM 加密后写入 `credential_vault`。
- API 永不返回明文 Key；UI 只显示“未配置/已保存/最后更新时间”。
- 生产环境必须设置独立的 `JWT_SECRET` 与 `CREDENTIAL_ENCRYPTION_KEY`，禁止使用开发默认值。
- CLI Runner 只在子进程生命周期内通过环境变量获取所需 Key，不写入全局 CLI 配置文件。

## 5. API 与任务边界

### 5.1 同步 API

同步 API 只处理短请求：登录、读取/保存业务数据、保存凭据、检索候选、预读公开链接、创建任务。

当前核心接口：

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
GET/POST /api/v1/workspaces
PATCH /api/v1/workspaces/:workspaceId
GET /api/v1/workspaces/:workspaceId/deletion-impact
DELETE /api/v1/workspaces/:workspaceId
GET  /api/v1/workspace/state
PATCH /api/v1/workspace/preferences
GET/POST /api/v1/assets
POST /api/v1/assets/import
GET/PATCH/DELETE /api/v1/assets/:assetId
GET /api/v1/assets/:assetId/content
POST/DELETE /api/v1/projects/:projectId/assets/:assetId
GET  /api/v1/settings/credentials/:provider
PUT  /api/v1/settings/credentials/:provider
POST /api/v1/intelligence/rss/refresh
POST /api/v1/intelligence/clip
POST /api/v1/intelligence/search
POST /api/v1/jobs/bailian-text
GET  /api/v1/jobs/:id
GET  /api/v1/creative/projects/:projectId/materials
POST /api/v1/creative/projects/:projectId/inputs
PUT/DELETE /api/v1/creative/project-inputs/:id
POST /api/v1/creative/projects/:projectId/references
PUT/DELETE /api/v1/creative/project-references/:id
```

### 5.2 异步任务

所有超过 10 秒、可重试、消耗模型额度或产生资产的操作必须创建 `jobs` 记录并进入 BullMQ。

状态机：

```text
PENDING → RUNNING → SUCCEEDED
                  ↘ FAILED → PENDING（受限重试）
PENDING/RUNNING → CANCELLED
```

任务必须记录：工作空间、任务类型、输入摘要、来源快照、Scope、模型/供应商、提示词版本、预估/实际用量、开始与结束时间、耗时、产物引用、错误摘要和关联 ID。

### 5.3 AI 确认协议

创建任何模型任务前，API 先创建 `generation_run` 草稿并返回确认卡。确认卡由前端展示任务目的、来源数量、模型、提示词版本、预估费用、预期产物和写入范围；只有用户确认后 API 才创建 `jobs` 并入队。取消操作将运行记录标记为 `CANCELLED`，不得调用模型。

## 6. 百炼 CLI 与模型 Scope

### 6.1 执行方式

Worker 从凭据库读取并临时解密百炼 Key，调用内置 `bailian-cli`。CLI 的输出必须解析、校验并写入业务资产或任务结果。

### 6.2 Scope

| Scope | 初期动作 | 后续动作 |
| --- | --- | --- |
| 情报分析 | 摘要、热度、事实待核验 | 聚类、相关性与选题建议 |
| 文本创作 | 解读、改写、长文、口播稿 | 平台风格与多轮项目 Agent |
| 排版 | 公众号 HTML/结构、分页脚本 | 模板和品牌规范 |
| 视觉/多模态 | 图片理解、视频理解 | 生图、分镜和数字人 |
| 音频 | ASR、配音 | 音乐和视频音轨 |
| 视频/渲染 | 任务创建 | 外部视频 API、Remotion、Hyperframer |

任务无有效 Scope 或模型策略时必须失败并提示配置路径，不能静默回退到硬编码模型。每次成功或失败调用均回写 `generation_runs` 与 `api_usage_logs`，供项目页和设置用量页查询。

## 7. 核心 Agent、动作注册表与 Skill 组合

### 7.1 Agent 边界

核心 Agent 运行在服务端，是“计划器”而不是自由执行器。它只能从动作注册表选择已启用动作，并读取项目冻结的 Skill 组合约束输出。只有动作定义可以声明工具白名单；Skill 不能授予工具、命令或数据库权限。任何工具调用都通过 API/Worker 执行，不允许模型自行构造任意命令、URL、数据库查询或发布动作。

### 7.2 数据模型

| 表 | 责任 |
| --- | --- |
| `agent_action_definitions` | 生成、改写、配图、排版等受限动作的输入/输出、工具白名单、Scope 和写入范围 |
| `skill_definitions` | 题材、内容类型、语言风格、排版、渠道规则的稳定 ID、维度、所有者和启用状态 |
| `skill_versions` | 结构化规则、来源要求、禁用表达、质量检查和版本号 |
| `skill_compositions` | 项目选择的五维 Skill 版本组合及覆盖字段 |
| `agent_model_policies` | 工作空间中 Agent 规划与各 Skill Scope 可用的模型路由 |
| `agent_plans` | 用户请求、上下文快照、结构化步骤、状态与确认时间 |
| `generation_runs` | 单个 Skill 运行的来源、模型、提示词、用量、结果与错误 |

### 7.3 计划协议

核心 Agent 输出严格 JSON：`goal`、`contextSummary`、`steps[]`、`risks[]`、`estimatedCost`。每个步骤必须引用一个 `actionDefinitionId`，并声明当前 `skillCompositionId`、输入资产、预期输出和是否需要确认。API 在保存计划前校验动作白名单、Skill 组合、Scope、输入和权限；无效步骤直接拒绝，不进入 Worker。

### 7.4 P0 实现方式

P0 先提供代码内置、数据库登记的五维 Skill 预设。用户可按维度组合，复制内置预设后编辑结构化规则，但不能上传任意脚本。Agent 动作由系统维护，用户不能通过修改 Skill 扩大工具权限或模型 Scope。P1 再提供团队共享、版本审批和样文辅助提取规则。

## 8. 信息采集安全

- RSS 和链接剪藏只允许 HTTP(S) 公开地址。
- 服务端校验 DNS，拒绝 `localhost`、局域网、私有 IP、携带账号密码的 URL 和超大响应。
- 最多跟随有限次跳转，并对跳转目标重复校验。
- 公众号验证码页、登录页、付费墙和风控页不能读取或绕过；向用户说明如何提供可公开读取的原文链接或手工摘要。
- Tavily 只在用户点击搜索时调用，候选结果必须经“加入热点池”确认后才成为情报。
- 微博、今日头条、央视网、X、公众号、财经媒体和官方公告只登记为辅助渠道。系统只能剪藏用户提交的公开 URL，或在用户主动搜索时向 Tavily 传递域名范围；不得把辅助渠道伪装成可定时抓取的数据源。
- Playwright 后续可作为用户主动公开页面读取助手，但必须遵守同一 URL、DNS、跳转、登录和验证码边界，不保存用户 Cookie，不执行绕过动作。

## 9. 发布与账号安全

- P0 账号只保存平台目标和显示名，不进行 OAuth、不保存密码/Cookie。
- P1/执行计划阶段 4 才通过 OAuth 接入官方 API，并按照平台授权范围执行。
- 无官方发布 API 时，浏览器扩展只在用户本机已登录后台页预填内容。
- 扩展不上传 Cookie，不处理验证码，不点击最终发布；用户确认后才写入“已确认发布”。

## 10. 开发与部署

### 9.1 本地

```powershell
docker compose up -d
npm run db:migrate
npm run dev
npm run dev:worker
```

Web：`http://127.0.0.1:5173`

API：`http://127.0.0.1:8787/health`

### 9.2 2 核 2G 测试服务器

只部署 Caddy/Nginx、静态 Web、API 和低并发文本 Worker。构建在本地或 CI 完成；视频渲染、数字人和大媒体任务不部署在这台机器。

生产建议使用托管 PostgreSQL、Redis 与 OSS；服务器只保留无状态 API/Worker。数据库迁移由 CI/CD 执行，配置使用环境变量或密钥管理服务。

## 11. 测试与验收

| 层级 | 必须验证 |
| --- | --- |
| 数据库 | 迁移可重复执行、工作空间隔离、凭据不明文落库 |
| API | 认证、权限、错误信息、RSS/剪藏/Tavily 契约 |
| Worker | 任务状态、重试、取消、CLI 超时和用量日志 |
| Web | 登录、首次设置、情报刷新、选题、项目、发布状态 |
| 端到端 | 真实情报 → 选题 → 内容包 → 人工发布 → 数据回填 |

每项验收都需标注为“代码完成”“自动化通过”“真实用户验收”三种之一，不能混用。
# 2026-07-25 实现记录：服务端模型设置

- 新增迁移 `server/migrations/004_model_settings.sql`：扩展 `credential_vault` 验证元数据，增加工作空间级 `model_connections` 和 `model_catalog`，任务策略支持外部连接引用。
- 新增凭据接口：列表、读取、保存、检测和移除。百炼检测同时验证服务器内置 CLI 可启动和 DashScope `/models` 可访问；Tavily检测调用最小搜索请求。
- 新增外部 API 连接、检测、模型目录同步、任务策略和用量读取接口。账户目录和外部连接只持久化接口实际返回的模型标识；异步媒体模型使用经过官方模型市场核验的目录项补齐，并标记为 `MARKET_CATALOG`，不冒充账号已开通。
- Web 前端的模型目录、策略、外部连接、用量、百炼凭据和检索凭据均通过服务端 API 访问；`ModelSettingsScreen` 不再包含桌面 IPC 分支。
- `bailianCliMediaCatalog()` 依据已安装 `bailian-cli 1.10.1` 的真实命令定义登记图像与视频能力；`/models` 的账户目录和 CLI 媒体目录以 `origin` 区分并合并去重。
- `005_model_task_scopes.sql` 将旧图片/视频策略迁移为具体操作 Scope。目录项新增 `operations`，任务策略保存时由服务端校验模型是否支持对应输入输出契约。

# 2026-07-25 实现记录：媒体市场目录与语音识别

- 新增 `SPEECH_RECOGNITION` Scope，前端音频分组包含“配音与口播”和“语音识别”，服务端分别按 `AUDIO`、`ASR` 能力校验。
- 新增 `MARKET_CATALOG` 来源，补充百炼 `/models` 不返回的异步媒体和语音模型；任务下拉明确显示“百炼模型市场”。
- 已核实 Wan 2.7 模型：`wan2.7-t2v-2026-06-12`、`wan2.7-i2v-2026-04-25`、`wan2.7-r2v-2026-06-12`、`wan2.7-videoedit`。
- 首尾帧使用模型市场当前可检索的 `wan2.2-kf2v-flash`。未把 HappyHorse 或 Wan 2.7 I2V 错标为首尾帧能力。
- 语音识别市场项包含 `qwen3-asr-flash` 和 `fun-asr`；账号 `/models` 返回的日期版本和实时版本也按 ASR 能力进入同一 Scope。

# 2026-07-25 实现记录：模型与 API 页面归属

- `ModelSettingsScreen` 使用当前页签生成动态页头，百炼、核心 Agent、检索 API、外部 API、任务策略和调用记录不再共用“模型路由”标题。
- 删除跨页 `CredentialInventory`。连接状态由百炼、检索 API 和外部 API 各自页面负责，避免同一凭据在多个页面重复展示。
- `UsageOverview` 只在调用记录页渲染，且仅在进入调用记录时加载用量数据；其它设置页不再发起无意义的用量读取。
- 页面反馈增加所属页签，百炼、外部连接、任务策略和调用记录的错误或成功信息不会串到其它页面。
- 设置根容器扩展为 1400px；单连接配置页使用 960px 聚焦宽度，任务策略为 1180px，外部 API 与调用记录为 1280px。窄屏下页签两列、用量统计单列。
- 新增 `tests/model-settings-layout.test.mjs`，以 Node 内置测试锁定页头、调用统计归属、连接概览移除、反馈归属和宽度规则。

# 2026-07-25 实现记录：资讯来源目录与统一分类

- `shared/intelligence-sources.json` 作为 Web 与测试共享目录，登记 17 个自动 RSS，并把微博、今日头条、央视网、X、公众号、财经媒体和官方公告登记为 7 个辅助渠道；央视网限定域名同时包含 `cctv.com` 和 `news.cctv.com`。
- `shared/intelligence-taxonomy.json` 定义 13 个统一题材及关键词。`intelligenceClassifier.cjs` 对标题按 3 倍权重、摘要按 1 倍权重评分，英文 `AI` 使用单词边界，最多返回 5 个真实命中词。
- RSS、公开链接预读和 Tavily 结果共用分类器，不把搜索表单中的题材或来源预设直接当作最终分类。
- `006_intelligence_keywords.sql` 增加 `matched_keywords jsonb`，并建立 `(workspace_id, canonical_url)` 条件唯一索引。规范化 URL 删除 hash 和 `utm_*`、`spm`、`from`、`source`、`ref`、`fbclid` 等追踪参数，再稳定排序查询参数。
- 情报源页面拆为“自动来源/辅助渠道”。自动来源支持分组多选批量添加、自定义 RSS 和已接入状态；辅助渠道只跳转到链接剪藏或带域名预设的网页搜索。
- 热点页不再提供关键词下拉。卡片最多显示 2 个持久化关键词；`shared/intelligence-filters.mjs` 将标题、摘要、来源和关键词统一纳入现有搜索框。来源、时间、题材、语言和刷新状态保持不变。
- 单个 RSS 失败只更新该来源错误状态，不中断其它来源。真实联网探测中 13 个源返回 HTTP 200 XML；Hacker News 高热本次网络失败；中国新闻网娱乐源响应体很短，可能产生 0 条，应保留为可观察状态。

# 2026-07-25 实现记录：财经来源与筛选简化

- 自动来源增加 `international-finance` 分组：美联储新闻稿、美国 SEC 新闻稿和欧洲央行新闻稿。三者均真实返回 HTTP 200、RSS/XML、有效条目和 2026 年内容。
- 辅助渠道增加 `FINANCE_MEDIA` 和 `FINANCE_OFFICIAL`，并通过 `defaultCategory: 财经` 将网页搜索默认题材设为财经。
- 财经媒体域名覆盖腾讯财经、新浪财经、同花顺、东方财富和财联社；官方公告域名覆盖央行、统计局、证监会、外汇局、上交所、深交所、北交所、港交所、阿里巴巴和腾讯投资者关系。
- 新浪财经公开的旧 RSS 目录仍可访问，但财经条目发布时间停留在 2018 年，因此不进入默认来源。腾讯财经、同花顺、东方财富和财联社未发现稳定开放 RSS 合同，只能主动搜索或剪藏。
- 热点工具栏删除关键词下拉，保留来源、时间、题材、语言、搜索和刷新；关键词标签继续显示在卡片底部，并可由搜索框匹配。

# 2026-07-25 实现记录：来源筛选统一链路

- 新增 `filterIntelligenceItems`，统一处理来源、题材、语言、时间和搜索条件，页面不再内联拼接筛选逻辑。
- 新增 `intelligenceSourceLabel`，来源下拉选项、卡片来源横条和详情抽屉共用同一展示值；搜索结果和链接剪藏不会再出现原始来源与展示来源不一致。
- 增加单一来源筛选回归测试，覆盖“美国 SEC 新闻稿”与“网页检索”两类来源。
- Web 入口只创建一个 React Root；页面状态由 Vite React Fast Refresh 管理，不再使用桌面壳全局对象保存 Root。

# 2026-07-26 实现记录：Web 信息架构与前端重构

## 导航和页面壳

- `src/app/navigation.mjs` 和 `navigation.d.mts` 是一级导航、发现局部页签、设置局部页签和跨页面跳转意图的共享模型。
- `DiscoverWorkspace` 只负责热点情报、网络搜索、导入链接的局部切换。
- `SettingsWorkspace` 只负责工作空间、资讯来源、模型与 API、飞书 Base、账号授权的局部切换。
- `PageHeader` 和 `WorkspaceTabs` 统一标题、操作、反馈和页签无障碍属性。

## 发现工作区

- `IntelligenceInbox` 使用来源、题材、时间、立项状态和关键词搜索筛选真实情报。
- 热点卡片在 1280 宽度为三列、1024 为两列、768 及以下为单列；详情使用右侧抽屉，不再挤压卡片网格。
- `shared/intelligence-presentation.mjs` 统一确定性标签配色和“今天、昨天、月日”时间展示。
- `NetworkSearchPanel` 使用来源范围下拉，不再渲染辅助渠道卡片。
- `LinkImportPanel` 使用“导入链接”文案，具备空输入禁用、读取骨架、预览、错误和成功后的下一步。

## 设置工作区

- `SourceSettings` 只管理自动来源，支持目录批量接入、自定义 RSS、行内编辑、启停和删除。
- `PUT /api/v1/intelligence/sources/:id` 持久化来源可编辑字段；`normalizeSourceInput` 统一清理关键词和刷新频率。
- `WorkspaceProfileSettings` 不再展示本地素材路径。
- `ModelSettingsScreen` 统一调用 Web 模型 API，通过 `initialSection` 接受“检索 API”等深层跳转；百炼、核心 Agent、检索 API、外部 API、任务策略和调用记录不再按桌面环境分叉。

## 遗留实现清理

- 删除 `main.tsx` 中无引用的旧发现页、旧链接导入页、旧模型设置页、旧资讯来源页和旧网络搜索页。
- 生产构建检查覆盖 Desktop、V0.1、桌面客户端、剪藏链接、辅助渠道和本地素材目录，当前构建结果均无命中。

# 2026-07-26 实现记录：公众号文章导入

- `server/services/public-web.cjs` 新增 `fetchPublicPage()`，统一处理公开网页请求、有限重定向、内容类型和流式体积限制。
- `mp.weixin.qq.com` 使用普通 Chrome 桌面请求头；不携带 Cookie，不使用微信登录态，不处理人机验证。
- 新增 `server/services/browser-reader.cjs` 和 `playwright-core`。轻量 HTTP 触发微信验证页时，使用系统 Chrome 创建一次性隔离上下文，只放行 `mp.weixin.qq.com` 主文档请求。
- Chrome 路径优先读取 `PLAYWRIGHT_CHROME_PATH` 或 `CHROME_PATH`，再探测 Windows、Linux 和 macOS 常见安装位置；不随应用下载浏览器。
- 初始 URL、重定向 URL 和返回 HTML 均检查微信验证页；HTTP 200 但缺少 `js_content` 与 `og:title` 的微信异常页同样触发隔离浏览器回退。
- 浏览器回退始终以用户提交的原始 `/s/` 链接为入口；验证页 URL 不会被当作文章读取或保存。成功预览后，Web 输入框与“查看原文”均保持原始文章地址。
- 公众号页面上限为 5MB，其它网页保持 1MB；读取过程按字节流限制，超过上限时取消响应体。
- `buildPublicPreviewFromHtml()` 在 description 为空时从 `js_content` 平衡提取正文，清理标签和实体后生成摘要。
- `intelligenceSourceLabel()` 对手工导入内容保留实际来源，公众号卡片显示“公众号文章”。

# 2026-07-26 待实施设计：AI 热点分析

- 已确认采用单次结构化文本模型调用，综合分由服务端根据五个分项计算，不直接信任模型输出的总分。
- 计划新增 `prompt_template_versions` 与 `intelligence_analyses`，复用任务策略、`generation_runs` 和调用记录。
- 计划增加提示词模板查看、保存、恢复默认和版本接口，以及分析准备、确认、取消和最新结果接口。
- 模型输出必须经过固定 Schema 校验；首次格式错误允许一次结构修复，仍失败则记录失败且不覆盖上次成功结果。
- 热点详情沿用现有抽屉，增加平台勾选确认卡、五维结果、角度选择和创建选题预填，不新增一级页面。
- 本节仅记录已确认的实施边界，业务代码尚未完成；详细规格见 `docs/superpowers/specs/2026-07-26-ai-intelligence-analysis-design.md`。

# 2026-07-26 实现记录：AI 热点分析

## 2026-07-26 实现记录：AI 分析状态恢复与输出修复

## 2026-07-26 实现记录：分析结果创建选题

## 2026-07-26 实现记录：多平台分析输出约束

- 真实失败记录显示用户勾选了公众号、小红书和视频号，但旧提示词 JSON 示例只包含 `WECHAT`；修复调用缺少精确平台代码上下文，导致平台一致性校验失败。
- `buildAnalysisPrompt()` 现在把本次勾选平台代码写入系统提示词，并按本次平台数量动态生成 `platforms` 对象数组示例；修复调用沿用这份系统约束。
- 继续保持平台集合严格校验，不通过自动补齐或放宽校验伪造平台建议。

- `TopicCandidate` 新增目标受众和分析快照，保存评分、结论、时效窗口和平台建议。
- `createTopicFromIntel()` 根据用户选中的推荐角度创建待判断选题，冻结分析快照、待核验项和原资讯 ID。
- `Plan` 读取真实关联资讯与选题快照，展示核心观点、目标受众、分析建议、平台建议和待核验项，移除硬编码示例详情。

- `GET /api/v1/intelligence/items/:id/analyses/latest-run` 从 `generation_runs` 返回最近一条分析运行的状态、错误、任务 ID 与确认卡数据。
- `IntelligenceInbox.tsx` 在详情抽屉打开时并行读取最近成功结果和最近运行状态：DRAFT 恢复确认卡，QUEUED/RUNNING 继续轮询，FAILED 展示服务端错误；通过 `useRef` 避免同一任务重复轮询。
- `buildAnalysisPrompt()` 明确 `timingWindow` 枚举和嵌套对象数组 JSON 样例。`buildAnalysisRepairPrompt()` 接收结构化校验错误；Worker 在首次校验失败后把真实错误传入一次性修复调用。
- 新增提示词契约和运行状态读取的回归测试。真实模型调用未执行。

- `007_intelligence_analysis.sql` 新增分析结果和提示词模板版本表；迁移已在本地开发库应用。
- `server/services/intelligence-analysis.cjs` 实现五维评分权重、FOLLOW/WATCH/SKIP 决策、业务模板变量校验、默认模板、三层提示词、模型 JSON 代码块提取和输出/平台契约校验。
- `server/services/text-model.cjs` 为百炼 CLI 与 OpenAI 兼容外部 API 提供统一文本执行器。
- `server/index.cjs` 增加模板 `GET/PUT/reset`、分析 `prepare/confirm/cancel/latest` 接口；分析准备必须验证当前任务策略存在可用文本模型。
- `server/worker.cjs` 增加 `INTELLIGENCE_ANALYSIS` Worker：读取冻结来源、模板与模型路由，首次结构不合格时只修复一次，并记录 `generation_runs`、`intelligence_analyses` 与 `api_usage_logs`。
- `PromptTemplateSettings.tsx` 提供可编辑业务模板和恢复默认；系统约束不进入可编辑区。
- `IntelligenceInbox.tsx` 增加平台勾选、确认卡、任务轮询、五维结果、角度选择及创建选题预填；`TopicCandidate` 与内容项目传递待核验事实。
- 自动化覆盖业务契约、API 和统一文本执行器。真实模型执行被有意保留给用户验收，未用测试 Key 或模拟成功结果替代。

## 视觉和响应式

- 视觉参数为 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`。
- 保留暖白、钴蓝和马卡龙标签，取消普通按钮和卡片的红色偏移硬阴影。
- 959px 以下使用图标侧栏，719px 以下使用移动抽屉导航。
- 所有动效遵循 `prefers-reduced-motion`，本轮未增加 Anime.js 动画。

## 2026-07-26 实现记录：跨页面滚动位置复位

- `src/app/navigation.mjs` 新增 `resetViewport()`，统一将浏览器页面滚动到 `top: 0`、`left: 0`。
- `App` 使用 `useLayoutEffect` 监听 `view`，在新工作页绘制前调用该方法，防止吸顶顶栏遮挡新页面标题。
- `tests/web-navigation.test.mjs` 覆盖滚动参数和主入口监听关系。

## 2026-07-26 架构收敛：移除桌面运行时

- 删除 `electron/main.cjs`、`electron/preload.cjs`、`dev:desktop`、Windows 桌面打包配置和 Electron 相关依赖。
- `package.json` 只保留 Web、API、Worker、迁移、测试、类型检查和 Web 构建命令；本地启动脚本不再检查 Electron。
- 创作实现采用“Agent 动作 + Skill 组合 + 模型 Scope”：动作决定能做什么，Skill 决定按什么题材、内容类型、语言风格、排版和渠道规则完成，百炼 CLI 只负责模型执行。
- 视频作为独立媒体项目读取既有文稿与素材，不进入图文创作主状态机。

## 2026-07-26 实现记录：WritingBrief 与创作 Skill

- `008_creative_skill_system.sql` 新增 `creator_profiles`、`creative_skill_definitions`、`creative_skill_versions`、`creative_skill_compositions` 和 `writing_briefs`。
- 新表使用 `creative_` 前缀与旧 Agent 动作注册表隔离。热点分析继续使用 `intelligence-analysis:1.0.0`，本轮没有重命名、删除或迁移旧表。
- `server/services/creativeSkills.cjs` 提供 Skill 目录读取、Brief 读取和事务保存。写入前按工作空间权限校验五个版本，并验证每个版本属于请求中的对应维度。
- API 新增 `GET /api/v1/creative/skills`、`GET /api/v1/creative/projects/:projectId/brief` 和 `PUT /api/v1/creative/projects/:projectId/brief`。
- `src/domain/creative.ts` 定义前后端共享语义类型；`webCreative` 封装 Web API，不增加桌面或本地持久化分支。
- `CreateWorkspace.tsx` 将创作页拆成创作设定和文案两个可用阶段，提供加载、未保存、保存中、已保存和错误状态。配图、排版、审核保留在步骤条但当前禁用。
- 图文主流程只读取公众号和小红书版本。旧视频号版本保留在项目数据中，但不进入 Brief 平台选择和文案页签。
- 本轮设计采用 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 5`。只用 CSS 提供状态反馈，没有为表单引入 Anime.js 动画。
- Skill 调研、许可证和采用结论记录在 `docs/05_SKILL_RESEARCH_自媒体.md`。

## 2026-07-26 实现记录：URL 工作位置持久化

- `navigation.mjs` 新增 `readWorkspaceLocation()`、`workspaceLocationUrl()` 和 `replaceWorkspaceLocation()`，集中解析、生成和替换工作区 URL。
- `App` 首次渲染从 URL 初始化页面、发现/设置分区、资讯、选题、项目和平台；服务端状态加载后校验对象 ID，不存在时回退到同类第一条。
- 工作空间加载完成后才同步 URL，避免初始种子数据在真实数据返回前覆盖刷新地址。
- URL 按页面清理无关参数：创作保存 `project` 与 `platform`，规划保存 `topic`，发现保存 `discover` 与 `intel`，设置保存 `settings` 与可选 `model`。
- 该实现使用浏览器 `history.replaceState`，不产生每次字段选择一个历史记录的噪音。

## 2026-07-26 实现记录：行动中心真实化

- `src/domain/today.mjs` 使用 `Intl.DateTimeFormat` 和 `Asia/Shanghai` 时区生成当天标题，并把项目状态映射为真实下一步动作。
- `Today` 从 `topics` 生成待确认选题，从 `projects` 生成创作、发布或复盘任务，不再内置示例任务。
- 近期排期只读取 `TopicCandidate.plannedDate`；热点最多展示当前工作空间前 8 条资讯；所有列表提供真实空状态。
- 项目卡和优先事项点击时先设置真实项目/选题 ID，再进入目标页面，URL 持久化随后记录该对象。

## 2026-07-27 实现记录：受控创作大纲

- `009_creative_outline_action.sql` 新增 `agent_action_definitions`、`agent_action_versions` 和 `creative_outline_candidates`；`generation_runs` 增加可空的 `action_version_id`，并要求 Skill 或动作执行引用至少存在一个。迁移已应用到本地开发库。
- `server/services/creative-outline.cjs` 定义 `creative-outline:1.0.0`、`CONTENT_WRITING` Scope、严格 Zod 输出 Schema、生成提示、单次修复提示和候选 DTO。
- `creativeSkills.getContext()` 读取项目 WritingBrief 和冻结的五维 Skill 版本、规则；任一版本失效时拒绝准备动作。
- API 新增大纲 `prepare/confirm/cancel/latest-run/latest/accept`。最近运行按项目与平台隔离；prepare 不入队，confirm 才创建 `CREATIVE_OUTLINE` Job；accept 使用行锁和事务更新工作空间快照。
- Worker 复用统一文本模型执行器，支持百炼 CLI 和 OpenAI 兼容外部连接。首次 JSON 结构失败只修复一次，并将调用写入 `api_usage_logs.operation = CONTENT_WRITING`。
- `CreateWorkspace.tsx` 实现准备、待确认、排队、执行、失败、候选和已采用状态。候选通过独立审核弹层展示，正式编辑器只承载标题与正文。
- 服务端接受候选后，`App` 仅用返回项目更新 React 状态，不再次调用全量 `persistState`，避免旧快照覆盖事务结果。
- `package.json` 的 `dev` 同时启动 API、Web 和 Worker。自动化新增 7 项大纲契约测试，完整 Node 测试为 92 项。
- Playwright 使用独立测试用户验证未配置模型的真实阻断与任务策略跳转，并使用测试级 API mock 验证候选桌面和 390px 布局。产品运行时没有示例候选，未触发真实模型调用。
- 本轮视觉参数为 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`。沿用暖白、钴蓝、淡蓝和薄荷绿，只使用状态反馈动画，并支持 `prefers-reduced-motion`。

## 2026-07-27 实现记录：平台 Skill 组合

- `010_platform_creative_skills.sql` 为 `creative_skill_compositions` 增加 `platform_versions_json`，并按项目已选平台回填公众号/小红书内置排版和渠道版本。
- `011_platform_outline_action_v1_1.sql` 注册 `creative-outline:1.1.0`，并取消尚未执行的 `1.0.0` DRAFT 运行；已成功或已采用结果保持不变。
- `creativeSkills.getContext(workspaceId, projectId, platform)` 按当前平台组合三个共用 Skill 与两个平台 Skill；保存时逐项校验版本 ID、维度和工作空间权限。
- `CreateWorkspace.tsx` 将 Skill 面板改为共用、公众号、小红书页签。切换或新增目标平台时自动创建对应默认组合，保存后由服务端恢复。
- `buildOutlinePrompt()` 不再把含 Skill ID 的完整 Brief 直接传给模型，只传业务字段和已冻结的五维 `skillRules`，避免旧全局字段形成冲突指令。
- 新增服务端单元测试和 Playwright 断言，验证两平台默认排版/渠道及小红书上下文隔离。

## 2026-07-27 实现记录：大纲资产与正文编辑器解耦

- `POST /creative/outline-candidates/:id/accept` 不再调用 Markdown 渲染器，也不再修改 `version.body`；事务仍更新选中标题、文案版本状态、项目状态和候选接受状态。
- 删除未再使用的 `renderOutlineMarkdown()`，并增加源码契约测试，禁止 accept 路由重新出现 `version.body =` 写入。
- `CreateWorkspace.tsx` 新增大纲审核弹层状态。候选成功后自动打开；关闭后由右侧 Agent 的“审核大纲”恢复；已采用后由“查看大纲”恢复。
- 审核弹层使用单一内容滚动区，桌面最大高度为 `82dvh`，移动端占满视口；遮罩点击和 Escape 均可关闭。
- 右侧 Agent 将“大纲已写入文案”修正为“大纲已采用”，并显示真实下一步“生成初稿”，但未渲染未实现的动作按钮。
- 标题输入改为可换行 textarea，标题和正文均根据 `scrollHeight` 自动增长并设为 `overflow: hidden`，消除编辑器内部滚动条。
- Playwright 验证候选自动弹出、关闭后编辑器恢复、右侧可重开、390px 无横向溢出、采用后状态正确且正文不含 Markdown。
- 本轮视觉参数为 `DESIGN_VARIANCE 5 / MOTION_INTENSITY 2 / VISUAL_DENSITY 4`。继续使用现有品牌色和直角面板体系，仅增加状态反馈，不引入新动画依赖。

## 2026-07-27 实现记录：受控初稿生成

- `012_creative_draft_action.sql` 新增 `creative_draft_candidates`、`creative-draft:1.0.0` 和动作定义，候选通过 `outline_candidate_id` 关联已采用大纲；迁移已应用到本地开发库。
- `server/services/creative-draft.cjs` 定义 `CREATIVE_DRAFT` 模板 Scope、严格 Zod 输出 Schema、完整初稿提示、单次 JSON 修复和候选 DTO。正文要求至少 100 字并禁止 Markdown 标题标记。
- 大纲服务增加 `CREATIVE_OUTLINE` 可版本化业务模板；通用模板存储支持热点分析、大纲和初稿三个 Scope，运行时冻结模板 ID、版本和正文。
- API 新增初稿 `prepare/confirm/cancel/latest-run/latest/accept`。prepare 要求当前平台存在已采用大纲；latest-run/latest 只返回仍关联当前已采用大纲的有效结果。
- 采用新大纲时，旧已采用大纲和其初稿候选转为 `REJECTED`，但工作空间现有正文保持不变。采用初稿时才更新标题、正文、项目状态和待核验项。
- Worker 新增 `CREATIVE_DRAFT` 分派，复用统一文本模型执行器与 `CONTENT_WRITING` 调用日志；成功只保存候选，不直接写工作空间快照。
- `CreateWorkspace.tsx` 将右栏统一为“创作 Agent”，新增初稿准备确认、轮询、失败恢复、候选弹层和采用状态。初稿正文使用 `white-space: pre-wrap`，弹层内容区单滚动，移动端占满视口。
- 大纲和初稿轮询都改为先读取候选、再更新成功状态，避免 React effect 清理使候选响应丢失。
- `PromptTemplateSettings.tsx` 使用热点分析、生成大纲、生成初稿三个页签，独立维护加载、未保存、保存新版本、恢复默认和错误状态。
- 导航模型补充 `templates` 子页白名单和类型，`?view=settings&settings=models&model=templates` 刷新后可恢复提示词模板页。
- 新增 5 项初稿契约测试、2 项模板页导航测试并扩展创作 E2E。Node 测试共 99 项；Playwright 使用 Mock 验证采用前不覆盖正文、采用后写入完整初稿、模板页刷新恢复和 390px 无横向溢出，没有触发付费模型。
- 本轮视觉参数保持 `DESIGN_VARIANCE 5 / MOTION_INTENSITY 2 / VISUAL_DENSITY 4`，沿用现有直角面板、钴蓝和马卡龙状态色，不新增动画依赖。

## 2026-07-27 实现记录：写作策略与平台提示词重构

- `creativeSkills.cjs` 新增 `WRITING_DIMENSIONS`。`getContext()` 只读取题材、内容类型、语言风格和当前平台渠道规则，不再读取或冻结 `LAYOUT`。
- Brief 保存继续兼容已有 `platform_versions_json`；排版版本允许保留供后续阶段使用，但缺失排版不再阻断写作策略保存和大纲、初稿准备。
- `creative-outline.cjs` 将通用 `CREATIVE_OUTLINE` 拆为 `CREATIVE_OUTLINE_WECHAT`、`CREATIVE_OUTLINE_XIAOHONGSHU`，并提供不同默认模板。
- `creative-draft.cjs` 将通用 `CREATIVE_DRAFT` 拆为 `CREATIVE_DRAFT_WECHAT`、`CREATIVE_DRAFT_XIAOHONGSHU`，公众号长文与小红书图文分别约束结构和表达。
- outline/draft prepare 根据当前平台选择模板 Scope，运行仍冻结模板 ID、版本和正文；旧通用 Scope 保留历史记录但不再用于新执行。
- `CreateWorkspace.tsx` 删除创作设定右侧 Skill 面板，在文案编辑器顶部增加四列“写作策略”。三个规则可选，平台规则只读并随公众号、小红书页签切换。
- 大纲与初稿确认卡显示明确的“公众号图文”或“小红书图文”目标及提示词版本，Skill 快照中不再出现排版。
- `PromptTemplateSettings.tsx` 改为任务一级页签和平台二级选择，五个 Scope 独立缓存、编辑、保存新版本和恢复默认。
- 前端采用 `DESIGN_VARIANCE 5 / MOTION_INTENSITY 2 / VISUAL_DENSITY 4`。保持现有波普怀旧清新品牌语言，使用单层分区和稳定四列，不新增动效。
- 自动化新增写作阶段归属、排版排除、双平台 Scope 与默认模板测试；Playwright 验证 Brief 无 Skill、文案页三项选择与平台规则、两平台模板内容不同和 390px 无横向溢出。

## 2026-07-27 设计记录：内容母版与多渠道 Workflow

本节为下一阶段实现契约，尚未实现的对象和页面不得提前展示可操作入口。

### 领域对象

- `project_inputs`：项目级想法、原稿、笔记、转写和补充说明，记录类型、正文、所有者和更新时间。
- `project_references`：公开链接、上传文档和既有内容，记录 `FACT`、`OPINION`、`STRUCTURE`、`VOICE`、`HOOK`、`VISUAL`、`NEGATIVE` 作用以及全项目/平台/阶段 Scope。
- `research_runs`、`research_sources`、`evidence_claims`：保存研究问题、工具、来源快照、发布时间、访问时间、可支持论点及 `VERIFIED`、`SINGLE_SOURCE`、`CONFLICTING`、`NEEDS_REVIEW` 状态。
- `content_master_versions`：保存跨平台共享的核心观点、证据引用、案例、必须保留表达、待核验项和素材引用；采用新版本不得覆盖已有平台版本。
- `platform_strategies`：按项目和平台保存内容类型、语言风格、目标篇幅范围、传播目标、钩子、CTA、渠道规则版本、账号规则版本和用户覆盖项。
- `platform_content_versions`：独立保存公众号、小红书、知乎、微博及后续渠道候选/正式版本，与内容母版版本建立来源关系。
- `project_assets`、`image_plan_items`：保存上传/生成素材、来源、授权状态、参考图用途、适用平台、插入位置、生成运行和采用状态。
- `layout_versions`、`review_reports`：保存平台排版产物和内容、事实、原创、渠道、版权五类审核结果。
- `content_projects.workflow_version`：`LEGACY_V1` 或 `CONTENT_MASTER_V2`。新 Workflow 未形成完整纵向闭环前保持 V1；V2 开放后旧项目只允许经用户确认迁移。

所有新表必须包含 `workspace_id`，公开 URL 和上传文件执行工作空间隔离、大小/MIME 校验、内容哈希去重和删除引用检查。网页研究只保存允许持久化的正文摘要与证据快照；不得保存登录 Cookie 或绕过访问限制。

`project_assets` 是素材文件、来源和授权状态的权威表；`content_master_versions` 只保存候选素材引用和用途，`platform_content_versions`/`image_plan_items` 保存采用关系、派生物、插入位置与平台适配。删除或撤销授权前先查询活动采用关系；存在引用时默认拒绝删除，授权变化则使关联平台版本进入 `ASSET_BLOCKED`。

### Workflow 与动作契约

Workflow 使用依赖图，不使用所有项目都必须顺序执行的硬编码步骤。`PROJECT_UNDERSTANDING`、`RESEARCH_PLAN`、`VERIFY_CLAIMS`、`BUILD_CONTENT_MASTER`、`POLISH_EXISTING_DRAFT`、`RESTRUCTURE_DRAFT`、`GENERATE_OUTLINE`、`GENERATE_DRAFT`、`REVISE_SELECTION`、`ADAPT_PLATFORM`、`BUILD_IMAGE_PLAN`、`GENERATE_IMAGE`、`APPLY_LAYOUT`、`REVIEW_PACKAGE` 均为 Agent 动作，不是 Skill。

每个动作声明必要输入、可选输入、输出 Schema、可调用工具、模型 Scope、费用确认、候选写入位置和采用后的正式写入范围。自由对话先解析为这些动作组成的计划；没有注册动作或写入范围不匹配时拒绝执行。模型或浏览器结果始终先保存候选，用户采用后才更新正式对象。

完整草稿路径允许跳过 `GENERATE_OUTLINE` 和 `GENERATE_DRAFT`，改用 `POLISH_EXISTING_DRAFT` 或 `RESTRUCTURE_DRAFT`；只有选题/零散想法路径使用研究、大纲和初稿。所有路径在导出前必须完成 `REVIEW_PACKAGE`。

研究动作复用 `public-web.cjs` 的协议、DNS 解析、私网阻断、重定向重检、响应体积和超时约束，并增加站点级并发 1、可配置最小请求间隔、失败冷却和允许持久化字段白名单。明确挑战页、登录页、付费墙、robots/条款禁止或权限不明时返回 `HUMAN_INPUT_REQUIRED`，不得切换抓取器继续尝试。Playwright 使用全新无 Cookie 上下文，只处理公开页面的客户端渲染。

### 规则解析

执行时将平台硬规则、账号规则、栏目模板、项目平台策略、本次用户指令和 Agent 推荐值解析为一个不可变 `resolved_strategy_snapshot`。硬规则冲突阻断准备；建议冲突进入确认卡。目标篇幅从项目级 `writing_briefs.length_target` 迁移到 `platform_strategies`，旧数据按既有平台复制为迁移默认值，用户下一次保存平台策略后形成新快照。

渠道规则定义标题、篇幅建议、正文结构、标签、链接、封面/媒体规格、CTA、发布字段和合规检查；排版规则只作用于已确认文案和素材。钩子作为平台策略中的结构化配置，不新增一个必须手工选择的 Skill 维度。

### 页面与交互

创作项目逐步拆为项目概览、资料与研究、文案、配图、排版和审核。内容母版作为底层共享资产，不强制增加页面。每页只展示该阶段的主资产、状态和操作；Agent 以项目级可展开对话面板存在，不作为独立页面，也不在每页重复解释能力。

平台版本支持多选创建，但分别显示写作、配图、排版和审核状态。切换平台只读取该平台策略和版本；内容母版更新时只标记“可同步”，用户查看差异并确认后才创建新的平台候选版本。

V1 到 V2 迁移先生成只读预览，把现有 Brief、`sourceIds`、平台正文、待核验项和素材引用映射为 V2 候选对象。用户确认后在单一事务中创建 V2 数据并更新 `workflow_version`；不调用模型，不更改 V1 运行/候选状态。迁移失败整体回滚。V2 导出 API 校验内容母版、平台策略、采用文案、素材状态和审核报告，任一质量门缺失时返回结构化阻断项。

### 实施顺序

第一切片先统一项目 Agent 并跑通文案候选：迁移项目消息与阶段摘要 → 接管研究、大纲和初稿状态 → 注册文案动作 → 建立公众号、小红书、知乎、微博独立策略与版本 → 候选差异、采用和刷新恢复。其后再以公众号真实案例依次完成来源证据、配图计划、HTML/素材包和五类审核；视频保持独立。

## 2026-07-27 设计记录：通用项目 Agent 与四平台文案

- 详细规格见 `docs/superpowers/specs/2026-07-27-project-agent-copy-workflow-design.md`。
- `project_agent_messages` 增加阶段、消息类型、动作运行和产物引用；新增 `project_stage_summaries` 与 `project_artifacts`，长项目通过摘要和正式产物构建上下文，不把全部历史反复发送给模型。
- 通用 Agent 由 Orchestrator、Context Builder、Action Registry、Skill Resolver、Model Router 和 Artifact Store 组成。百炼 CLI 是模型执行适配器，不承担项目状态和动作权限。
- 文案动作首批包括生成大纲、生成初稿、润色、重构、扩写、压缩、局部修改和平台适配。prepare 只冻结上下文并展示确认卡，confirm 才入队；结果写候选，采用后才写正式版本。
- 内容母版是四平台共享数据层，但单平台用户不必经过额外页面。公众号/知乎共用长内容基础，小红书/微博共用短内容基础，平台规则和最终正文仍严格隔离。
- 当前 `ProjectResearchAgent` 与文案页旧创作 Agent 将合并为一个 `ProjectAgent` 组件。默认显示当前阶段与前序摘要，完整项目历史按需读取；移动端在主资产和 Agent 之间单栏切换。
- 第一切片不执行来源核验，不开发配图、排版和审核入口。所有未核验事实继续保留状态，并在最终审核、导出阶段阻断。

## 2026-07-27 实现记录：项目资料与参考 Scope

- 迁移 `013_project_materials.sql` 新增 `project_inputs` 和 `project_references`。项目主体已由 `025_normalized_content_projects.sql` 迁移到独立 `content_projects` 表；资料表继续使用 `project_id text`，API 写入前通过 `creativeProject()` 同时校验工作空间与项目归属。
- `projectMaterials.cjs` 提供输入与参考资料的工作空间隔离 CRUD，返回 DTO 主动移除 `storage_key`。
- `projectUploadStorage.cjs` 使用相对存储键、随机文件名、项目 ID 哈希目录和 `safePath()` 防止路径穿越；写入时计算 SHA-256，失败时清理半成品。
- Fastify 注册 `@fastify/multipart`，单文件上限 50MB。MIME 白名单只允许 JPEG、PNG、WebP、GIF、PDF、纯文本、Markdown、MP3、WAV、M4A、MP4 和 WebM。
- 文件内容只通过鉴权 API 读取；响应增加 `X-Content-Type-Options: nosniff`、CSP sandbox、私有缓存和安全文件名。删除数据库记录后清理对应文件。
- `ProjectMaterials.tsx` 将我的内容、参考链接、素材文件拆为互斥页签，提供加载、空、错误、保存中、编辑和删除状态；移动端编辑弹层使用完整视口且无横向溢出。
- 创作步骤更新为项目概览、资料与研究、文案、配图、排版、审核。目标篇幅从项目概览移动到文案写作策略，但在 `platform_strategies` 建立前仍写入兼容字段 `lengthTarget`。
- 开发默认目录为 `data/uploads`，由 `.gitignore` 排除；生产部署必须把 `UPLOAD_ROOT` 指向持久卷或改用 OSS 适配器。
- 项目资料切片本身不读取链接正文或转写音视频。其后的研究计划切片已允许在用户确认后调用百炼文本模型，但仍不执行网页读取或事实核验。

## 2026-07-27 实现记录：项目研究 Agent

- 迁移 `014_project_research_agent.sql` 注册 `project-research-plan:1.0.0`，新增 `project_agent_messages`、`project_research_plans` 和 `project_research_materials`。运行状态继续复用 `generation_runs`，异步任务复用 `jobs` 与 BullMQ。
- `projectMaterials.researchSnapshot()` 使用 `workspace_id + project_id + id` 校验所有选中资料；缺失或跨项目 ID 整体拒绝。`readProjectUploadText()` 只读取 TXT/Markdown 的固定字节上限。
- 准备接口冻结项目、WritingBrief、用户请求、模型路由和资料快照，创建 DRAFT 并保存用户消息，不入队。确认接口原子切换为 QUEUED，创建 `PROJECT_RESEARCH_PLAN` Job 后入队；取消只允许 DRAFT 或尚未执行的 QUEUED。
- Worker 使用 `AGENT_PLANNER` 路由调用百炼 CLI。输出由 Zod 严格校验，第一次结构不合法时只允许一次修复调用；成功后事务保存计划、助手消息、运行结果和 `PROJECT_RESEARCH` 用量日志。
- GET 上下文返回最近运行、最近完成计划、计划引用资料和最近 100 条消息。消息查询先取最新 100 条，再按时间正序返回，避免长期项目只看到最早消息。
- `ProjectMaterials.tsx` 管理资料选择、真实项目进度和引用标记；`ProjectResearchAgent.tsx` 管理持久化对话、准备、确认、排队、运行、失败和完成计划。活动确认卡存在时阻止重复准备。
- 页面使用 4 步资产进度：项目概览、项目资料、研究计划、正式文案。正式文案排除立项时自动预填的核心观点，仅在采用初稿或用户实际修改标题/正文后完成。
- 当前 Prompt 只生成研究问题、待核验主张和下一步动作，不执行动作。`READ_LINK`、`SEARCH_WEB` 和 `ASK_USER` 将在通用 Agent 与文案候选闭环之后，由来源/证据对象承接。

## 2026-07-27 实现记录：通用项目 Agent 与四平台文案

- `015_universal_project_agent.sql` 为消息增加阶段、消息类型、动作运行和产物引用，新增阶段摘要、通用产物、内容母版、平台策略和平台文案版本；所有项目对象继续按 `workspace_id + project_id` 隔离。
- `016_four_platform_creative_contracts.sql` 增加知乎、微博的渠道/结构 Skill 和四平台大纲、初稿 Scope；`017_project_copy_actions.sql` 注册生成大纲、生成正文、润色、重构、扩写、压缩、修改选区和平台适配八个动作版本。
- `project-agent.cjs` 统一研究与文案上下文、消息、摘要和产物 DTO。`project-copy-action.cjs` 负责确定性动作解析、平台规则、Prompt、严格输出 Schema、候选结构和事实保留。
- `/creative/projects/:projectId/agent` 提供阶段/平台/历史上下文；`agent/prepare` 只冻结快照并创建 DRAFT，`agent-runs/:id/confirm` 才入队。Worker 成功只写候选、消息、运行和 `PROJECT_COPY` 用量，采用事务才更新正式版本。
- `/creative/project-artifacts/:id/accept` 采用候选并更新内容母版、平台版本、正式工作区快照和阶段摘要；`/reject` 只允许废弃当前工作空间中的大纲或平台文案候选并记录 `SYSTEM_EVENT`。
- `/creative/projects/:projectId/platforms/:platform` 幂等启用四个图文平台，禁止创建视频号。写作 Brief 校验已拆到 `writing-brief.cjs`，共享 `LAYOUT/CHANNEL` 可为空，当前平台 `CHANNEL` 仍强制存在。
- `ProjectAgent.tsx` 替代研究专用组件，渲染五类消息、当前阶段/完整历史、确认卡、运行状态和候选入口；研究无资料、文案策略未保存或存在活动运行时禁用发送。
- `CopyWorkspace.tsx` 管理四平台标签、平台启用、写作策略、正式文案自动保存、正文选区、版本入口和项目 Agent。`CopyCandidateDialog.tsx` 提供大纲/全文审核、段落 LCS 差异、待核验事实、采用和废弃。
- 服务端项目回写通过 `updateState()` 持久化，新增平台和采用正文均能在刷新后恢复。候选采用成功后关闭旧审核对象，再从 Agent 上下文读取已采用产物。
- 响应式断点为 1024px、790px 和 460px。桌面为正文/Agent 双栏，窄屏为单栏；候选在移动端占满视口。视觉参数保持 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 6`，只保留加载反馈动画。
- 自动化覆盖四平台隔离、策略阻断、选区、确认卡、候选不覆盖正文、采用后更新、微博不串稿、刷新恢复和无横向溢出。E2E 路由拦截 prepare/confirm/accept，不调用真实付费模型。
- 当前未实现 `SEARCH_WEB`/`READ_LINK` 的来源执行、证据主张、图片计划与生成、排版、审核、内容包和发布；这些模块不得根据本记录标记完成。

## 2026-07-28 实现记录：规划与创作统一

- `server/services/project-planning.cjs` 负责旧状态幂等迁移、项目规范化、空白创建、热点创建、规划校验和阶段推进。`ContentProject.originType` 固定为 `HOTSPOT | MANUAL | DRAFT | IMPORT | LEGACY`，阶段固定为 `PLANNING | RESEARCH | MASTER_WRITING | PLATFORM_ADAPTATION | VISUAL | LAYOUT | REVIEW | COMPLETED`。
- 迁移 `018_planning_creative_unification.sql` 新增 `project_planning_versions` 和 `legacy_topic_project_mappings`。规划草稿与确认版本按工作空间和项目保存，旧选题映射保证重复迁移不产生重复项目。
- Fastify 新增 `GET/POST /creative/projects`、`POST /creative/projects/from-intelligence/:itemId`、`GET/PUT /creative/projects/:projectId/planning` 和 `POST /creative/projects/:projectId/planning/complete`。项目更新在 `workspace_snapshots` 行锁事务中迁移、修改并写回；热点创建按来源引用幂等。
- `CreativeProjectCenter.tsx` 替代旧规划/选题页面，展示真实项目、来源、阶段、平台、更新时间和单一下一步；创建入口只接受手工想法、草稿或导入内容。
- `PlanningWorkspace.tsx` 编辑规划决策稿并显示未保存、保存中、已保存和错误状态。确认前校验标题、角度、目标、受众、核心表达和至少一个平台；目标篇幅不进入规划字段。
- `CreateWorkspace.tsx` 使用 `creativeStages` 渲染七步单一导航。规划、研究和正文接入真实工作台；平台版本、配图、排版和审核在实现前只显示真实空状态，不提供假动作。
- `IntelligenceInbox.tsx` 不再接收 Topic；`projectForIntelligence()` 只以热点来源引用判断“已加入”。加入后直接进入项目，重复操作返回原项目。
- `today.mjs` 从 `ProjectStage` 派生真实下一步，`completedProjects()` 只返回完成项目；今天和复盘已删除旧选题与演示表现数据。
- 导航兼容读取旧 `view=plan`、`view=topicEditor` 和 `topic`，映射到 `view=create` 与对应 `legacyTopicId` 项目；新地址只保存 `project`、`stage` 和 `platform`。
- `tests/creative-workspace.e2e.py` 使用单一 API 路由 Mock 覆盖项目中心、创建、规划、研究、热点闭环、刷新恢复和旧 URL；脚本显式拒绝未声明 API，并断言没有触发模型、Tavily、RSS 刷新或 Agent 执行接口。
- 下一实现项为研究阶段零资料启动。现有 `ProjectAgent` 的 `RESEARCH` 阶段不应因资料数为零而完全阻断，但准备任务仍需冻结规划、用户请求和空资料快照；其后的搜索/读取动作继续走确认卡和证据对象。

## 2026-07-28 实现记录：创作项目中心列表与详情

- `src/domain/creative-project-center.mjs` 集中维护阶段筛选定义、筛选结果、选中项目回退和阶段下一步文案；对应 `.d.mts` 使用 `ContentProject` 与 `ProjectStage` 声明准确类型。
- `CreativeProjectCenter.tsx` 保留现有项目创建表单和 API 调用，只增加选中项目与移动详情状态。桌面表格行支持点击、Enter、空格和 `aria-selected`，主按钮继续调用原 `onOpenProject(project)`。
- 桌面列表列为项目、题材、目标平台、来源、阶段和更新时间；详情读取现有 `ProjectPlanning` 字段，不构造演示数据。空字段显示中性占位符，不伪造规划内容。
- `src/styles.css` 移除 `.creative-project-grid`、`.creative-project-card`、卡片主区和卡片页脚规则，新增 1100px 主从堆叠与 790px 移动抽屉断点。390px 下所有网格子项保持 `min-width: 0`，仅筛选和标签容器允许内部横向滚动。
- `tests/creative-project-center.test.mjs` 覆盖筛选、选中项回退和阶段动作；`tests/creative-workspace.e2e.py` 覆盖两个真实 Mock 项目、列表选择、详情切换、旧卡片消失、1024px 布局、390px 抽屉和横向溢出。
- 自动化仍拦截全部业务接口，并显式禁止百炼、Tavily、RSS 刷新和 Agent 执行调用。本次实现没有新增任何计费或外部请求。

## 2026-07-28 实现记录：零资料研究计划

- `src/domain/project-agent-composer.mjs` 提供 `researchQuickAction`、`canPrepareAgentRequest()` 和 `messagesForAgentThread()`；对应声明文件约束消息类型和准备条件，资料数量不再参与可发送判断。
- `server/index.cjs` 的统一研究 prepare 分支移除零资料拒绝，但继续读取项目、WritingBrief、`AGENT_PLANNER` 策略、READY 百炼凭据和 `researchSnapshot()`；非空资料 ID 仍按工作空间与项目严格校验。
- `buildResearchPlanPrompt()` 新增零资料规则：必须从已确认规划派生问题、建议来源和后续动作，不得把常识或推测当作已核验证据。
- `ProjectAgent.tsx` 将快捷动作与自由输入统一到 `prepare(nextRequest)`；0 条资料显示“未选资料”，唯一快捷按钮在没有活动运行时显示。`CONFIRMATION` 消息不进入普通线程，当前状态由确认卡单独渲染。
- `tests/creative-workspace.e2e.py` Mock 研究 prepare，断言请求中的两个资料数组为空、确认卡资料数为 0、重复确认消息不存在，并继续禁止任何 confirm、模型、检索和 RSS 请求。
- 本切片不增加数据库迁移，不执行 `SEARCH_WEB`、`READ_LINK` 或 Playwright 浏览，也不创建证据结论。

## 2026-07-28 实现记录：研究来源执行

- 迁移 `019_project_research_sources.sql` 新增 `project_research_source_runs` 和 `project_research_sources`，并登记 `project-research-sources:1.0.0`。来源执行继续复用 `generation_runs`、`jobs`、项目消息与项目产物。
- `project-research-sources.cjs` 负责筛出 `SEARCH_WEB`、`READ_LINK`、`ASK_USER`，生成来源确认摘要，并归一化 Tavily 与公开网页结果。每个搜索动作最多保留 5 条，整次最多 20 条，URL 规范化去重。
- `POST /creative/projects/:projectId/research/sources/prepare` 读取已完成研究计划并创建 DRAFT；`POST /creative/research-source-runs/:id/confirm` 是唯一入队边界；cancel 只取消尚未执行的运行。研究阶段活动运行同时识别研究计划与来源任务，避免并发覆盖。
- Worker 的 `PROJECT_RESEARCH_SOURCES` 任务逐项执行。`SEARCH_WEB` 调用 Tavily，`READ_LINK` 复用 `public-web.cjs` 及公众号受限 Playwright 回退，`ASK_USER` 保存为 `NEEDS_USER`。单条失败保存 `FAILED` 后继续，全部自动动作失败时运行标记失败。
- 结果产物类型为 `RESEARCH_SOURCES`。来源快照保存动作索引、状态、标题、URL、来源、摘要、获取时间和错误，不保存整页 HTML、Cookie 或登录状态。
- `ProjectAgent.tsx` 在研究计划预览中增加“准备查找资料”，来源确认卡只显示搜索、读取、补充数量、工具和写入范围，不显示不存在的模型、Prompt 或 Skill。来源结果按已保存、需补充和失败展示，刷新后恢复。
- 调用日志新增 `SOURCE_DISCOVERY`，前端显示“研究资料检索”。本任务不读取模型策略、不调用百炼，因此不存在模型 Token 或模型费用。
- 当前来源快照尚未经过事实核验。下一实现项为 `SOURCE_VERIFICATION` 模型策略、证据主张、支持/冲突关系与人工复核状态；配图、排版和审核继续保持禁用。

## 2026-07-28 实现记录：研究规划继承与 Agent 时间线修复

- `ProjectMaterials.tsx` 改为接收完整 `ContentProject`，在资料区上方渲染正式 `project.planning` 摘要；`CreateWorkspace.tsx` 直接传递当前项目，避免另建不同步的研究表单状态。
- `ProjectAgent.tsx` 为滚动容器增加 `threadRef`。消息末项、活动运行 ID/状态或最新产物变化后，在下一帧把 `scrollTop` 更新为 `scrollHeight`。
- `styles.css` 为 `.project-agent-thread` 增加 `grid-auto-rows:max-content`，并禁止直接子项被压缩。该修复解决长时间线中确认卡外框仅剩 2px、子按钮落到视口外且被父层截获的问题。
- `projectMaterials.cjs` 新增 `deriveProjectInputTitle()`，从正文首个非空行移除 Markdown 标题/列表前缀后截取 160 字；API 的项目内容标题改为可省略。新建弹窗隐藏标题字段，编辑弹窗继续显示。
- `creative-workspace.e2e.py` 增加规划摘要、新增内容无标题、长时间线自动跟随、计划卡与确认卡几何无重叠、点击命中和来源确认执行断言。自动化全部使用本地 Mock，不调用百炼或 Tavily。

## 2026-07-29 实现记录：简化研究工作流

- `server/services/project-agent.cjs` 在研究阶段上下文中返回统一运行的阶段和进度，供前端轮询展示。
- `src/data/webApi.ts` 提供 `startResearch`、`acceptResearchResult` 与 `skipResearch`；研究页不再调用旧的 prepare/confirm 客户端链路。
- `ProjectMaterials.tsx` 仅承担项目资料的新增、编辑、打开和删除；移除了研究资料勾选、全选、研究引用提示和重复进度。
- `ProjectAgent.tsx` 在 `RESEARCH` 阶段分流到 `SimplifiedResearchAgent`，仅呈现开始或补充研究、运行状态、结构化结果、采用和跳过；`COPY` 阶段继续使用通用对话 Agent。
- `CreateWorkspace.tsx` 在采用或跳过后先更新项目，再跳转到正文阶段，避免刷新后回到过期研究状态。
- `styles.css` 新增结果卡、折叠来源详情和 1100px/720px/460px 响应式规则；视觉 QA 已确认桌面双栏与移动单列均无横向滚动。
- `tests/project-research-agent.test.mjs` 更新为简化路径契约；`tests/creative-workspace.e2e.py` 使用 Playwright Mock 覆盖开始研究、轮询、结果采用和正文跳转。

## 2026-07-29 实现记录：来源筛选与事实核验

- `020_source_verification.sql` 为 `project_research_sources` 增加 `metadata_json` 和 `selected`，扩展 `project_artifacts` 类型约束，并新增 `project_source_verifications`。
- `project-research-sources.cjs` 新增来源类型、语言、发布时间、相关度归一化和 `recommendSourceSelection()`。Worker 保存质量字段，并按官方性、相关度和语言最多推荐 8 条。
- `source-verification.cjs` 使用 Zod 定义严格输出：主张、四种状态、支持/冲突关系、引用和说明。解析阶段校验主张全集与唯一性、所选来源 ID、非空摘要原文引用、单一来源和多源通过状态条件，并允许一次模型修复。
- `SOURCE_VERIFICATION` 已加入任务策略、调用日志和提示词模板。prepare 从 `templateStore` 冻结当前模板版本与模型路由，confirm 才创建同名 Job。
- Worker 只向模型传递已选来源的标题、摘要、URL、来源元数据和研究计划主张；成功后生成 `RESEARCH_VERIFICATION` 候选产物，失败时不生成结论。
- `ProjectAgent.tsx` 继续承担研究交互：来源预览可勾选、全选、清空，确认卡显示模型与来源数，核验结果显示状态、解释、原文引用和链接。采用核验结论只更新研究产物与阶段摘要，不改写正文。
- `research-source-selection.mjs` 集中维护可选来源集合和切换逻辑。`creative-workspace.e2e.py` 覆盖选择恢复、零选择禁用、prepare、confirm、结果预览、确认结论和 390px 无溢出。
- 研究计划和核验结论虽然都包含 `claims`，前端按 `artifact.type` 分支读取；E2E 明确断言计划弹窗没有核验卡、核验弹窗没有计划主张块，并生成 `research-sources-desktop.png` 与移动端截图。
- 下一实现项是让正文 Agent 只读取已确认的 `RESEARCH_VERIFICATION`，并把 `CONFLICTING`、`NEEDS_REVIEW` 继续保留为待核验项。

## 2026-07-29 实现：最小输入与自动保存

- `project-planning.cjs` 新增 `planningWithDefaults()`；保存和确认时只补齐空值，不覆盖用户已有输入。
- `PlanningWorkspace.tsx` 使用 700ms 防抖保存最小规划字段，详情字段折叠展示；确认前会等待未完成的保存。
- `ProjectAgent.tsx` 用 `showResearchSupplement` 控制补充研究输入，已有结果时默认只保留采用动作与次级补充入口。
- `CreateWorkspace.tsx` 在读取到空 `WritingBrief` 时立即保存默认策略；`CopyWorkspace.tsx` 为策略编辑增加防抖保存、保存态和失败重试，Agent 不再依赖手工保存。
- 本切片没有新增模型、百炼 CLI、Tavily、Playwright 读取或发布调用。

## 2026-07-29 修复：正文空白的默认生成

- `project-copy-action.cjs` 将正文为空且未能识别为其它明确动作的请求默认映射到 `GENERATE_DRAFT`；因此“开始”“正文”等自然启动语会准备完整正文候选，而不会出现多余的路径反问。用户明确要求“大纲”时仍保留大纲动作。

## 2026-07-29 实施：正文动作优先工作台

- 新增 `src/domain/copy-action-panel.mjs` 与类型声明，统一管理正文面板状态和动作请求。
- `ProjectAgent` 的 COPY 分支移除对话历史、自由输入发送和确认调用卡；点击动作后调用 `prepareAgent()` 并立即调用 `confirmAgentRun()`。
- `CopyWorkspace` 将当前正式正文是否为空显式传入 Agent。右侧面板按空正文、正文、选区、候选四种状态切换。
- 当前平台的大纲候选和正文候选都会自动弹出 `CopyCandidateDialog`；采用前不写入正式版本。
- 新增 `copy-action-panel` 样式：固定窄面板、单一补充输入、清晰的排队/运行/候选状态，响应式下降为单列。
- `buildCopyPrompt()` 新增主题锁和事实锁：禁止以单条研究事件替换项目主题，禁止将未经 `verifiedFacts` 支撑的日期、单位、人数、引语、会议或能力写成确定事实。

## 2026-07-29 修复：简化研究来源等待上限

- 简化研究工作流只执行研究计划中前 2 条自动来源动作；其余动作不再在同一轮研究中串行等待。此前模型最多可返回 8 条自动动作，而 Tavily 与网页读取各自有网络超时，叠加后会让界面长期停在“正在检索”。

## 2026-07-29 实现：正文事实隔离与质量审稿

- `project-copy-action.cjs` 新增待复核主张归一化、项目/Brief 安全快照和正文事实边界校验。待复核主张不再从 `project.coreViewpoint`、`planning.coreMessage` 或 `WritingBrief.coreMessage` 重复进入写作上下文；原始待复核项仅以禁止写入区的形式提供给模型。
- `parseCopyOutput()` 在 Markdown 结构校验之后继续检查正文是否复述待复核主张，防止模型删掉限定词后把同一主张写成确定性内容。
- 新增 `buildCopyQualityReviewPrompt()` 与 `parseCopyQualityReview()`。审稿模型只接收候选、`verifiedFacts` 与 `cautions`，返回 `approved + issues`，不允许用模型已有知识补全事实。
- `generateProjectCopyAction()` 的正文路径变为：生成/结构修复 → 质量审稿 → 基于审稿问题重写一次 → 二次审稿。二次不通过时任务失败并返回“研究事实不足，暂不生成正文”，不会创建候选、平台版本或正式稿。
- 审稿调用复用当前 `CONTENT_WRITING` 路由并累计写入本次 `PROJECT_COPY` 的 Token 用量；不引入隐式兜底模型。

## 2026-07-29 实现：账号声音链接蒸馏

- `server/services/public-web.cjs` 新增 `readPublicArticle()`：复用 URL 安全校验、公众号浏览器回退与验证页阻断，提取正文后仅在内存中截断到 30,000 字符。
- 新增 `server/services/voiceCalibration.cjs`，定义授权输入、严格结构化规则草案、提示词和 JSON 解析。提示词明确禁止模仿作者、复写全文、摘抄独特句子以及虚构身份。
- `POST /api/v1/account-voices/calibration-drafts` 读取文章后调用 `VOICE_CALIBRATION` 路由，成功或失败均写入 `api_usage_logs`；接口响应不返回原文，数据库不保存原文。
- `AccountVoiceSettings.tsx` 重构为低密度三屏：列表、导入链接、确认规则。导入结果只让用户命名和编辑四项规则；默认声音和链接校准元数据在保存时一并写入。
- 模型任务策略、前端领域类型、调用记录名称和模型筛选均纳入 `VOICE_CALIBRATION`，只接受文本能力模型。
- 二次实现将蒸馏结果扩展为“声音指纹 + 6 至 8 项样本诊断 + 执行规则”。输出缺少诊断或扩展规则时，服务端会使用同一模型执行一次结构修复，再决定是否返回结果。

## 2026-07-29 实现：文案页账号声音状态条重构

- `CopyWorkspace.tsx` 将原先只有名称、语气下拉和管理按钮的大面积状态条重构为紧凑三段式区域：左侧显示当前账号声音及实际开篇规则，中部可选择本篇使用的账号声音与语气偏移，右侧提供“编辑声音”入口。
- 切换 `accountVoiceProfileId` 与 `voiceOffset` 均复用现有 700ms 自动保存，不引入额外接口或本地临时状态。未选择账号声音时，明确显示“暂不使用”，避免把默认账号声音和本篇规则混为一谈。
- `styles.css` 保持现有深蓝边线与马卡龙浅黄、浅绿，不新增动效依赖；桌面紧凑横向排列，790px 以下拆为摘要和控件两行，560px 以下控件两列并保证无横向溢出。

## 2026-07-29 修复：账号声音蒸馏输出兼容与错误边界

- `voiceCalibration.cjs` 在严格 Zod 校验前归一化诊断维度的说明后缀，并从同维度诊断补足缺失的读者关系、钩子和标题执行规则；这只处理已有样本观察，不伪造额外诊断。
- 中文诊断结论最低长度调整为 6 个字符，仍要求结构依据与至少六个不重复维度。提示词与修复提示均提供完整 JSON 形状和八个允许维度，降低模型继续输出旧格式的概率。
- `server/index.cjs` 将修复两次后仍不合格的结构错误转换为“模型返回的账号声音结构不完整，已尝试修复，请重新提炼。”；调用日志保留错误状态，前端不再接收 Zod 明细。

## 2026-07-30 实现：账号声音审核页信息架构重排

- `AccountVoiceSettings.tsx` 将确认页改为“规则摘要 → 来源 → 样本诊断 → 执行摘要 → 按需编辑 → 保存”的单一审核路径。新增本地 `rulesExpanded`，四项文本规则不再默认展开。
- 诊断区采用两列可阅读卡片，每张卡片将维度、结论和样本依据分区；执行规则使用三列紧凑摘要并截断超长文本，避免大段原始规则挤占首屏。
- `styles.css` 将账号声音容器扩展至 1280px，审核卡最大宽度提升至 1120px；960px 时切换为两列执行摘要，790px 以下诊断与规则变为单列，560px 以下保存操作纵向排列。
- 保持既有 Lucide 图标和 CSS 轻量 hover/active 反馈，不新增动画库或全局依赖。

## 2026-07-30 实现：平台版本阶段推进

- `applyAcceptedCopyToState()` 在首篇文案候选被采用时，将项目从 `MASTER_WRITING` 推进到 `PLATFORM_ADAPTATION`；已处于后续阶段的项目不会被修订文案拉回。
- `CreateWorkspace.tsx` 为平台版本提供独立工作页，复用真实的渠道编辑、候选与 Agent 记录，并在正文采用后自动切换到该页。
- `POST /creative/projects/:projectId/platform-versions/complete` 锁定工作空间快照，验证每个目标图文平台都有至少 80 字的正文，再原子推进为 `VISUAL`；前端只在该接口成功后跳转配图。
- 平台版本页使用轻量绿色阶段头提示当前任务，不新增假进度或未实现的配图按钮。

## 2026-07-30 实现：正文候选完整预览

- `CopyCandidateDialog.tsx` 为 `PLATFORM_COPY` 候选增加“完整文稿 / 段落差异”页签；默认进入完整文稿，并在切换候选时重置为该视图。

## 2026-07-30 Fix: optional account voice in copy generation

- Empty `accountVoiceProfileId` now returns a null account voice context without querying the voice profile store.
- A selected but unavailable voice remains a blocking validation error.
- Regression test verifies that copy generation context still has SUBJECT, CONTENT_TYPE, and CHANNEL strategies without a voice snapshot.

## 2026-07-30 Fix: keep a no-voice copy candidate after generic cleanup

- `worker.cjs` keeps one automatic generic anti-cliché rewrite for every copy candidate.
- The post-rewrite and post-review hard failures now run only when `snapshot.accountVoice` exists. Choosing “暂不使用” can no longer turn generic phrasing into an “账号声音检查未通过” failure.
- `project-copy-action.test.mjs` locks both worker guard conditions so this boundary cannot silently regress.

## 2026-07-30 Fix: preserve existing unverified claims during a revision

- `parseCopyOutput()` now distinguishes generation from revision actions. A revision can retain a claim already present in the current draft only when the candidate also retains that claim in `factsToVerify`.
- Revision prompts state that this exception is preservation, not verification: the model cannot introduce, expand, infer from, or present the claim as confirmed.
- New regression coverage accepts a compliant `RESTRUCTURE_DRAFT` candidate and rejects the same candidate when its verification list is empty.

## 2026-07-30 Fix: unify preserved-caution handling across the copy pipeline

- `preservedExistingCautions()` derives the only revision exception from the frozen current body and research cautions.
- `parseCopyOutput()` automatically appends a permitted inherited claim to `factsToVerify`; a claim not present in the frozen original still fails validation.
- `buildCopyQualityReviewPrompt()` now receives the action and frozen current content, passes `allowedExistingCautions` to the reviewer, and makes preservation conditional on the candidate verification list.
- Both initial and second quality-review calls in `worker.cjs` pass the identical frozen context.
- 完整文稿按自然段连续渲染在弹窗可滚动主体内；原有 LCS 段落差异计算不变，移动端仍沿用全屏弹窗与固定操作栏。

## 2026-07-30 Fix: candidate-quality review is advisory

- `candidateQualityReview()` 将质量审稿映射为 `PASSED` 或 `NEEDS_REVIEW`，仅在候选已具备合法结构时写入产物元数据。
- Worker 保留初次审稿和一次自动改写；二次审稿未通过不再抛出“研究事实不足”错误，而是保存 `qualityReview`、候选版本及运行结果为成功。
- `CopyCandidateDialog` 和 Agent 的产物预览都会在正文前显示精简的人工确认问题，待核验清单继续独立显示。

## 2026-07-30 Fix: candidate review prioritizes reading

- 候选弹窗统一将审稿问题和 `factsToVerify` 去重为折叠的 `发布前核验` 区块，默认只展示待处理数量。
- `candidate-copy-preview` 使用固定的最小阅读高度与内部滚动；完整文稿和段落差异分别在各自阅读面板内滚动。
- 候选采用动作统一命名为“采用到正文”，避免误解为已通过发布审核。

## 2026-07-30 Fix: separate project and candidate fact checks

- Worker 不再把 `project.factChecks`、当前版本和内容母版的历史核验项并入 `output.factsToVerify`；候选版本仅持久化模型输出及受控继承的直接关联项。
- 候选采用接口不再从任务快照重新回填三类历史核验项，只将 `candidate.facts_to_verify_json` 合并入现有项目核验池。
- 文案提示词明确要求 `factsToVerify` 仅列本稿直接涉及的待核验事实，禁止回填无关历史项。

## 2026-07-30 实现收口：研究按需，创作页合并

- `creativeStages` 仅渲染 `planning`、`master`、`visual`、`layout`、`review` 五个用户步骤；`research` 和旧 `platform` 路由仅保留兼容与按需入口。
- `PLATFORM_ADAPTATION` 项目状态映射回 `master`。旧 `stage=platform` 地址自动回到创作页，避免刷新后进入重复页面。
- `CopyWorkspace` 顶部新增“补充研究”入口，并在 `PLATFORM_ADAPTATION` 状态内联渲染确认操作，调用已有 `completePlatformVersions()` 后进入配图。
- 主稿与平台版本继续分开持久化，前端只通过同一编辑器的平台切换展示，因此不会丢失公众号、小红书、知乎和微博的渠道规则差异。

## 2026-07-30 实现：图文交付后半段

- `ContentProject.delivery` 保存选中的视觉素材、各渠道发布稿和审核确认记录；项目整体存入独立 `content_projects.project_json`，不再写回工作空间快照。
- `PUT /creative/projects/:projectId/visual` 保存封面与素材选择；`POST /visual/complete` 将项目推进至 `LAYOUT`。
- `POST /layout/generate` 以项目当前正文和已选素材生成渠道发布稿。公众号、知乎为 HTML，小红书、微博为 Markdown；`POST /layout/complete` 才进入审核。
- `POST /review/complete` 只接受项目当前待核验项的人工确认，并将项目推进为 `COMPLETED/SCHEDULED`。前端使用浏览器 Blob 下载对应 HTML 或 Markdown，未把私有素材文件错误地伪造成公开 URL。
- `VisualWorkspace`、`LayoutWorkspace`、`ReviewWorkspace` 取代三个旧占位页。服务端保留阶段校验，前端按钮不能绕过当前项目阶段。
## 2026-07-30 实现：渠道级交付状态

- `ContentProject.delivery` 改为 `platforms` 映射，每个渠道独立保存 `COPY/VISUAL/LAYOUT/REVIEW/READY` 状态、已选素材、排版稿和审核确认。
- `platform-versions/complete`、视觉、排版和审核 API 均要求 `platform`；公众号完成正文不会检查知乎、小红书或微博正文。微博正文确认后直接进入排版，其余图文渠道进入素材步骤。
- `CreateWorkspace` 顶部只保留项目级“规划、创作”，创作页按当前渠道状态渲染 `CopyWorkspace`、`VisualWorkspace`、`LayoutWorkspace` 或 `ReviewWorkspace`。
- `CopyWorkspace` 渠道标签显示“文案中/配图中/排版中/审核中/已就绪”，且每个渠道的目标篇幅在 `platformSkills` 保存。服务端读取写作上下文时使用当前渠道篇幅。
- 旧快照的项目级交付字段在读取时兼容转换为渠道映射，避免旧项目因本次升级无法打开。

## 2026-07-30 修复：研究简报、核验隔离与配图阶段门

- `project-research.cjs` 的研究计划新增 `researchBrief`：`subject`、`directions`、`keywords`、`preferredChannels`、`searchQueries`。提示词要求查询词包含实体、事实目标和来源线索，并针对财经、IPO 和科技选题设置第一方渠道优先级。
- `simplified-research.cjs` 将研究简报写入统一研究结果，并记录核验为完整、部分恢复或失败。旧结果仍可读取，前端只在新字段存在时展示简报。
- `source-verification.cjs` 新增逐来源结果合并。两个独立支持来源提升为 `VERIFIED`，一个支持来源为 `SINGLE_SOURCE`，支持和冲突并存为 `CONFLICTING`，其余保持 `NEEDS_REVIEW`。
- `worker.cjs` 先执行原多来源核验；结构或引用校验失败时自动逐来源重试，忽略失败来源并合并成功结果。全部失败时记录明确诊断，不再静默吞掉异常。
- `channel-workflow.mjs` 统一 `COPY/VISUAL/LAYOUT/REVIEW/READY` 与正文、配图、排版、审核四个页面的解锁关系。`CreateWorkspace` 使用安全步骤渲染，后续标签显示禁用态。
- `VisualWorkspace` 在无正文时不启动配图方案自动保存；`PUT /creative/projects/:projectId/visual` 在读取素材前再次验证当前渠道正文不少于 80 字。
- `ProjectAgent` 的研究结果新增研究主体、方向、关键词、渠道和查询词展示；沿用现有浅蓝信息层级和控件圆角，不引入新的页面说明或动效依赖。

## 2026-07-31 修复：研究结果恢复与中断任务接管

- 研究页按产物创建时间选择最新 `RESEARCH_RESULT`，同时识别 `CANDIDATE` 和 `ACCEPTED`。采用结果后再次进入研究页，继续显示本次已采用结果，不再回退到旧候选。
- 采用研究结果时，同一项目更早的候选和已采用结果统一转为 `REJECTED`，保证项目只有一份当前研究基线；新生成的补充研究候选仍可覆盖展示。
- Worker 允许 BullMQ 在进程重启后重新接管数据库中仍为 `RUNNING` 的任务，并将对应生成运行重置为可重跑状态，避免 Redis 已完成而数据库永久卡住。
- 研究运行增加“取消任务”入口。取消后 Worker 在保存产物前再次锁定并检查运行状态，不会把已取消任务的迟到结果写回项目。
- 研究状态轮询成功后会清除瞬时 502 错误，避免服务恢复后仍持续显示旧错误。

## 2026-07-31 修复：研究事实对账与正文质量门禁

- `project-copy-action.cjs` 新增 `reconcileFactsToVerify()`：先归一化事实文本和数字签名，再用包含关系与最长公共子序列识别已核验事实的改写版本，避免模型换一种说法后重新标成待核验。
- `worker.cjs` 在保存 `PLATFORM_COPY` 前，以本次不可变研究快照的 `verifiedFacts` 对候选 `factsToVerify` 做对账；研究内容是否进入正文不再依赖前端展示推断。
- `project-agent.cjs` 的候选产物投影补充 `qualityReview`。`CopyCandidateDialog` 与 `ProjectAgent` 分别渲染“正文需重写”和“发布前核验”，不再把审稿问题拼入核验清单。
- `POST /api/v1/creative/project-artifacts/:id/accept` 对 `qualityReview.status === 'NEEDS_REVIEW'` 的正文候选返回 409；前端采用按钮同步禁用，形成双层门禁。
- 现有宇树科技候选 `35bf3755-5c3c-43ab-9cab-7cd22e39314f` 已从误采用状态退回 `CANDIDATE`，正式公众号正文恢复为空，错误内容母版标记为 `REJECTED`。候选只保留“注册生效”一项真正待核验事实，五项无证据推演保留在质量审稿中。

## 2026-07-31 修复：账号声音残留问题不再导致空正文

- 真实运行 `914a27db-5932-4219-ab9f-59a7dad62058` 与 `9b992e8e-86b7-4f6d-ab84-935249afa772` 均在正文与声音修正完成后，因为全局禁用短语“这意味着”仍存在而被标记为 `FAILED`；两次分别消耗约 9700 输入 Token 和 1700 输出 Token。
- `worker.cjs` 不再在首次声音修正或质量重写后抛出“账号声音检查未通过”。最终正文统一再次执行声音检查，并将结果传给候选质量状态。
- `candidateQualityReview(review, voiceIssues)` 对事实审稿问题和账号声音问题去重合并；存在任一问题时保存 `NEEDS_REVIEW` 候选，没有问题时保存 `PASSED`。
- 该调整不降低采用标准：现有前后端质量门禁继续阻止未通过候选进入正式正文，只改变“丢失结果”为“保留结果供用户审核和重写”。

## 2026-07-31 实现：有效正文不再被异常审稿销毁

- `server/services/project-copy-action.cjs` 新增质量问题归一化：审稿模型返回字符串数组时保持原值，返回对象数组时提取问题、描述、原因和建议并合并为文字。
- 新增 `parseCopyQualityReviewSafely()`。无法解析审稿 JSON 或无法满足契约时不向上抛错，而是返回 `approved: false`、`malformed: true` 和人工检查提示。
- `server/worker.cjs` 将账号声音自动修正、首次质量审稿、质量重写和复审视为正文后的次级步骤。任一步骤失败均累计到 `pipelineIssues`，保留最近一次已通过 `parseCopyOutput()` 的正文并继续创建候选产物。
- 审稿提示词明确要求 `issues` 必须为字符串数组，降低模型再次输出对象数组的概率；解析层仍保留兼容处理，不能依赖提示词保证稳定性。
- 候选质量状态继续由 `candidateQualityReview()` 汇总审稿、声音与流水线问题。异常候选为 `NEEDS_REVIEW`，不会绕过现有采用门禁。

## 2026-07-31 实现：一次生成并保存最终正文

- `server/services/project-copy-action.cjs` 新增 `buildWritingPacket()`、`buildFinishedCopyPrompt()`、`parseFinishedCopyBody()` 和 `copyActionPersistenceMode()`。资料包只保留作者材料、平台规则、账号声音、Skill、顶层已核验主张和禁止主张，不复制 evidence quote 或参考文章原文。
- `server/worker.cjs` 的 `GENERATE_DRAFT` 先调用 `prepareCopyResearchContext()`。它优先复用已采用研究或作者材料，必要时复用研究计划、来源抓取和事实核验函数；研究用量与最终写作用量归到同一 `PROJECT_COPY` 任务。
- 最终成稿使用纯文本契约并只调用一次写作模型。Worker 不再导入或调用 `buildCopyRepairPrompt()`、`buildCopyQualityReviewPrompt()`、`detectVoiceViolations()`、`candidateQualityReview()` 或 `parseCopyQualityReviewSafely()`。
- 首次正文事务创建 `ACCEPTED` 的 `PLATFORM_COPY`，必要时创建 `CONTENT_MASTER`，写入 `platform_content_versions`，并通过 `updateCreativeProjects()` 与 `applyAcceptedCopyToState()` 只更新目标项目行和阶段摘要。

## 2026-08-01 修复：工作空间与项目存储边界

- `025_normalized_content_projects.sql` 将项目从 `workspace_snapshots` 迁移到 `content_projects`；`026_normalize_content_project_timestamps.sql` 将历史短时间字段统一为 ISO 时间。
- 正式 Web 删除整份 `PUT /workspace/state` 覆盖写入，只保留 `PATCH /workspace/preferences` 保存工作空间偏好。项目、来源、情报和正文分别通过各自业务接口持久化。
- `updateCreativeProjects()` 锁定工作空间和项目行，拒绝重复项目 ID 与隐式删除，只写实际变化的项目；单纯排序只更新 `position`，不会增加项目 revision。
- 手工链接与网络搜索收藏统一写入 `intelligence_items`，按规范化 URL 幂等保存，不再用前端临时 ID 冒充持久化成功。
- 网络选图通过服务端下载为 `FILE` 素材：每次重定向重新执行 SSRF 校验，限制 15MB，流式截断，校验 JPEG/PNG/WebP/GIF 魔数并保存 SHA-256；前端预览和后续使用不再依赖外站 URL。
- 非首次动作仍使用现有结构化修改契约，但每个用户动作只调用一次模型并保存 `CANDIDATE`，不覆盖正式正文。
- `ProjectAgent.tsx` 监听首次任务完成，读取最新项目后通知 `CopyWorkspace` 更新编辑器；候选不再自动弹出。`CopyCandidateDialog.tsx` 删除 AI 质量问题和发布前核验门禁，只保留全文、段落差异与用户采用/放弃操作。
- `023_finished_copy_workflow.sql` 将历史 `PLATFORM_COPY + CANDIDATE + NEEDS_REVIEW` 产物更新为 `REJECTED`，不删除正文、审稿或运行记录。
- API 为首次正文任务始终冻结 `researchRoute` 和 `verificationRoute`：有独立百炼策略时使用对应模型，否则复用 `CONTENT_WRITING` 的模型与连接。`prepareCopyResearchContext()` 对整个自动研究阶段设置故障边界，任何研究异常都回退到任务快照中的已保存上下文后继续最终写作。

## 2026-07-31 修复：正文母版版本唯一键冲突

- 失败调用 `d7dcec13-2641-4a8b-8daf-f1665884e321` 已确认模型正常返回，事务在插入 `content_master_versions.version_number = 1` 时与历史 `REJECTED` 母版冲突。
- 新增 `content-master.cjs`，以项目级 PostgreSQL 事务锁统一读取最新已采用母版、历史最大版本号和父版本；没有可复用母版时使用 `MAX(version_number) + 1` 创建新版本。
- 首次正文自动保存与后续采用修改共用相同母版状态逻辑，不再分别硬编码版本 1；并发执行同一项目时由事务锁串行化母版版本分配。

## 2026-07-31 修复：平台正文 Markdown 自动归一化

- 数据库调用记录确认：20:21 的小红书和 20:23、20:26 的知乎任务均已获得模型正文，最终因正文包含 Markdown 小标题或强调标记而被本地校验拒绝；20:24 的微博正文不含这些标记，因此正常保存。故障不在模型路由或平台 Skill。
- `project-copy-action.cjs` 新增 `normalizeFinishedCopyBody()`。首次成稿保存前确定性处理 Markdown 标题、强调、删除线、引用、列表、行内代码和链接，不发起第二次模型调用。
- 若模型重复输出已锁定标题，归一化会删除正文首行的同名标题，避免编辑器标题区与正文重复；列表统一为纯文本项目符号，保留小红书和知乎所需的可读结构。
- JSON 对象、代码围栏、内部字段泄漏、空正文、清理后不足 80 字或超过 30000 字仍然拒绝，格式兼容不会降低内容安全和完整性门槛。

## 2026-07-31 实现：配图风格库与可控重新规划

- 原生浏览器确认框替换为应用内“重新规划配图方案”对话框，明确列出会更新的配图位置、图片类型、搜索词和生图提示词，以及会保留的项目风格、配图数量和文章封面。
- 重新规划默认保留所有已选图片。用户可主动取消“保留已选图片”，此时只解除正文图片与配图位置的绑定，不删除素材文件；封面始终保留。
- 配图风格从 5 套扩充为 17 套，按编辑与纪实、知识与信息、插画与创意、东方与文化、科技与产业分组。每套预设提供配色样本、适用说明，以及配色、光线、构图、材质、字体气质和视觉禁区组成的可执行提示词。
- “波普怀旧”升级为“清新波普怀旧”，明确薄荷绿、婴儿蓝、珊瑚粉、奶油黄、丝网印刷网点和轻微错版质感，同时排除棕黄旧照片、霓虹渐变和厚重做旧。
- 项目风格新增最多 1200 字的统一补充要求，一次保存后自动进入所有跟随项目风格的图片提示词；每张图片仍可使用单图风格覆盖项目预设。
- 风格选择使用应用内分组风格库，桌面端三列、移动端单列，操作区固定且无横向溢出。页面继续沿用现有浅色工具台视觉，不增加无关说明或装饰动画。

## 2026-07-31 实现：配图案例模板与单提示词协议

- 独立负面提示词从配图项类型、保存协议、生图接口、百炼 CLI 参数和前端高级设置中删除。错别字、乱码、水印、虚构标识等禁止项统一进入最终提示词，避免两份规则冲突。
- `VISUAL_PLAN_VERSION` 升级为 5。旧版项目配图方案在加载时重新编译最终提示词，并移除遗留的 `negativePrompt` 字段，已有素材绑定继续保留。
- 项目风格由 17 套扩展为 25 套，新增黑白刊物、现代报刊、生活方式摄影、咨询报告、科普图谱、铅笔线稿、木刻版画和工业纪实。
- 风格选择器改为分类案例画廊。每次只显示当前分类，卡片直接呈现版式、构图、图文密度、色彩和材质差异；右侧固定展示选中案例的大预览、用途、色板及项目统一补充要求。

## 2026-08-03 修复：公众号母稿不再混入跨平台写作规则

- 根因位于 `CopyWorkspace.tsx`：页面虽然固定 `selectedPlatforms = ['WECHAT']`，仍遍历完整 Skill 目录渲染 `LAYOUT/CHANNEL`，因此公众号下拉框出现“小红书分页图文、知乎回答、微博单条与串文”。
- `CopyWorkspace.tsx` 删除两个平台规则选择器，Skill 分组只读取 `SUBJECT/CONTENT_TYPE`；页面保留目标篇幅、账号声音和本篇语气。
- `CreateWorkspace.tsx` 统一用 Skill slug 解析固定公众号 `LAYOUT/CHANNEL`。读取旧 Brief 时检查平台数组、平台规则键、固定规则版本和篇幅一致性，不符合时通过 `webCreative.saveBrief()` 保存规范化结果。
- `writing-brief.cjs` 将请求契约收紧为 `selectedPlatforms: ['WECHAT']` 和严格的单键 `platformSkills.WECHAT`；`creativeSkills.cjs` 在查询 Skill 或开启事务前再次拒绝非公众号输入，防止绕过路由 Schema。
- `creative-skills.test.mjs`、`writing-brief-input.test.mjs` 和 `creative-workflow.test.mjs` 覆盖 UI、Schema、Store 三层边界；`creative-workspace.e2e.py` 注入旧四平台 Brief 和完整旧 Skill 目录，验证自动规范化请求只保留公众号固定规则。
- 真实登录 Chrome 已刷新宇树科技项目：写作策略标签为题材、内容类型、目标篇幅，五个旧字段/选项均不存在，状态为“已自动保存”，应用错误数和控制台错误均为 0，页面无横向溢出。
- 最终验证通过：全量 `436/436` 单元测试、TypeScript 类型检查、生产构建、`server/index.cjs` 与 `server/worker.cjs` 语法检查、创作工作区 E2E 和差异检查。
- 本修复未创建或执行迁移 `029`，未删除历史数据，也未把 Task 13 标记完成。

## 2026-08-03 修复：公众号配图策划单次调用与图文职责

- 用户只控制项目风格和正文插图数量；封面固定 1 张，公众号总量最多 12 张。核心 Agent 阅读完整母稿后自行决定每张图的插入段落、画面任务、视觉类型、正文依据、搜索词和生图指令。
- `WECHAT_VISUAL_PLANNING` 是唯一配图策划任务策略。一次用户操作只调用一次所选模型；删除模型输出不合格后的隐藏二次修复，不回退到正文模型，也不自动产生额外 Token。
- 策划输出契约按图片职责区分：照片、主体主视觉和真实场景使用 `ILLUSTRATION`，允许 `contentBlocks = []`，默认不生成图内文字；只有流程、时间、对比、数据或结构关系使用 `INFOGRAPHIC`，并要求 1 至 6 个必要短标签。
- 搜图词必须描述可直接看到的主体、动作、地点、器物或场景，每条不超过 60 个字符；继续拒绝模板、字体、排版、PPT、信息卡、海报等设计形式词。
- 配图请求参数错误返回 `VISUAL_PLANNING_INPUT_INVALID`；模型方案错误返回 `VISUAL_PLANNING_OUTPUT_INVALID`。两类错误不再被统一映射为“提交内容不完整”，失败不会写入草稿或覆盖现有方案。
- `VISUAL_PLANNING_PROMPT_VERSION` 升级为 `1.1.0`。本次无数据库迁移、无历史数据修改、无模型重跑。
