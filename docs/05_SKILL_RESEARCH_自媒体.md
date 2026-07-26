# 自媒体创作 Skill 调研

> 调研日期：2026-07-26  
> 目标：为内容引擎建立可复用、可版本化、可组合的创作规范，不把执行动作误当成 Skill。

## 1. 采用原则

1. Skill 只回答“应该怎样创作”，不负责调用模型、浏览器、数据库或发布接口。
2. 项目级 Skill 固定按题材、内容类型、语言风格、排版和渠道五个维度组合。
3. 生成大纲、初稿、改写、配图、排版和审核属于 Agent 动作，由模型 Scope 和工具权限控制。
4. 事实核验、版权、平台合规和用户确认是系统规则，任何 Skill 不能覆盖。
5. 只直接采用许可证允许且依赖边界清楚的实现；无许可证项目只研究交互和流程，不复制代码或提示词。

## 2. 可借鉴项目

| 项目 | 许可证 | 适用部分 | 结论 |
| --- | --- | --- | --- |
| [social-media-skills/skills](https://github.com/social-media-skills/skills) | MIT | 品牌档案、写作风格、科普、故事、跨平台改编、轮播图、图片提示词、来源研究、平台校验 | P0 主要参考。借鉴“品牌上下文先行、内容类型与格式分层、发布前独立校验”的契约。 |
| [hyperfx-ai/marketing-skills](https://github.com/hyperfx-ai/marketing-skills) | MIT | `brand-context`、`blog-generation`、历史内容日志 | 借鉴持久品牌档案与读取/追加内容历史的 memory contract，不引入 Hyper MCP 依赖。 |
| [bradautomates/head-of-content](https://github.com/bradautomates/head-of-content) | MIT | 竞品内容研究、异常高表现内容分析、跨平台策划 | 放入 P1 研究清单。它依赖 Apify、TubeLab 和 Gemini，不作为 P0 运行依赖。 |
| [hongfamonvAI/hook-lab](https://github.com/hongfamonvAI/hook-lab) | MIT | 视频 Hook、脚本结构、风格标签、爆款原因 | 仅用于后续独立视频工坊，不进入当前图文主链路。 |

## 3. 仅研究，不复制

| 项目 | 原因 | 可研究内容 |
| --- | --- | --- |
| [op7418/guizang-social-card-skill](https://github.com/op7418/guizang-social-card-skill) | AGPL-3.0。Web 服务直接使用衍生代码会产生对应开源义务。 | 公众号封面、小红书图文卡尺寸、分页和版式校验。 |
| [vivy-yi/xiaohongshu-skills](https://github.com/vivy-yi/xiaohongshu-skills) | 仓库未提供许可证，默认不得复制或分发。 | 小红书创作步骤和用户操作习惯。 |

## 4. P0 落地映射

| 外部模式 | 内容引擎对象 |
| --- | --- |
| Brand profile / brand context | 工作空间级 `creator_profiles`，后续在设置中编辑 |
| Writing style / educational / story | `creative_skill_definitions` 的语言风格与内容类型 |
| Design templates / carousel writer | 排版 Skill，后续驱动配图和排版动作 |
| Cross-platform repurposing | Agent 动作读取渠道 Skill 后生成候选平台版本 |
| Platform validation | 独立审核动作，不混入写作 Skill |
| Content research and sourcing | 发现与规划数据，不由创作 Skill 自行浏览网络 |

## 5. 首批内置预设

- 题材：通用、AI 科技、财经、历史人文、国学。
- 内容类型：科普、深度解读、评论、教程、盘点、故事化。
- 语言风格：通俗清新、专业克制、犀利评论、故事化表达。
- 排版：公众号长文、小红书分页图文。
- 渠道：公众号、小红书。

内置预设保留版本号。P0 下一阶段允许用户复制内置预设形成工作空间自定义版本，不直接修改系统预设。
