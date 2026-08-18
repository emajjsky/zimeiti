# 通用多模态内容导入与创作改造方案

**状态：** 待评审，不包含业务代码修改  
**范围：** 新建创作、公开链接读取、作者草稿、多模态素材、项目资料、研究、正文生成  
**基线：** 2026-08-10 当前工作区；`npm test` 519/519 通过，`npm run build` 通过，主 JS 包约 599 KB

## 1. 结论

当前问题不是缺一个“公众号仿写”按钮，而是同一种输入被拆成了多条互不一致的链路：发现页导入链接、项目创建、项目资料、素材库、研究和正文 Agent 各自保存一部分信息，却没有统一的内容摄取过程。继续在任一页面增加上传框或链接框，会继续制造状态、错误处理和数据归属冲突。

本次改造采用一个统一原则：

> URL、粘贴文本和上传文件先进入同一个“内容摄取”服务，生成可追溯的规范化文档；用户确认用途后，再落入现有的项目输入、项目参考和工作空间素材。正文 Agent 只消费组装后的创作上下文，不直接抓网页、不直接解析附件，也不维护第二套资料模型。

产品入口统一为三种创作意图：

1. 从零创作
2. 参考内容创作
3. 继续已有内容

图片、PDF、音频和视频是三种意图都可附加的项目素材，不作为第四种创作类型。

## 2. 目标与非目标

### 2.1 目标

- 支持公众号、网页新闻、知乎、X、博客和其他公开 HTTP(S) 页面。
- 支持想法、大纲、零散片段、半成稿和完整草稿。
- 支持截图、图片、PDF、TXT/Markdown、音频和视频。
- 保留网页正文结构、来源信息和正文图片候选。
- 让用户明确选择参考维度，而不是默认整篇“仿写”。
- 让作者内容在正文阶段被直接、可靠地使用，不强制绕行研究。
- 使用阿里云百炼 CLI 的多模态能力完成 OCR、图像理解、文档理解、转写和关键帧理解。
- 让采集、解析、模型分析和入库的状态可见、可恢复、可审计。
- 复用现有素材库、项目资料、研究、Skill、账号声音和正文动作。

### 2.2 非目标

- 不绕过登录、验证码、付费墙、反爬或平台访问控制。
- 不承诺任意网站都能稳定抓取；不稳定来源必须提供粘贴正文或上传文件的明确替代路径。
- 不自动把网页全部图片当作可发布素材。
- 不自动确认第三方图片版权。
- 不把“参考内容创作”实现成特色语句复写或作者身份模仿。
- 不在本次改造中重写配图、排版、发布和复盘系统。
- 不新增另一套项目、草稿、素材或研究领域模型。

## 3. 当前代码事实

### 3.1 前端入口

- `CreativeProjectCenter.tsx` 只展示 `MANUAL / 个人创意`，但 `CreateProjectInput` 和 `ProjectOriginType` 已存在 `MANUAL / DRAFT / IMPORT`。
- 当前表单把“创意补充”和“已有草稿”压进一个文本框，不能表达内容成熟度和用户期望动作。
- `LinkImportPanel.tsx` 能读取链接，但只保存为 `IntelligenceItem` 并进入发现/热点链路，不能直接成为创作输入。
- `ProjectMaterials.tsx` 已支持作者内容、参考链接、上传文件和素材库选择，但只在规划确认后的准备阶段出现，时序晚于用户真实操作。
- `CreateWorkspace.tsx` 会在正文长度达到阈值时把项目路由到配图阶段；这把“已有正文”错误等同于“正文已完成”。
- `CopyWorkspace.tsx` 没有把 `selectedMaterials` 传给 `ProjectAgent`，正文阶段对项目资料的使用依赖研究间接传递。
- `main.tsx` 同时承担应用装配、导航、身份、设置和多个页面逻辑，构建后主包约 599 KB，后续入口扩展会继续放大耦合。

### 3.2 服务端读取与素材

