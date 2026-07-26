# 内容引擎技术实施方案

> 版本：Web-only v1.0
> 更新：2026-07-24
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
| Web 前端 | 登录、工作空间、编辑部页面和 API 客户端 | 已建立 |
| Fastify API | 认证、工作空间、凭据、情报与任务 API | 已建立 |
| PostgreSQL | 用户、工作空间、凭据、情报、任务和审计主数据 | 已建立初始迁移 |
| Redis/BullMQ | 延迟任务、异步任务、重试与 Worker 通信 | 已建立骨架 |
| 百炼 CLI Runner | 每个任务临时注入 Key 并执行 CLI | 已建立骨架 |
| Agent 动作与 Skill 组合 | 受限动作计划、五维创作规则、确认前运行记录 | 热点分析动作已建立，创作组合待实施 |
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
