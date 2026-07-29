# 账号声音与个人 IP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户一次创建可编辑、可继承的账号声音，并以它替代泛化“语言风格”，使图文候选稿经过可解释的去 AI 腔和声音一致性检查。

**Architecture:** 新增独立的账号声音数据域和服务，不将个人 IP 塞入 Skill 表。写作简报只保存声音档案 ID 与单篇偏移；写作上下文从服务端加载已冻结的声音快照，并在生成和候选审稿中使用。设置页负责创建和维护声音，创作页只负责展示当前声音和选择本篇偏移。

**Tech Stack:** PostgreSQL migration、Fastify、Zod、Node test runner、React + TypeScript、Vite、现有百炼 CLI Worker。

## Global Constraints

- 纯 Web；不得恢复 Electron 或桌面客户端代码。
- 不实现配图、排版、视频、发布或第三方作者模仿功能。
- 账号声音材料只能是用户自有或已获授权的表达参考；不得成为事实来源，也不得把原文直接拼入写作上下文。
- 不在创作页显示原始提示词、冗长说明或大段风格表单。
- 生成结果只能进入候选稿；事实质量门、候选/正式稿隔离和自动保存不得回退。
- 不静默从用户编辑中学习；只有用户点击“保存为我的偏好”并确认后才能创建声音新版本。
- UI 保持现有波普怀旧清新系统，`DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 5`；不为此 Dashboard 工作流引入无意义动效。

---

## 文件结构与责任边界

| 文件 | 责任 |
| --- | --- |
| `server/migrations/022_account_voice_profiles.sql` | 声音档案、声音规则版本、校准材料元数据、显式偏好、默认绑定，以及 WritingBrief 的声音字段。 |
| `server/services/accountVoices.cjs` | 表达原型、档案 CRUD、确定性草案生成、版本化、默认解析和写作快照读取。 |
| `server/services/writing-brief.cjs` | 校验 `accountVoiceProfileId` 与 `voiceOffset`。 |
| `server/services/creativeSkills.cjs` | 从写作规则中移除用户选择的 `VOICE`，加载账号声音快照。 |
| `server/services/creative-draft.cjs` | 把声音快照及偏移传给初稿提示词，删除通用 AI 科普模板导向。 |
| `server/services/project-copy-action.cjs` | 对所有文案候选统一运行可解释的 AI 套话检查与声音审稿输入构建。 |
| `server/index.cjs` | 注册账号声音 API，并将声音上下文传入现有文案动作。 |
| `src/domain/creative.ts` | 账号声音、原型、偏移和 WritingBrief 的前端类型。 |
| `src/data/webApi.ts` | 账号声音 API 客户端。 |
| `src/app/navigation.mjs`、`src/main.tsx`、`src/workspaces/SettingsWorkspace.tsx` | 增加设置入口并挂载设置面板。 |
| `src/workspaces/settings/AccountVoiceSettings.tsx` | 列表、三步创建、编辑、设为默认、停用、删除和代表作元数据录入。 |
| `src/workspaces/create/CreateWorkspace.tsx`、`src/workspaces/create/CopyWorkspace.tsx` | 继承默认声音、替换“语言风格”下拉项、保存本篇偏移和生成前阻断。 |
| `src/styles.css` | 仅为账号声音卡片、向导、创作页状态和移动端适配补充样式。 |
| `tests/account-voices.test.mjs` | 数据域、权限、默认解析、版本化、提示词和 AI 套话检查的单元测试。 |
| `tests/creative-skills.test.mjs`、`tests/writing-brief-input.test.mjs`、`tests/project-copy-action.test.mjs`、`tests/creative-workspace.e2e.py` | 回归测试与真实交互链路。 |

## Task 1: 建立账号声音数据域与可测试服务

**Files:**
- Create: `content-engine/server/migrations/022_account_voice_profiles.sql`
- Create: `content-engine/server/services/accountVoices.cjs`
- Create: `content-engine/tests/account-voices.test.mjs`
- Modify: `content-engine/server/migrate.cjs`

**Interfaces:**
- Consumes: `{ query, transaction }`（与 `createCreativeSkillStore` 相同的数据库依赖）。
- Produces: `VOICE_ARCHETYPES`、`VOICE_OFFSETS`、`createAccountVoiceStore()`；其中 `getWritingSnapshot(workspaceId, profileId, offset)` 返回 `{ id, version, name, rules, offset } | null`。

- [ ] **Step 1: 写出会失败的原型与版本化服务测试**