- `public-web.cjs` 已有公开 URL 校验、SSRF 防护、跳转/超时/大小限制、静态正文提取和公众号识别。
- `browser-reader.cjs` 的页面读取主要为公众号设计，并阻断图片资源；尚不是通用动态网页读取器。
- 当前没有知乎、X 等来源适配器，没有统一的正文 block，也没有网页正文图片抽取。
- `assetStorage.cjs` 已完成格式签名检测、安全路径、哈希去重、远程图片下载和浏览器回退，应该继续作为唯一二进制素材入口。
- 音频、视频、图片和 PDF 当前能保存、预览，但大多只以 `METADATA_ONLY` 进入研究快照；“上传成功”不等于“模型已理解”。

### 3.3 研究与正文

- `projectResearchMaterialSnapshot()` 只直接读取文本类内容；链接是 `NOT_READ`，多数附件是 `METADATA_ONLY`。
- 研究工作流偏向事实采集与核验，不适合强制处理作者自己的大纲、草稿或纯风格参考。
- 正文生成、重构、润色、扩写和压缩已经统一为百炼 CLI 的正文调用，正文输出为纯文本；这条边界必须保留。
- Skill、账号声音、WritingBrief 和研究事实是写作约束；它们不负责下载网页或解析二进制文件。

### 3.4 数据模型

系统已有 `ContentProject`、`ProjectInput`、`ProjectReference`、`WorkspaceAsset`、`project_asset_links`、`project_research_materials`、`ContentDraft`、不可变草稿版本、`IntelligenceItem` 和通用 `jobs`。问题是缺少“原始来源到规范化资料”的摄取记录，不是缺少更多终态内容表。

## 4. 根因

1. **入口按页面能力划分，而非用户意图划分。** 用户想“拿这些东西开始写”，产品却要求先判断它属于热点、项目资料、研究还是素材。
2. **没有规范化文档。** 网页、文本、图片、PDF、音视频各自以不同快照存在，正文和研究无法稳定消费。
3. **摄取与创作耦合错误。** 正文 Agent 需要时才发现链接没读、附件没分析，导致超时、空上下文和状态不一致。
4. **作者内容与外部参考没有语义隔离。** 作者草稿应该能直接成为当前正文；外部参考只能按用途进入上下文。
5. **任务状态过粗。** 一个“生成中”无法表达正在下载、解析、OCR、转写、部分完成或需要用户处理。
6. **旧入口重复保存。** 发现页、项目快照和项目资料可能保存同一来源的不同版本，后续无法判断哪个是事实源。

## 5. 统一产品概念

### 5.1 创作意图

| 意图 | 用户提供 | 主要结果 |
| --- | --- | --- |
| 从零创作 | 标题/题材、观点、受众、可选素材 | 新项目 + WritingBrief |
| 参考内容创作 | 一个或多个 URL、粘贴正文、可选素材 | 规范化参考 + 参考用途 + 新项目 |
| 继续已有内容 | 大纲、片段、半成稿或完整草稿、可选素材 | 新项目 + 作者输入/当前正文 |

### 5.2 作者内容成熟度

- `IDEA`：一句想法或题材。
- `OUTLINE`：章节或要点结构。
- `FRAGMENTS`：未整理片段。
- `PARTIAL_DRAFT`：有连续正文但未完成。
- `FULL_DRAFT`：可直接编辑的完整正文。

### 5.3 参考用途

- `TOPIC`：题材与问题域。
- `ANGLE`：切入角度。
- `STRUCTURE`：结构规则。
- `STYLE`：表达规则，只提炼规则，不复制特色句。
- `FACT_LEADS`：事实线索，进入核验链路后才能作为确定事实。
- `VISUAL`：画面或图片参考。
- `COMPREHENSIVE`：组合用途，仍按上述维度分别保存。

“仿写”只作为用户自然语言，不作为领域枚举和按钮名称。

## 6. 页面信息架构

### 6.1 新建创作面板

