# 内容引擎技术实施方案

> 版本：Web-first v1.0
> 更新：2026-07-24
> 适用阶段：P0-P2

## 1. 架构决策

产品采用 Web-first 架构。浏览器负责交互和内容编辑；服务端负责身份、主数据、外部调用、凭据保护和任务调度；异步 Worker 负责百炼 CLI、媒体任务和后续渲染。

Electron 不再是产品运行时依赖，仅保留为早期原型与迁移参考。用户不需要安装桌面客户端。

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
| Web 前端 | 登录、工作空间、编辑部页面和 API 客户端 | 已建立 |
| Fastify API | 认证、工作空间、凭据、情报与任务 API | 已建立 |
| PostgreSQL | 用户、工作空间、凭据、情报、任务和审计主数据 | 已建立初始迁移 |
| Redis/BullMQ | 延迟任务、异步任务、重试与 Worker 通信 | 已建立骨架 |
| 百炼 CLI Runner | 每个任务临时注入 Key 并执行 CLI | 已建立骨架 |
| Skill 注册表与 Agent 计划 | 内置 Skill、受限计划、确认前运行记录 | 已建立，真实百炼计划待用户验收 |
| RSS/剪藏/Tavily 服务 | 合规信息采集和候选搜索 | 已建立，Tavily待真实 Key 验收 |
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
| `intelligence_sources` / `intelligence_items` | 资讯来源和情报记录；服务端在读取与 RSS 刷新时删除超过 30 天的数据 |
| `jobs` / `api_usage_logs` | 异步任务、模型调用与错误记录 |
| `workspace_snapshots` | 从早期原型迁移的临时状态桥 |

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
GET  /api/v1/workspace/state
PUT  /api/v1/workspace/state
GET  /api/v1/settings/credentials/:provider
PUT  /api/v1/settings/credentials/:provider
POST /api/v1/intelligence/rss/refresh
POST /api/v1/intelligence/clip
POST /api/v1/intelligence/search
POST /api/v1/jobs/bailian-text
GET  /api/v1/jobs/:id
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

## 7. 核心 Agent 与 Skill 注册表

### 7.1 Agent 边界

核心 Agent 运行在服务端，是“计划器”而不是自由执行器。它只能从注册表选择已启用的 Skill，Skill 只能调用其清单中允许的工具。任何工具调用都通过 API/Worker 执行，不允许模型自行构造任意命令、URL、数据库查询或发布动作。

### 7.2 数据模型

| 表 | 责任 |
| --- | --- |
| `skill_definitions` | 平台内置或工作空间自定义 Skill 的稳定 ID、所有者、执行目标和启用状态 |
| `skill_versions` | 输入/输出契约、提示词、工具白名单、Scope、质量规则和版本号 |
| `topic_skill_packs` | 题材包对基础 Skill 的规则覆盖和启用组合 |
| `agent_model_policies` | 工作空间中 Agent 规划与各 Skill Scope 可用的模型路由 |
| `agent_plans` | 用户请求、上下文快照、结构化步骤、状态与确认时间 |
| `generation_runs` | 单个 Skill 运行的来源、模型、提示词、用量、结果与错误 |

### 7.3 计划协议

核心 Agent 输出严格 JSON：`goal`、`contextSummary`、`steps[]`、`risks[]`、`estimatedCost`。每个步骤必须引用一个 `skillVersionId`、声明输入资产、预期输出和是否需要确认。API 在保存计划前验证所有 Skill、Scope、输入和权限；无效步骤直接拒绝，不进入 Worker。

### 7.4 P0 实现方式

P0 先提供代码内置、数据库登记的通用 Skill。用户可以选择题材包，但不能在 P0 上传任意脚本或 Prompt 执行。P1 再提供受限的 Skill 编辑器和审批流程。

## 8. 信息采集安全

- RSS 和链接剪藏只允许 HTTP(S) 公开地址。
- 服务端校验 DNS，拒绝 `localhost`、局域网、私有 IP、携带账号密码的 URL 和超大响应。
- 最多跟随有限次跳转，并对跳转目标重复校验。
- 公众号验证码页、登录页、付费墙和风控页不能读取或绕过；向用户说明如何提供可公开读取的原文链接或手工摘要。
- Tavily 只在用户点击搜索时调用，候选结果必须经“加入热点池”确认后才成为情报。

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
- Web 前端已移除对模型目录、策略、外部连接、用量的 `window.contentEngine` 依赖；桌面端保留原 IPC 分支以兼容旧壳。
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