```js
import { createAccountVoiceStore, VOICE_ARCHETYPES } from '../server/services/accountVoices.cjs';

test('账号声音原型不是泛化风格标签，且包含正反规则', () => {
  assert.equal(VOICE_ARCHETYPES.length, 6);
  assert.deepEqual(VOICE_ARCHETYPES.map((item) => item.slug), [
    'say-it-through', 'field-notes', 'calm-commentary',
    'talk-to-a-friend', 'slow-narrative', 'hardcore-breakdown',
  ]);
  assert.ok(VOICE_ARCHETYPES.every((item) => item.doRules.length > 0 && item.avoidRules.length > 0));
  assert.ok(VOICE_ARCHETYPES.every((item) => !/清新|故事化|高级感/.test(item.name)));
});

test('更新声音规则会创建新版本，历史快照不变', async () => {
  const store = createAccountVoiceStore(fakeDatabase);
  const created = await store.create('workspace-a', validProfile);
  const updated = await store.update('workspace-a', created.id, { ...validProfile, name: '把话说透·新版' });
  assert.equal(updated.version, 2);
  assert.equal((await store.getWritingSnapshot('workspace-a', created.id, 'DEFAULT')).version, 2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern="账号声音原型|更新声音规则"`  
Expected: FAIL，因为模块 `accountVoices.cjs` 尚不存在。

- [ ] **Step 3: 编写迁移与最小服务实现**

迁移创建下列真实边界：

```sql
CREATE TABLE account_voice_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  archetype_slug text NOT NULL,
  identity_text text NOT NULL CHECK (char_length(identity_text) BETWEEN 1 AND 600),
  audience_text text NOT NULL CHECK (char_length(audience_text) BETWEEN 1 AND 600),
  reader_takeaway_text text NOT NULL CHECK (char_length(reader_takeaway_text) BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  current_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_voice_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES account_voice_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL, rules_json jsonb NOT NULL CHECK (jsonb_typeof(rules_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(profile_id, version)
);
CREATE TABLE account_voice_defaults (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES account_voice_profiles(id) ON DELETE RESTRICT, updated_at timestamptz NOT NULL DEFAULT now()
);
```

同一迁移还要创建 `account_voice_calibrations`（只保存标题、来源 URL/文件 ID、授权确认、提炼后的规则摘要）和 `account_voice_preferences`（仅保存用户确认的偏好文本）；`writing_briefs` 增加可空的 `account_voice_profile_id` 和非空默认值 `voice_offset text NOT NULL DEFAULT 'DEFAULT'`。不写入、也不存储第三方正文。

`accountVoices.cjs` 以静态的六个原型为唯一模板来源。`buildInitialRules(input)` 通过原型规则加上用户的三句设定生成结构化规则：`opening`, `reasoning`, `rhythm`, `allowedPhrases`, `bannedPhrases`, `bannedStructures`, `ending`, `identityBoundary`。它是确定性函数，不消耗模型调用，也不伪造“学习过样稿”。

- [ ] **Step 4: 运行服务和迁移结构测试**

Run: `npm test -- --test-name-pattern="账号声音原型|更新声音规则"`  
Expected: PASS；另在测试中读取 `022_account_voice_profiles.sql`，断言存在四张表、`ON DELETE CASCADE/RESTRICT` 和 `voice_offset` 默认值。

- [ ] **Step 5: 提交数据域**

```bash
git add server/migrations/022_account_voice_profiles.sql server/services/accountVoices.cjs server/migrate.cjs tests/account-voices.test.mjs
git commit -m "feat: add versioned account voice profiles"
```

## Task 2: 暴露受保护的账号声音 API

**Files:**
- Modify: `content-engine/server/index.cjs:94,640-656`
- Modify: `content-engine/server/services/accountVoices.cjs`
- Modify: `content-engine/tests/account-voices.test.mjs`

**Interfaces:**
- Consumes: JWT 的当前工作空间和 `accountVoiceInput` Zod schema。
- Produces:
  - `GET /api/v1/account-voices`
  - `POST /api/v1/account-voices`
  - `GET /api/v1/account-voices/:id`
  - `PUT /api/v1/account-voices/:id`
  - `POST /api/v1/account-voices/:id/default`
  - `POST /api/v1/account-voices/:id/archive`
  - `DELETE /api/v1/account-voices/:id`
  - `POST /api/v1/account-voices/:id/calibrations`
  - `POST /api/v1/account-voices/:id/preferences`