从项目列表内的小表单改为独立宽面板；桌面端最大宽度约 1120px，移动端全屏。页面不使用嵌套卡片，主体分为稳定的三段：

1. 顶部三段式意图切换：从零创作 / 参考内容创作 / 继续已有内容。
2. 中间输入和预览区：左侧输入，右侧处理结果；小屏改为上下排列。
3. 底部固定动作栏：取消 / 保存为项目资料 / 创建并进入创作。

#### 从零创作

- 标题或题材：必填。
- 我想表达什么：可选。
- 面向谁：可选，默认继承工作空间。
- 附加素材：统一上传/素材库选择控件。

#### 参考内容创作

- URL 可逐条添加；也允许直接粘贴正文。
- 每条来源显示独立状态、标题、作者、发布时间、正文长度和来源域名。
- 解析成功后显示结构化正文预览，不展示原始 HTML。
- 正文图片以瀑布流候选展示，只显示图片、尺寸、图注和来源标记；用户勾选后才入素材库。
- 用途使用多选控件；事实线索与风格/结构在视觉上分组。
- 用户补充“新主题/我的观点/目标受众”，避免把参考文章当作写作指令。

#### 继续已有内容

- 先选择成熟度，再输入文本或上传文件。
- `OUTLINE`：主操作“按大纲生成”。
- `FRAGMENTS`：主操作“整理并继续写”。
- `PARTIAL_DRAFT`：主操作“补全正文”。
- `FULL_DRAFT`：主操作“进入正文编辑”。
- 润色、扩写、压缩只在已有正文进入编辑器后出现；重构表示围绕主题重新生成，不把原文作为逐句修改对象。

### 6.2 摄取结果状态

每条来源显示：

- 当前阶段和耗时。
- 已取得的文本、图片和媒体数量。
- 部分失败的具体对象。
- 可执行动作：重试失败阶段、改为粘贴正文、删除来源。

页面离开后任务继续；返回时通过任务 ID 恢复，不以 React 本地状态作为事实源。

### 6.3 项目内资料页

新建面板和现有 `ProjectMaterials` 使用同一组件与 API。创建项目后，材料仍可补充、移除、重新解析和修改用途。项目内不再出现第二套“导入内容”表单。

### 6.4 发现页

发现页保留“导入链接到热点池”的业务意图，但底层改用相同摄取服务。成功后将规范化结果投影为 `IntelligenceItem`；不复制网页解析代码。

## 7. 规范化文档

所有来源统一输出 `NormalizedDocument`：

```ts
type NormalizedDocument = {
  schemaVersion: 1;
  title: string;
  author?: string;
  publishedAt?: string;
  canonicalUrl?: string;
  language?: string;
  blocks: NormalizedBlock[];
  plainText: string;
  mediaCandidateIds: string[];
  extraction: {
    adapter: string;
    adapterVersion: string;
    fetchedAt: string;
    contentHash: string;
    completeness: 'FULL' | 'PARTIAL';
    warnings: string[];
  };
};
```

`NormalizedBlock` 只允许：`heading`、`paragraph`、`quote`、`list`、`image`、`embed`、`threadItem`、`transcriptSegment`。每个 block 带稳定 ID 和来源位置，模型派生产物不能覆盖原始 block。

## 8. 数据设计

### 8.1 新增最小表

只新增两个领域表，复用现有 `jobs`：

#### `content_ingestions`

- `id`, `workspace_id`, `project_id`（可空）
- `job_id`：关联现有任务状态
- `input_kind`: `URL | TEXT | ASSET`
- `source_type`: `GENERIC_WEB | WECHAT | ZHIHU | X | UPLOAD`
- `source_url`, `canonical_url`, `source_asset_id`
- `intent`: `REFERENCE | AUTHOR_CONTENT | DISCOVERY | VOICE_SAMPLE`
- `usage_json`
- `raw_snapshot_ref`：私有对象存储引用，不放大 JSONB
- `normalized_document_json`
- `content_hash`, `adapter`, `adapter_version`
- `completeness`, `warnings_json`, `error_code`
- `created_by`, `created_at`, `updated_at`

