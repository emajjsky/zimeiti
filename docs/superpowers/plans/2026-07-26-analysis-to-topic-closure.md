# AI 分析到选题闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让成功的热点分析可创建唯一的选题草稿，并在选题池中完整查看、编辑、立项与追溯分析来源。

**Architecture:** 复用现有本地工作空间状态和 `TopicCandidate`，将用户选择的分析角度、平台建议、评分、结论、核验项和来源关联冻结到选题草稿。规划页仅渲染真实选题数据，不再显示硬编码的受众、热点和备注。

**Tech Stack:** React、TypeScript、现有 `LocalState` 持久化、Node Test。

## Global Constraints

- 仅处理“分析结果 → 选题 → 确认立项”闭环，不进入内容生成。
- 选题标签和详情不得展示冗余说明；分析失败或未分析资讯不得伪造分析数据。
- 新行为必须先有失败测试，且不触发真实模型调用。

---

### Task 1: 冻结分析上下文到选题草稿

**Files:**
- Modify: `content-engine/src/domain/content.ts`
- Modify: `content-engine/src/main.tsx`
- Test: `content-engine/tests/web-navigation.test.mjs`

- [ ] **Step 1: Write the failing test**

断言从 `createTopicFromIntel` 创建选题时，选题记录包含选中角度、评分、决策、平台建议和核验项。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/web-navigation.test.mjs`

- [ ] **Step 3: Write minimal implementation**

扩展 `TopicCandidate` 的可选分析快照字段；`createTopicFromIntel` 将选中角度和分析数据写入该字段，同时保留原资讯 ID。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/web-navigation.test.mjs`

### Task 2: 规划页显示真实来源和分析信息

**Files:**
- Modify: `content-engine/src/main.tsx`
- Test: `content-engine/tests/web-navigation.test.mjs`

- [ ] **Step 1: Write the failing test**

断言 `Plan` 接收资讯数据，并渲染关联热点、待核验、分析结论和平台建议，而不是旧的硬编码文案。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/web-navigation.test.mjs`

- [ ] **Step 3: Write minimal implementation**

向 `Plan` 传入热点列表；根据 `sourceIds` 找到真实资讯并显示标题和来源，展示选题已冻结的分析信息和核验项。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/web-navigation.test.mjs`

### Task 3: 验证并记录

**Files:**
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

- [ ] **Step 1: Run full verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

- [ ] **Step 2: Record status**

记录自动化通过项，并明确真实点击“创建选题 → 确认立项”的浏览器验收仍由用户执行。