- [ ] **Step 1: 写 API schema 和跨工作空间拒绝测试**

```js
test('账号声音 API 拒绝无效原型和跨工作空间档案', async () => {
  await assert.rejects(() => store.create('workspace-a', { ...validProfile, archetypeSlug: 'fresh-style' }), /表达原型/);
  await assert.rejects(() => store.update('workspace-b', 'profile-from-a', validProfile), /账号声音不存在/);
});

test('校准材料必须显式确认拥有表达使用权', () => {
  assert.throws(() => accountVoiceCalibrationInput.parse({ title: '参考稿', sourceType: 'LINK', sourceUrl: 'https://example.com', confirmedLicensed: false }), /使用权/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern="跨工作空间|校准材料"`  
Expected: FAIL，因为输入 schema、权限检查和路由尚未实现。

- [ ] **Step 3: 注册 API 与严格输入校验**

在 `accountVoices.cjs` 导出：

```js
const accountVoiceInput = z.object({
  name: z.string().trim().min(1).max(80),
  archetypeSlug: z.enum(['say-it-through','field-notes','calm-commentary','talk-to-a-friend','slow-narrative','hardcore-breakdown']),
  identityText: z.string().trim().min(1).max(600),
  audienceText: z.string().trim().min(1).max(600),
  readerTakeawayText: z.string().trim().min(1).max(600),
  editedRules: voiceRulesSchema.optional(),
});
const voiceOffset = z.enum(['DEFAULT','MORE_RESTRAINED','SHARPER','MORE_PERSONAL','MORE_NARRATIVE']);
```

每个路由均使用 `currentWorkspace(request.user.sub)`，把 workspace ID 传入 store。`archive` 只能归档非默认声音；`remove` 只允许未被默认绑定、未被任何 WritingBrief 使用的声音，否则返回明确受影响数量。校准接口只保存元数据和用户编辑过的摘要；禁止服务器抓取链接正文，防止暗中复制和事实污染。

- [ ] **Step 4: 运行 API 单元测试**

Run: `npm test -- --test-name-pattern="账号声音|跨工作空间|校准材料"`  
Expected: PASS，且每个失败用例都返回中文、可操作的错误，不泄露其他工作空间的存在。

- [ ] **Step 5: 提交 API**

```bash
git add server/index.cjs server/services/accountVoices.cjs tests/account-voices.test.mjs
git commit -m "feat: expose account voice management API"
```

## Task 3: 把 WritingBrief 从泛化语言风格迁移到账号声音

**Files:**
- Modify: `content-engine/server/services/writing-brief.cjs`
- Modify: `content-engine/server/services/creativeSkills.cjs`
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/tests/writing-brief-input.test.mjs`
- Modify: `content-engine/tests/creative-skills.test.mjs`

**Interfaces:**
- Consumes: `accountVoiceProfileId: string`（可以为空以允许尚未设置的项目保存规划）、`voiceOffset`。
- Produces: `getContext()` 返回 `{ brief, skills, accountVoice }`；`skills` 的写作维度固定为 `SUBJECT`、`CONTENT_TYPE`、`CHANNEL`。

- [ ] **Step 1: 先把旧 VOICE 行为写成失败回归测试**

```js
test('写作上下文只读取题材、内容类型、渠道规则和账号声音快照', async () => {
  const context = await store.getContext('workspace-id', 'project-1', 'WECHAT');
  assert.deepEqual(context.skills.map((skill) => skill.dimension), ['SUBJECT', 'CONTENT_TYPE', 'CHANNEL']);
  assert.equal(context.accountVoice.name, '把话说透');
  assert.equal(context.accountVoice.offset, 'SHARPER');
});