唯一性只用于同空间内复用不可变抓取结果：`workspace_id + canonical_url + content_hash`。同 URL 内容变化时允许新记录。

#### `content_ingestion_media`

- `id`, `workspace_id`, `ingestion_id`
- `block_id`, `source_url`, `resolved_url`
- `alt_text`, `caption`, `width`, `height`, `position`
- `classification`: `CONTENT | AVATAR | LOGO | AD | QR | DECORATION | UNKNOWN`
- `content_hash`, `copyright_status`
- `selected`, `asset_id`（选择入库后关联现有素材）

### 8.2 不新增的内容

- 不新增导入项目表：继续使用 `content_projects`。
- 不新增导入素材表：选择后进入 `workspace_assets`。
- 不新增导入参考表：应用后进入 `project_references`。
- 不新增作者草稿表：作者输入进入 `project_inputs`，半成稿/完整草稿按规则进入当前 `ContentDraft`。
- 不新增任务表：执行状态继续使用 `jobs`，BullMQ 只负责投递。

### 8.3 数据落地规则

- 作者 `IDEA/OUTLINE/FRAGMENTS` -> `ProjectInput`，保留成熟度和原文。
- 作者 `PARTIAL_DRAFT/FULL_DRAFT` -> `ProjectInput` + 当前公众号 `ContentDraft.body`；两者通过来源 ID 关联，避免双写失去出处。
- 外部参考 -> `ProjectReference`，保存 ingestion ID 和用途，不复制整份网页 JSON。
- 用户选中的网页图片 -> 通过 `assetStorage` 导入 `WorkspaceAsset`，再写 `project_asset_links`。
- 事实线索 -> 研究材料；未核验前不得进入 `verifiedClaims`。
- 结构/风格 -> 提炼为规则快照，原文只供受控分析，不拼进最终正文 prompt。

## 9. API 设计

所有接口使用现有身份、工作空间头和角色守卫。

### 9.1 启动摄取

`POST /api/v1/content-ingestions`

```json
{
  "projectId": null,
  "input": { "kind": "URL", "url": "https://example.com/article" },
  "intent": "REFERENCE",
  "usage": ["STRUCTURE", "FACT_LEADS"]
}
```

文本使用 `{ kind: "TEXT", text, maturity }`；文件先走现有素材上传 API，再使用 `{ kind: "ASSET", assetId }`。响应为 `202`，返回 ingestion 和 job，不同步等待网页/模型处理完成。

### 9.2 查询与取消

- `GET /api/v1/content-ingestions/:id`
- `POST /api/v1/content-ingestions/:id/cancel`
- `POST /api/v1/content-ingestions/:id/retry`，必须指定失败阶段，不重跑已成功阶段。
- `DELETE /api/v1/content-ingestions/:id`，仅删除未应用的摄取记录和私有快照；已进入项目/素材的对象不级联删除。

### 9.3 选择图片与应用

- `PATCH /api/v1/content-ingestions/:id/media-selection`
- `POST /api/v1/content-ingestions/:id/apply`

`apply` 在一个数据库事务中完成：创建或绑定项目、写作者输入/参考、导入选中图片、建立项目链接并返回下一阶段。远程图片下载可在事务前完成临时对象准备，数据库提交失败时清理未引用文件。

### 9.4 客户端契约

在 `webApi.ts` 新增唯一 `webIngestions` 客户端，页面组件不得自行调用 `fetch`。错误统一返回 `{ code, message, stage, retryable, action }`，禁止前端解析错误字符串猜状态。

## 10. 网页读取适配器

采用管线而不是大型条件分支：

```text
URL 校验 -> 直接 HTTP -> 来源适配器解析 -> 通用正文解析
                              | 失败/不完整
                              v
                      受控浏览器读取
```

### 10.1 适配器接口

```ts
interface SourceAdapter {
  canHandle(url: URL): boolean;
  fetch(context): Promise<RawPage>;
  parse(page: RawPage): Promise<NormalizedDocument>;
}
```

首批适配器：`WechatAdapter`、`ZhihuAdapter`、`XAdapter`、`GenericArticleAdapter`。适配器只负责读取和确定性解析；模型补全元数据不得替代原文。

### 10.2 读取策略

- 静态公开页：沿用 `public-web` 的 SSRF、跳转、大小和超时边界。
- 动态公开页：使用浏览器上下文读取渲染后的正文和正文图片；继续阻断下载、弹窗和非必要资源，但不能像当前公众号读取那样一律阻断图片元数据。
- 登录/验证码/付费墙：状态 `NEEDS_USER_INPUT`，提供“打开原文”“粘贴正文”“上传导出文件”。
- X/知乎：优先稳定公开结构或官方接口；页面结构变化时明确 `ADAPTER_OUTDATED`，不静默返回空正文。
- canonical URL、重定向链、抓取时间、响应类型和内容哈希全部记录。

## 11. 图片抽取与入库

1. 只从正文容器和结构化媒体节点提取候选。
2. 过滤头像、站点 Logo、广告、二维码、透明占位和装饰图；过滤结果保留分类理由，便于修正规则。
3. 去重顺序：规范 URL -> 内容哈希 -> 感知哈希（后续可选）。
4. 候选阶段只保存元数据和受控缩略图，不直接进入素材库。
5. 用户勾选后调用现有远程素材导入，继续使用签名检测、大小限制、SSRF 和哈希复用。
6. 素材保存来源页、原图 URL、图注、作者/来源和版权状态。
7. 权利不明的第三方图片默认 `PENDING`，只可作为内部视觉参考；发布预检继续阻止 `PROHIBITED`。

## 12. 多模态处理

### 12.1 能力路由

| 输入 | 确定性预处理 | 百炼任务 | 输出 |
| --- | --- | --- | --- |
| 图片/截图 | EXIF、尺寸、哈希 | OCR + 画面理解 | 文本、对象、图表/场景摘要 |
| PDF | 页数、文本层提取 | 扫描页 OCR + 页面理解 | 分页 blocks、图片候选 |
| 音频 | 时长、格式 | ASR | 带时间戳 transcript |
| 视频 | 时长、容器、关键帧 | ASR + 关键帧多模态理解 | transcript + scene blocks |
| 网页图片 | URL/尺寸/位置 | 按需视觉理解 | 图注和分类补充 |

### 12.2 百炼 CLI 调用边界

- 所有调用通过现有 runner/模型策略层，不在路由和 React 组件中直接执行 CLI。
- 新增显式任务 Scope：`CONTENT_OCR`、`DOCUMENT_UNDERSTANDING`、`MEDIA_TRANSCRIPTION`、`VIDEO_UNDERSTANDING`、`REFERENCE_ANALYSIS`。
- 每次运行冻结 provider、model、promptVersion、skillVersion、输入资产哈希和输出结构版本。
- 提取任务使用结构化 JSON；正文生成和正文修改继续使用纯文本输出协议。
- 单次任务只完成一个明确职责，不让同一次调用同时“解析来源、判断事实、写正文”。
- 模型结构错误进入 `FAILED`，保存原始调用审计但不写入规范化文档；不使用隐藏的多轮修补。

### 12.3 Skill 的正确位置

- 来源解析 Skill：定义不同来源的结构识别规则。
- 参考分析 Skill：把结构、角度、风格提炼为可执行规则。
- 账号声音 Skill：提供作者自己的写作规则。
- 内容写作 Skill：决定如何写正文。
- Skill 不承担网络下载、文件存储、权限校验和任务状态。
- Skill 输出必须版本化；项目冻结所用版本，避免后续更新导致历史项目不可复现。

## 13. 任务状态机

复用 `jobs`，扩展摄取任务的 `result_json.stage` 和稳定错误码：