test('尚未选择账号声音允许保存规划，但阻断生成上下文', async () => {
  assert.doesNotThrow(() => writingBriefInput.parse({ ...brief, accountVoiceProfileId: '', voiceOffset: 'DEFAULT' }));
  await assert.rejects(() => store.getContext('workspace-id', 'project-without-voice', 'WECHAT'), /请先在设置中创建并选择账号声音/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern="账号声音快照|阻断生成上下文"`  
Expected: FAIL，当前上下文仍要求 `VOICE` Skill。

- [ ] **Step 3: 最小迁移实现**

将 `WRITING_DIMENSIONS` 改为 `['SUBJECT', 'CONTENT_TYPE', 'CHANNEL']`；保留 `DIMENSIONS` 和旧 `VOICE` 数据仅用于历史兼容，不能出现在新的写作查询和前端选择中。

`briefView()` 返回 `accountVoiceProfileId` 和 `voiceOffset`。`saveBrief()` 不再验证 `selectedSkills.VOICE`，但验证指定声音属于当前工作空间、处于 `ACTIVE` 状态；空 ID 可以保存。`getContext()` 在读取到空 ID 时抛出 `请先在设置中创建并选择账号声音后再生成正文。`，否则调用 `accountVoiceStore.getWritingSnapshot()` 并返回不可变快照。

在 TypeScript 域模型中新增：

```ts
export type VoiceOffset = 'DEFAULT' | 'MORE_RESTRAINED' | 'SHARPER' | 'MORE_PERSONAL' | 'MORE_NARRATIVE';
export interface AccountVoiceProfile { id: string; name: string; archetypeSlug: string; status: 'ACTIVE' | 'ARCHIVED'; version: number; summary: string; rules: AccountVoiceRules; updatedAt: string; }
export interface WritingBrief { /* existing fields */ accountVoiceProfileId: string; voiceOffset: VoiceOffset; }
```

- [ ] **Step 4: 运行 WritingBrief 与创作上下文回归测试**

Run: `npm test -- --test-name-pattern="写作上下文|账号声音|WritingBrief|Skill"`  
Expected: PASS；老数据可读取，新的生成上下文不能回退到 `VOICE` Skill。

- [ ] **Step 5: 提交写作上下文迁移**

```bash
git add server/services/writing-brief.cjs server/services/creativeSkills.cjs src/domain/creative.ts tests/writing-brief-input.test.mjs tests/creative-skills.test.mjs
git commit -m "feat: bind writing briefs to account voices"
```

## Task 4: 在设置中完成真实的账号声音创建与管理

**Files:**
- Create: `content-engine/src/workspaces/settings/AccountVoiceSettings.tsx`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/app/navigation.mjs`
- Modify: `content-engine/src/workspaces/SettingsWorkspace.tsx`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/web-navigation.test.mjs`

**Interfaces:**
- Consumes: `webAccountVoices.list/create/update/makeDefault/archive/remove/addCalibration/addPreference`。
- Produces: `SettingsSection = ... | 'voices'`，以及可选择的工作空间默认声音。

- [ ] **Step 1: 写导航和界面源代码断言**

```js
test('设置中有独立账号声音入口，不与模型 API 或提示词混放', () => {
  const nav = fs.readFileSync(new URL('../src/app/navigation.mjs', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../src/workspaces/settings/AccountVoiceSettings.tsx', import.meta.url), 'utf8');
  assert.match(nav, /\{ id: 'voices', label: '账号声音' \}/);
  assert.match(settings, /把话说透/);
  assert.match(settings, /用代表作校准/);
  assert.doesNotMatch(settings, /提示词正文|模仿作者/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern="独立账号声音入口"`  
Expected: FAIL，因为新设置节和组件尚不存在。

- [ ] **Step 3: 实现轻量三步向导与档案列表**

`AccountVoiceSettings.tsx` 必须只呈现一个当前动作：空态为“创建账号声音”；非空态为档案卡片列表和“新建”。创建弹层严格遵循：

1. 选择六个原型卡片（每张卡显示“这样写/避免这样写”各一行）；
2. 三个输入：`我是谁/以什么视角写`、`写给谁`、`读完留下什么`；
3. 可编辑的规则草案预览，并提供保存。

代表作校准为保存后的可选折叠项：录入链接或文件名、标题、授权确认和“我希望保留的表达特点”。不要抓取网页、不要显示“已学习作者风格”、不要要求每篇创作再次提供。归档和删除均使用现有确认对话模式；默认声音的卡片显示“当前默认”。

导航使用 `settings=voices`，`main.tsx` 只在 SettingsWorkspace 的 `panels.voices` 挂载组件。样式采用现有纸张背景、实色马卡龙标签和直角边框；桌面两列卡片，小屏单列；不使用渐变玻璃卡片和无意义 Anime.js。

- [ ] **Step 4: 运行前端类型检查、导航测试和构建**

Run: `npm test -- --test-name-pattern="独立账号声音入口|设置" && npm run typecheck && npm run build`  
Expected: PASS；390px 下只有一个创建主操作，卡片无横向滚动。

- [ ] **Step 5: 提交设置页**

```bash
git add src/workspaces/settings/AccountVoiceSettings.tsx src/data/webApi.ts src/app/navigation.mjs src/workspaces/SettingsWorkspace.tsx src/main.tsx src/styles.css tests/web-navigation.test.mjs
git commit -m "feat: add account voice settings workflow"
```

## Task 5: 让创作页继承声音，而非让用户选择泛化风格

**Files:**
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CopyWorkspace.tsx`
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/creative-workflow.test.mjs`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes: `WritingBrief.accountVoiceProfileId`、`WritingBrief.voiceOffset` 和 `webAccountVoices.list()`。
- Produces: 文案策略中的 `当前账号声音` 状态与 `voiceOffset` 下拉项；缺少声音时生成动作的阻断信息。

- [ ] **Step 1: 写创作页迁移测试**

```js
test('文案策略显示账号声音与本篇偏移，不再暴露语言风格下拉项', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(copy, /当前账号声音/);
  assert.match(copy, /本篇语气/);
  assert.match(copy, /MORE_RESTRAINED/);
  assert.doesNotMatch(copy, /\{ id: 'VOICE', label: '语言风格' \}/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern="账号声音与本篇偏移"`  
Expected: FAIL，因为现有 `sharedDimensions` 含 `VOICE`。

- [ ] **Step 3: 最小实现并保持自动保存**

`CreateWorkspace.defaultBrief()` 不再默认写入 `VOICE` Skill；它请求账号声音列表，在可用默认声音存在时预填 `accountVoiceProfileId`，否则保存空值并让文案阶段提示设置。`CopyWorkspace` 只保留题材、内容类型、渠道规则、目标篇幅，新增：

```tsx
<div className="copy-voice-state">
  <span>当前账号声音</span><b>{activeVoice?.name ?? '尚未设置'}</b>
  <button type="button" className="text-button" onClick={onOpenVoiceSettings}>管理</button>
</div>
<label><span>本篇语气</span><select value={strategy.voiceOffset} onChange={...}>...</select></label>
```

声音选择仅在当前项目显式选择一个现有档案时发生；没有声音时，正文手工编辑不受影响，但 `ProjectAgent` 的生成类动作收到 `blockedReason="请先设置账号声音"`。现有 700ms 自动保存节流、平台切换、版本候选和错误状态必须保持。

E2E 覆盖：新声音设为默认 → 新项目自动继承 → 刷新仍存在 → 选择“更锋利”后自动保存 → 移除声音时生成按钮被阻断但正文仍可编辑。

- [ ] **Step 4: 运行创作页、E2E、类型检查**

Run: `npm test -- --test-name-pattern="账号声音与本篇偏移|创作" && npm run typecheck && python tests/creative-workspace.e2e.py`  
Expected: PASS；正文编辑不被声音设置阻塞，只有模型生成被阻塞。

- [ ] **Step 5: 提交创作继承体验**

```bash
git add src/workspaces/create/CreateWorkspace.tsx src/workspaces/create/CopyWorkspace.tsx src/domain/creative.ts src/styles.css tests/creative-workflow.test.mjs tests/creative-workspace.e2e.py
git commit -m "feat: inherit account voice in copy workspace"
```

## Task 6: 在初稿、改写和审稿中落地去 AI 腔质量门

**Files:**
- Modify: `content-engine/server/services/creative-draft.cjs`
- Modify: `content-engine/server/services/project-copy-action.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/tests/creative-draft.test.mjs`
- Modify: `content-engine/tests/project-copy-action.test.mjs`

**Interfaces:**
- Consumes: `accountVoice: { name, version, rules, offset }` 和候选 `{ title, body }`。
- Produces: `detectVoiceViolations(body, rules)` 返回具体问题数组；`buildCopyQualityPrompt(..., accountVoice)` 把声音规则送入现有独立质量审稿。

- [ ] **Step 1: 写确定性套话检测与提示词上下文测试**

```js
test('检测已禁止的 AI 套话、emoji 小标题和强制互动', () => {
  const issues = detectVoiceViolations('很多人会问：这意味着什么？\n\n✨ 总结与行动建议\n\n建议点赞收藏，评论区聊聊。', voiceRules);
  assert.deepEqual(issues.map((item) => item.code), ['BANNED_PHRASE', 'EMOJI_HEADING', 'FORCED_CTA']);
});

test('初稿提示词含账号声音快照，但不含校准原文', () => {
  const prompt = buildDraftPrompt({ project, brief, skills, accountVoice, platform: 'WECHAT', outline, template: '' });
  assert.match(prompt.message, /把话说透/);
  assert.match(prompt.message, /避免假设读者提问/);
  assert.doesNotMatch(prompt.message, /代表作全文/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --test-name-pattern="AI 套话|账号声音快照"`  
Expected: FAIL，因为初稿和审稿当前不了解声音规则。

- [ ] **Step 3: 实现可解释的双层质量检查**

在 `project-copy-action.cjs` 增加纯函数 `detectVoiceViolations()`，只检测明确可解释的规则：声音 `bannedPhrases`、固定通用套话、emoji 单独标题、强制 CTA。返回 `{ code, excerpt, message }`，不得返回笼统的“AI 味重”。

`creative-draft.buildDraftPrompt()` 与各文案动作 message 均加入 `accountVoice` 的名称、版本、结构化规则与本篇偏移；删除平台默认模板中“开篇说明读者能获得什么”“自然互动/行动建议”等强制套话导向，改为“从已核验事实、明确判断或用户提供的具体观察进入；没有依据时不虚构作者经历；结尾仅在确有必要时自然收束”。

Worker 在调用现有模型质量审稿前先运行确定性检测。命中时把具体问题传进一次修订提示；未命中再要求质量审稿判断：作者视角、事实/判断边界、结构是否落入泛化科普模板、声音节奏是否一致。二次不通过保留候选并拒绝采用，错误信息逐条展示问题；不得自动覆盖正式稿或悄悄删改。

- [ ] **Step 4: 运行质量门回归测试**

Run: `npm test -- --test-name-pattern="AI 套话|账号声音快照|质量|候选"`  
Expected: PASS；旧事实质量门仍能阻断不可靠正文，新的声音门不影响手工保存和候选隔离。

- [ ] **Step 5: 提交写作质量门**

```bash
git add server/services/creative-draft.cjs server/services/project-copy-action.cjs server/worker.cjs tests/creative-draft.test.mjs tests/project-copy-action.test.mjs
git commit -m "feat: enforce account voice in copy quality checks"
```

## Task 7: 文档、完整验证与人工验收

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`
- Modify: `docs/superpowers/specs/2026-07-29-account-voice-design.md`

**Interfaces:**
- Consumes: Tasks 1-6 的最终 API、数据约束、UI 和测试结果。
- Produces: 可复现的人工验收路径与已实现/未实现范围。

- [ ] **Step 1: 写验收条目及真实测试清单**

在验收日志新增 `A43 账号声音/IP`，必须逐项记录：零样稿创建、原型及三句设定、编辑规则、设默认、项目继承、刷新恢复、本篇偏移、生成阻断、候选质量拒绝、显式偏好保存、跨工作空间拒绝。未执行真实模型调用的项目必须标记为 Mock，不能写“已验证”。

- [ ] **Step 2: 运行完整自动化套件**

Run: `npm test`  
Expected: 全部 Node 测试通过，无失败、跳过原因或被删除的旧回归。

- [ ] **Step 3: 运行构建和静态检查**

Run: `npm run typecheck && npm run build && git diff --check`  
Expected: 三项均退出码 0。

- [ ] **Step 4: 人工验收 Web 链路**

Run: `npm run dev`  
Expected: 依次完成“设置→账号声音→选择原型→填写三句→保存为默认→创作→正文→本篇语气→生成候选”。检查：没有泛化“语言风格”下拉项、没有提示词正文、正文手工输入不被阻断、候选中命中“很多人会问/emoji 标题/建议点赞收藏”时出现具体问题。

- [ ] **Step 5: 提交文档与最终验证结果**

```bash
git add docs/01_PRD_内容引擎.md docs/02_PLAN_内容引擎.md docs/03_IMPLEMENT_内容引擎.md docs/04_ACCEPTANCE_LOG_内容引擎.md docs/superpowers/specs/2026-07-29-account-voice-design.md
git commit -m "docs: record account voice implementation"
```

## 自审结果

- 覆盖性：设计中的六个原型、三步创建、可选校准、默认继承、单篇偏移、显式偏好、写作上下文、去 AI 腔质量门、异常处理和验收，分别由 Tasks 1-7 覆盖。
- 范围：不扩展到自动网页读取、配图、视频、发布、第三方模仿或账户 OAuth；这些均不在本计划中。
- 一致性：前端 `WritingBrief.accountVoiceProfileId/voiceOffset`、Zod schema、数据库列、`getContext()` 和初稿 prompt 使用同一命名；`VOICE` 仅作为旧数据兼容，不再参与新生成。
- 占位符扫描：本计划不含未定义实施步骤；第二包功能明确被排除，不被伪装为完成。