```text
PENDING
  -> FETCHING
  -> PARSING
  -> DOWNLOADING_MEDIA
  -> ANALYZING
  -> READY
```

任一阶段可进入：

- `PARTIAL`：主要文本可用，但部分媒体或元数据失败。
- `NEEDS_USER_INPUT`：登录、验证码、正文不可见或文件密码。
- `FAILED`：主要结果不可用。
- `CANCELLED`：用户取消，Worker 必须在落库前再次检查状态。

数据库任务状态仍保持 `PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED`；细阶段属于受版本约束的摄取结果，避免修改所有现有任务。`READY/PARTIAL` 对应任务 `SUCCEEDED`，差异由 ingestion completeness 表达。

Worker 必须做到：

- 阶段结果幂等，以 ingestion ID + stage + 输入哈希作为键。
- 进程重启后可从最后成功阶段继续。
- 取消后迟到结果不得覆盖状态。
- 重试只由稳定错误码和用户动作决定，不对模型无效输出自动重试。
- API 请求不等待长任务，避免反向代理 502/504 与页面无限生成状态。

## 14. 正文上下文装配

新增唯一 `buildCreationContext(projectId)`，替代页面和各服务自行拼上下文：

```ts
type CreationContext = {
  authorInputs: Array<{ maturity: string; text: string }>;
  referenceRules: {
    topics: string[];
    angles: string[];
    structures: string[];
    styleRules: string[];
  };
  verifiedClaims: Claim[];
  unresolvedClaims: Claim[];
  selectedAssets: AssetSummary[];
  writingBrief: WritingBriefSnapshot;
  voice: AccountVoiceSnapshot | null;
  skillVersions: string[];
};
```

装配规则：

- 作者内容优先级高于外部参考。
- 大纲作为结构约束，不伪装成已写正文。
- 半成稿/完整草稿成为编辑器当前正文。
- 重构围绕主题、观点、受众和已确认资料重新生成；原正文仅用于提取用户明确保留的事实/要求，不进入逐句修改 prompt。
- 润色、扩写、压缩以当前正文或选区为输入。
- 结构/风格参考只以提炼规则进入 prompt。
- 外部事实只有 `VERIFIED/SINGLE_SOURCE` 可作为事实；其他项进入待核验提示。
- 没有事实型需求时，作者大纲和草稿不应被研究门禁阻断。

## 15. 阶段路由

| 输入结果 | 创建后的阶段 |
| --- | --- |
| 只有题材/想法 | 规划 |
| 已有大纲 | 正文，大纲作为已确认或待确认结构 |
| 零散片段 | 正文编辑器，先整理候选 |
| 半成稿 | 正文编辑器，当前正文为半成稿 |
| 完整草稿 | 正文编辑器，不自动跳配图 |
| 参考文章 + 事实线索 | 资料准备/研究，完成后正文 |
| 参考文章 + 结构/风格 | 正文，规则已冻结 |
| 只有附件且用途不明 | 项目资料，要求用户选择用途 |

删除当前“正文长度 >= 80 自动进入配图”的推断。阶段只能由用户意图、内容成熟度和显式完成状态决定。

## 16. 错误、安全与隐私

### 16.1 稳定错误码

- `URL_NOT_PUBLIC`
- `FETCH_TIMEOUT`
- `FETCH_TOO_LARGE`
- `ROBOT_BLOCKED`
- `LOGIN_REQUIRED`
- `HUMAN_VERIFICATION_REQUIRED`
- `UNSUPPORTED_MEDIA`
- `FILE_ENCRYPTED`
- `ADAPTER_OUTDATED`
- `MODEL_POLICY_MISSING`
- `MODEL_OUTPUT_INVALID`
- `ASSET_IMPORT_FAILED`
- `INGESTION_CANCELLED`

每个错误码在服务端定义用户动作，不在前端维护重复映射。

### 16.2 安全边界

- 沿用 DNS/IP 双重 SSRF 校验，重定向每跳重新校验。
- 浏览器读取使用独立上下文、禁用下载、限制总流量和执行时间。
- HTML 永不在前端以不受控方式执行；预览只渲染规范化 blocks。
- 上传文件继续进行魔数检测，不信任扩展名和声明 MIME。
- 原始快照、转写和 OCR 结果按工作空间隔离。
- 日志不记录 API Key、完整正文和二进制内容。
- 删除摄取记录时只清理无引用私有对象；素材和项目引用使用现有删除边界。

## 17. 需要合并或删除的旧逻辑

实施完成后删除或收敛：

- 删除 `CreativeProjectCenter` 中只支持 `MANUAL` 的局部来源数组，改用统一创作意图组件。
- 删除 `createBlankProject()` 把 `draftText` 同时塞入 `planning.coreMessage` 和 `sourceSnapshot` 的双写。
- 删除正文长度推断阶段的逻辑。
- `LinkImportPanel` 不再直接解析网页，只调用摄取服务并投影为热点。
- `projectResearchMaterialSnapshot()` 不再自行读取 TXT/Markdown；它读取已完成的规范化结果。
- `CopyWorkspace` 不再遗漏项目资料；统一调用 `buildCreationContext()`。
- 公众号浏览器读取器中的通用网络逻辑下沉到共享 fetch 层，公众号只保留适配规则。
- 不再让 `sourceSnapshot` 作为新功能事实源；保留历史兼容读取，迁移后只写规范化引用。
- 将 `main.tsx` 中页面装配、认证和设置页面拆为路由级模块，并对首页、设置、发布、复盘、素材和创作工作区懒加载。

删除前必须先建立模块导入清单；当前已删除但仍在工作区变更中的历史领域文件不可被本方案误恢复。

## 18. 迁移策略

### Phase A：只增不切换

- 新增迁移、摄取服务、适配器、Worker 和 API。
- 新入口 behind workspace feature flag。
- 旧项目保持原样读取。

### Phase B：双读单写

- 新创建只写 ingestion 引用和现有正式领域表。
- 历史项目若只有 `sourceSnapshot`，读取时转换为内存中的兼容规范化文档，不立刻改库。
- 发现页和账号声音改用统一服务。

### Phase C：回填与校验

- 为历史项目回填 ingestion 记录，只引用现有文本/URL/素材，不重新联网和调用模型。
- 校验项目数、输入数、参考数、素材引用数、正文哈希和工作空间边界。
- 回填可重复执行，使用 migration source key 保证幂等。

### Phase D：删除兼容写入

- 停止写 `sourceSnapshot.draftText` 等历史字段。
- 删除无调用旧解析函数、重复 DTO 和只验证源码字符串的过期测试。
- 保留只读兼容一个发布周期，再单独迁移删除字段。

## 19. 测试策略

当前 519 项测试和生产构建均通过，这只是现状基线，不代表新链路已覆盖。实施时按行为增加测试，并同步清理重复/脆弱测试。

### 19.1 单元测试

- 规范化 block、内容哈希、canonical URL、来源适配器选择。
- HTML 正文与图片候选解析。
- 媒体分类、去重、版权默认值。
- 作者成熟度到项目输入/正文/阶段的映射。
- 参考用途到 CreationContext 的映射。
- 重构与润色输入边界。
- 任务状态转换、取消和迟到结果。

### 19.2 集成测试

- 静态网页、动态网页、公众号、知乎、X 的固定夹具。
- 登录/验证码/超时/重定向/大响应/私网 URL。
- 上传 PDF、扫描 PDF、图片、音频、视频后的结构化结果。
- apply 事务失败时不残留项目关系或孤立文件。
- 工作空间隔离和角色权限。
- Worker 重启、重复消息和阶段重试幂等。
- 现有研究、正文、素材库、账号声音消费同一个 ingestion。

网络测试使用录制/固定夹具，不把第三方实时页面作为 CI 成败条件。

### 19.3 E2E

- 粘贴链接 -> 看到正文/图片 -> 选择用途 -> 创建项目 -> 进入正确阶段。
- 粘贴大纲 -> 创建 -> 直接进入正文 -> 按大纲生成。
- 上传完整草稿 -> 创建 -> 正文可编辑且不跳配图。
- 上传截图/PDF/音频/视频 -> 状态可见 -> 结果可预览。
- 部分失败、取消、刷新页面恢复、删除来源。
- 桌面 1440/1024 和移动 390，无横向溢出和按钮遮挡。

### 19.4 现有测试清理标准

- 保留安全、数据边界、工作空间隔离、状态机和用户行为测试。
- 将读取源文件并断言某段字符串存在的测试替换为导出函数、API 或浏览器行为测试。
- 同一行为只保留一层主契约和必要的边界测试，不在多个文件复制相同断言。
- 已删除模块的测试一并删除，不为通过测试保留无生产调用代码。
- 不删除迁移幂等、素材签名、SSRF、任务取消和 revision 并发测试。

## 20. 实施顺序

1. 定义术语、DTO、错误码、规范化文档和状态机；先写领域测试。
2. 建立数据库迁移和 Store；验证工作空间隔离、幂等和删除边界。
3. 抽取公共网络读取层，实现 Generic + Wechat 适配器和图片候选。
4. 接入素材上传、文本/PDF/图片解析，再接音频和视频，避免一次扩大所有风险面。
5. 建立 BullMQ 摄取 Worker 和阶段恢复。
6. 实现 `webIngestions` 和新建创作面板。
7. 实现 apply 事务、阶段路由和项目内资料复用。
8. 实现 `buildCreationContext()`，接通研究与正文。
9. 将发现页、账号声音迁移到统一摄取服务。
10. 回填历史数据，停止旧字段写入，删除重复逻辑和过期测试。
11. 拆分 `main.tsx` 和路由懒加载，完成视觉与性能回归。

每一步都必须通过定向测试、全量 `npm test`、`npm run typecheck`、`npm run build` 和相应 Playwright 流程后再进入下一步。

## 21. 验收标准

- 用户无需理解“热点/研究/资料/素材”的内部边界，即可用 URL、文本或文件开始创作。
- 同一来源只有一个摄取事实记录，发现、项目和账号声音通过引用复用。
- 公开静态页面可以提取标题、作者、时间、正文结构和正文图片候选。
- 动态或受限页面失败时给出明确原因和替代动作，不返回空成功。
- 选中的网页图片进入现有素材库，未选择图片不污染素材库。
- 图片、PDF、音频和视频的“已上传”与“已理解”状态明确区分。
- 作者大纲、半成稿和完整草稿在正文阶段可直接使用；完整草稿不自动跳配图。
- 参考结构/风格只以规则进入正文，事实线索必须经过核验。
- 重构是重新生成，润色/扩写/压缩才以当前正文或选区为直接输入。
- API 请求不等待长模型任务；刷新页面后状态一致，无无限生成和调用记录已失败但页面仍运行的分裂。
- 所有新 API 有稳定错误码、工作空间权限、取消、幂等和清理测试。
- 无重复网页解析器、重复素材表、重复任务表和只为测试存在的生产代码。
- 全量测试、类型检查、构建和核心 E2E 通过；主包通过路由拆分明显下降且无新的构建体积告警。

## 22. 开工前决策

方案可按以下默认决策直接实施：

- 第一版支持通用网页、公众号、知乎和 X；受限页面不绕过验证。
- 网页图片默认只做候选，用户选择后入库。
- 第三方图片默认版权待确认。
- 完整草稿进入公众号母稿编辑器；其他平台仍从母稿显式派生。
- 音视频采用异步转写和关键帧理解，不阻塞项目壳创建。
- 历史数据只做离线回填，不重新抓网页、不消耗模型额度。

这些决策若不变，下一步应先实施“领域契约 + 数据迁移 + 通用摄取 API”，而不是先画新页面或增加临时入口。
