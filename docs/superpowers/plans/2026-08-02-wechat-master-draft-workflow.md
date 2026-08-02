# WeChat Master Draft Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-platform parallel workflow with one WeChat master workflow, derived Xiaohongshu/Weibo drafts, reusable WeChat layout templates, and account-bound delivery to platform draft boxes.

**Architecture:** `content_projects` keeps preparation and the five-step project stage only. Editable platform drafts, immutable versions, ordered assets, layout templates, channel accounts, and platform-draft delivery tasks move into normalized workspace-scoped tables and focused services. The final cutover migrates existing data once, removes `delivery.platforms`, Review, Zhihu, and legacy platform routes, and never dual-writes.

**Tech Stack:** React 19, TypeScript, Vite, Fastify 5, PostgreSQL, Redis/BullMQ, Zod 4, Node test runner, Playwright Python E2E.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- WeChat is the mandatory master draft and supports at most 12 images.
- Xiaohongshu and Weibo are derived drafts and support at most 9 images each.
- Remove Zhihu from active product data, UI, API, task policies, prompt templates, and runtime contracts; preserve only immutable usage audit after exporting business content.
- Remove the independent Review step. Deterministic preflight checks run inline; `CONTENT_PREFLIGHT_REVIEW` runs only on explicit user action.
- Every AI action uses its own visible task Scope and saved policy; missing policy returns `TASK_POLICY_REQUIRED`; no fallback model or browser-supplied model override is allowed.
- Drafts are account-neutral. Accounts are selected only when a draft version is sent to a platform draft box.
- This release does not directly publish public posts and must not label a platform draft as published.
- Do not dual-write new draft data and `content_projects.project_json.delivery`; remove the old runtime after the one-time migration.
- Back up PostgreSQL and the upload directory before applying destructive migrations; stop on any count, relationship, size, or SHA-256 mismatch.
- Keep `03_IMPLEMENT_内容引擎.md` factual: update it only after code, migration, automated checks, and real browser validation pass.

## File Map

### Create

- `content-engine/src/domain/content-drafts.ts`: frontend draft, template, account, and delivery DTOs.
- `content-engine/src/domain/draft-workflow.mjs`: five-step project workflow and image-limit rules.
- `content-engine/src/domain/draft-workflow.d.mts`: TypeScript declarations for the workflow module.
- `content-engine/server/migrations/028_content_draft_foundation.sql`: new tables, indexes, built-in templates, and data backfill.
- `content-engine/server/migrations/029_remove_legacy_platform_workflow.sql`: final removal of old platform business data and constraints.
- `content-engine/scripts/export-zhihu-archive.cjs`: read-only pre-migration archive and manifest generator.
- `content-engine/scripts/verify-draft-migration.cjs`: post-migration database and file reconciliation.
- `content-engine/server/services/content-drafts.cjs`: draft working-copy, version, revision, and ordered-asset store.
- `content-engine/server/services/wechat-layout-renderer.cjs`: strict structured-template renderer and deterministic preflight.
- `content-engine/server/services/wechat-layout-templates.cjs`: template CRUD, versioning, source analysis, and reference protection.
- `content-engine/server/services/draft-adaptation.cjs`: Xiaohongshu/Weibo prompt building, parsing, and source-version rules.
- `content-engine/server/services/channel-accounts.cjs`: real manual/official account records and verified capabilities.
- `content-engine/server/services/platform-draft-connectors.cjs`: connector registry; unavailable capabilities stay unavailable.
- `content-engine/server/services/platform-draft-tasks.cjs`: idempotent manual/official platform-draft tasks and receipts.
- `content-engine/server/routes/content-drafts.cjs`: draft and adaptation routes.
- `content-engine/server/routes/wechat-layout-templates.cjs`: template routes.
- `content-engine/server/routes/platform-drafts.cjs`: account and delivery-task routes.
- `content-engine/src/workspaces/create/PreparationWorkspace.tsx`: planning, materials, optional research, and entry to WeChat writing.
- `content-engine/src/workspaces/create/DraftResultWorkspace.tsx`: WeChat result and derived-draft actions.
- `content-engine/src/workspaces/create/PlatformDraftEditor.tsx`: one-page text and image editor for Xiaohongshu/Weibo.
- `content-engine/src/workspaces/create/WechatLayoutTemplatePicker.tsx`: template gallery, import, and template management.
- `content-engine/src/workspaces/publish/PublishingWorkspace.tsx`: content drafts, platform tasks, and account tabs.
- `content-engine/src/workspaces/publish/ChannelAccountSettings.tsx`: account CRUD and capability display.
- `content-engine/tests/draft-workflow.test.mjs`
- `content-engine/tests/content-drafts.test.mjs`
- `content-engine/tests/content-draft-migration.test.mjs`
- `content-engine/tests/wechat-layout-templates.test.mjs`
- `content-engine/tests/draft-adaptation.test.mjs`
- `content-engine/tests/channel-accounts.test.mjs`
- `content-engine/tests/platform-draft-tasks.test.mjs`

### Modify

- `content-engine/server/index.cjs`: register focused route modules; remove old delivery/review routes at cutover.
- `content-engine/server/worker.cjs`: persist WeChat generation to drafts and add adaptation/platform-draft job handlers.
- `content-engine/server/services/project-planning.cjs`: normalize project stages and force WeChat preparation.
- `content-engine/server/services/project-copy-action.cjs`: WeChat-only copy contract and draft persistence metadata.
- `content-engine/server/services/visual-planning.cjs`: WeChat-only planning limits and explicit policy.
- `content-engine/server/services/writing-brief.cjs`: WeChat-only writing brief.
- `content-engine/server/services/creativeSkills.cjs`: WeChat writing rules only; adaptation uses task prompts.
- `content-engine/server/services/workspaces.cjs`: deletion impact includes channel accounts and platform-draft tasks.
- `content-engine/src/data/webApi.ts`: replace legacy delivery APIs with drafts/templates/accounts/platform-task APIs.
- `content-engine/src/domain/content.ts`: remove active Zhihu and legacy delivery types after cutover.
- `content-engine/src/domain/creative.ts`: remove multi-platform writing and Review runtime types.
- `content-engine/src/domain/integrations.ts`: add explicit task Scopes and remove fallback policy fields.
- `content-engine/src/app/navigation.mjs` and `.d.mts`: remove platform query and use five workflow routes.
- `content-engine/src/domain/creative-flow.mjs` and `.d.mts`: route project state to the five steps.
- `content-engine/src/domain/creative-project-center.mjs`: derive next action from the new project state.
- `content-engine/src/domain/today.mjs`: derive tasks from the new project state and local drafts.
- `content-engine/src/workspaces/create/CreateWorkspace.tsx`: linear orchestrator only.
- `content-engine/src/workspaces/create/CopyWorkspace.tsx`: fixed WeChat master editor.
- `content-engine/src/workspaces/create/VisualWorkspace.tsx`: bind to WeChat draft rather than platform delivery JSON.
- `content-engine/src/workspaces/create/LayoutWorkspace.tsx`: real rendered preview and completion to draft.
- `content-engine/src/workspaces/create/PlanningWorkspace.tsx`: remove platform checkboxes; WeChat is implicit.
- `content-engine/src/SettingsWorkspace.tsx`: rename account settings to publishing accounts.
- `content-engine/src/main.tsx`: remove active platform state and inline fake publishing page; mount focused workspaces.
- `content-engine/src/styles.css`: remove obsolete channel/review/fake-calendar CSS and add stable responsive layouts.
- Existing unit and E2E tests named in the tasks below.
- `docs/02_PLAN_内容引擎.md` and `docs/03_IMPLEMENT_内容引擎.md`: final verified status only.

### Delete At Final Cutover

- `content-engine/src/domain/channel-workflow.mjs`
- `content-engine/src/domain/channel-workflow.d.mts`
- `content-engine/src/domain/writing-brief-platforms.mjs`
- `content-engine/src/domain/writing-brief-platforms.d.mts`
- `content-engine/src/workspaces/create/ReviewWorkspace.tsx`
- `content-engine/src/workspaces/settings/AccountAuthorizationSettings.tsx`

---

### Task 1: Lock The New Domain Contract

**Files:**
- Create: `content-engine/src/domain/content-drafts.ts`
- Create: `content-engine/src/domain/draft-workflow.mjs`
- Create: `content-engine/src/domain/draft-workflow.d.mts`
- Create: `content-engine/tests/draft-workflow.test.mjs`

**Interfaces:**
- Produces: `DraftPlatform`, `ProjectWorkflowStage`, `ContentDraft`, `ContentDraftVersion`, `DraftAsset`, `WechatLayoutTemplate`, `ChannelAccount`, `PlatformDraftTask`.
- Produces: `draftWorkflowSteps`, `routeForProjectStage(stage)`, `canOpenDraftStep(stage, route)`, `draftImageLimit(platform)`.

- [ ] **Step 1: Write failing workflow tests**

```js
assert.deepEqual(draftWorkflowSteps.map(({ id }) => id), ['preparation', 'copy', 'visual', 'layout', 'drafts']);
assert.equal(routeForProjectStage('WECHAT_IMAGING'), 'visual');
assert.equal(canOpenDraftStep('WECHAT_WRITING', 'layout'), false);
assert.equal(draftImageLimit('WECHAT'), 12);
assert.equal(draftImageLimit('XIAOHONGSHU'), 9);
assert.throws(() => draftImageLimit('ZHIHU'), /不支持的平台/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/draft-workflow.test.mjs`

Expected: FAIL because `draft-workflow.mjs` does not exist.

- [ ] **Step 3: Define the exact workflow module**

```js
export const draftWorkflowSteps = [
  { id: 'preparation', label: '内容准备', stage: 'PREPARING' },
  { id: 'copy', label: '公众号正文', stage: 'WECHAT_WRITING' },
  { id: 'visual', label: '公众号配图', stage: 'WECHAT_IMAGING' },
  { id: 'layout', label: '公众号排版', stage: 'WECHAT_LAYOUT' },
  { id: 'drafts', label: '完成草稿', stage: 'DRAFT_READY' },
];

const limits = { WECHAT: 12, XIAOHONGSHU: 9, WEIBO: 9 };
export function draftImageLimit(platform) {
  if (!(platform in limits)) throw new Error(`不支持的平台：${platform}`);
  return limits[platform];
}
```

Define DTOs with `platform: 'WECHAT' | 'XIAOHONGSHU' | 'WEIBO'`, `revision: number`, immutable version IDs, `sourceDraftVersionId`, ordered assets, and no `accountId` on draft types.

- [ ] **Step 4: Run the test and typecheck**

Run: `node --test tests/draft-workflow.test.mjs && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content-engine/src/domain/content-drafts.ts content-engine/src/domain/draft-workflow.mjs content-engine/src/domain/draft-workflow.d.mts content-engine/tests/draft-workflow.test.mjs
git commit -m "feat: define master draft workflow"
```

### Task 2: Add Safe Archive And Migration Contracts

**Files:**
- Create: `content-engine/scripts/export-zhihu-archive.cjs`
- Create: `content-engine/scripts/verify-draft-migration.cjs`
- Create: `content-engine/server/migrations/028_content_draft_foundation.sql`
- Create: `content-engine/tests/content-draft-migration.test.mjs`
- Modify: `content-engine/package.json`

**Interfaces:**
- Produces tables: `content_drafts`, `content_draft_versions`, `content_draft_assets`, `wechat_layout_templates`, `wechat_layout_template_versions`, `channel_accounts`, `platform_draft_tasks`.
- Produces archive command: `npm run archive:zhihu -- --output <absolute-directory>`.
- Produces verification command: `npm run verify:draft-migration -- --manifest <absolute-manifest-path>`.

- [ ] **Step 1: Write migration contract tests**

Assert the migration contains composite workspace foreign keys, three-platform checks, revision checks, immutable version uniqueness, ordered assets, template-source checks, account capability fields, task idempotency, and no cascade from templates to draft versions.

```js
assert.match(sql, /CREATE TABLE content_drafts/);
assert.match(sql, /platform text NOT NULL CHECK \(platform IN \('WECHAT', 'XIAOHONGSHU', 'WEIBO'\)\)/);
assert.match(sql, /UNIQUE \(workspace_id, project_id, platform\)/);
assert.match(sql, /CREATE TABLE content_draft_versions/);
assert.match(sql, /source_draft_version_id uuid/);
assert.match(sql, /CREATE TABLE content_draft_assets/);
assert.match(sql, /CREATE TABLE wechat_layout_template_versions/);
assert.match(sql, /CREATE TABLE channel_accounts/);
assert.match(sql, /CREATE TABLE platform_draft_tasks/);
assert.doesNotMatch(sql, /ON DELETE CASCADE[\s\S]*layout_template_version_id/);
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `node --test tests/content-draft-migration.test.mjs`

Expected: FAIL because migration and scripts do not exist.

- [ ] **Step 3: Implement the archive script**

The script must:

1. Resolve an explicit absolute output directory and refuse the workspace root, drive root, or an existing non-empty directory.
2. Query every business row containing `ZHIHU`, grouped by workspace/project.
3. Write `zhihu-projects.json`, one readable Markdown file per project, `asset-manifest.json`, and `manifest.json` with row counts and SHA-256 values.
4. Copy no secrets and print no database URL.
5. Exit non-zero when a referenced asset is missing.

Add scripts:

```json
{
  "archive:zhihu": "node scripts/export-zhihu-archive.cjs",
  "verify:draft-migration": "node scripts/verify-draft-migration.cjs"
}
```

- [ ] **Step 4: Implement migration 028**

Use this concrete table shape:

```sql
CREATE TABLE content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WECHAT', 'XIAOHONGSHU', 'WEIBO')),
  status text NOT NULL DEFAULT 'EDITING' CHECK (status IN ('EDITING', 'READY', 'ARCHIVED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  visual_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(visual_plan_json) = 'object'),
  layout_template_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, platform)
);
```

Create immutable versions with `UNIQUE (workspace_id, draft_id, version_number)`, `source_draft_version_id`, `generation_run_id`, `rendered_html`, and frozen `layout_template_version_id`. Create `content_draft_assets` with `draft_id`, nullable `draft_version_id`, `asset_id`, `role`, `sort_order`, and partial unique indexes for working versus frozen rows. Every asset uses `(workspace_id, asset_id)` foreign keys.

Seed six structured built-in templates: 清爽阅读、商务报告、科技媒体、人文杂志、现代报刊、知识长文. Backfill all existing `platform_content_versions`; add a `MIGRATED_CURRENT` version when project JSON contains a different current body. Link migrated Xiaohongshu/Weibo versions to the latest migrated WeChat version for the same project. Do not drop old tables or JSON fields in migration 028.

- [ ] **Step 5: Implement post-migration verification**

The verifier must compare the archive/preflight manifest with:

- total projects and per-platform drafts;
- version counts and current title/body hashes;
- draft asset foreign keys and file existence;
- file size and SHA-256;
- derived drafts without a WeChat source;
- business rows still containing `ZHIHU` after migration 029;
- project JSON rows still containing `versions` or `delivery`.

It must print a JSON summary and exit non-zero for any mismatch.

- [ ] **Step 6: Run focused tests and script syntax checks**

Run: `node --test tests/content-draft-migration.test.mjs && node --check scripts/export-zhihu-archive.cjs && node --check scripts/verify-draft-migration.cjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add content-engine/package.json content-engine/scripts/export-zhihu-archive.cjs content-engine/scripts/verify-draft-migration.cjs content-engine/server/migrations/028_content_draft_foundation.sql content-engine/tests/content-draft-migration.test.mjs
git commit -m "feat: add safe content draft migration"
```

### Task 3: Implement Draft Store And Resource APIs

**Files:**
- Create: `content-engine/server/services/content-drafts.cjs`
- Create: `content-engine/server/routes/content-drafts.cjs`
- Create: `content-engine/tests/content-drafts.test.mjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/data/webApi.ts`

**Interfaces:**
- Produces: `createContentDraftStore({ query, transaction })`.
- Methods: `listProject`, `get`, `upsertWechat`, `patchWorkingCopy`, `replaceWorkingAssets`, `complete`, `versions`, `createDerivedWorkingCopy`, `markDerivedStale`.
- Route registrar: `registerContentDraftRoutes(app, { workspaceAccess, draftStore, assetStore })`.

- [ ] **Step 1: Write failing store tests with query/transaction fakes**

Cover workspace isolation, one draft per project/platform, revision conflict, account-neutral DTOs, source-version requirement, ordered image limits, and immutable completion.

```js
await assert.rejects(
  () => store.patchWorkingCopy(workspaceId, draftId, { revision: 3, title: '旧页面', body: '...' }),
  (error) => error.code === 'DRAFT_REVISION_CONFLICT',
);
await assert.rejects(
  () => store.createDerivedWorkingCopy(workspaceId, projectId, 'XIAOHONGSHU', null),
  (error) => error.code === 'DRAFT_SOURCE_VERSION_STALE',
);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/content-drafts.test.mjs`

Expected: FAIL because store and routes do not exist.

- [ ] **Step 3: Implement DTOs and store transactions**

`patchWorkingCopy` must execute:

```sql
UPDATE content_drafts
SET title = $4, body = $5, revision = revision + 1, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND revision = $3
RETURNING *
```

If no row returns, query by `(workspace_id, id)` to distinguish not found from revision conflict. `complete` locks the draft, validates body and assets, renders WeChat when required, inserts the next immutable version plus frozen asset rows, updates `status/current_version_id`, and commits atomically.

- [ ] **Step 4: Register exact routes**

Implement the routes from section 6.1 of the spec. Validate all IDs with Zod; use `VIEWER` for reads and `EDITOR` for writes. Return stable error codes through `businessError`.

- [ ] **Step 5: Add typed web client methods**

```ts
export const webDrafts = {
  list: (projectId: string) => request<{ drafts: ContentDraft[] }>(`/creative/projects/${encodeURIComponent(projectId)}/drafts`),
  patch: (draftId: string, input: DraftPatchInput) => request<ContentDraft>(`/content-drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  complete: (draftId: string) => request<{ draft: ContentDraft; version: ContentDraftVersion }>(`/content-drafts/${draftId}/complete`, { method: 'POST', body: '{}' }),
  versions: (draftId: string) => request<{ versions: ContentDraftVersion[] }>(`/content-drafts/${draftId}/versions`),
  preview: (draftId: string) => request<DraftPreview>(`/content-drafts/${draftId}/preview`),
};
```

- [ ] **Step 6: Run tests, typecheck, and server syntax**

Run: `node --test tests/content-drafts.test.mjs && node --check server/index.cjs && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add content-engine/server/services/content-drafts.cjs content-engine/server/routes/content-drafts.cjs content-engine/server/index.cjs content-engine/src/data/webApi.ts content-engine/tests/content-drafts.test.mjs
git commit -m "feat: add content draft api"
```

### Task 4: Persist WeChat Copy And Visuals Into The Draft Domain

**Files:**
- Modify: `content-engine/server/services/project-copy-action.cjs`
- Modify: `content-engine/server/services/visual-planning.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/routes/content-drafts.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/tests/project-copy-action.test.mjs`
- Modify: `content-engine/tests/visual-planning.test.mjs`
- Create: `content-engine/tests/wechat-draft-generation.test.mjs`

**Interfaces:**
- Consumes: `draftStore.upsertWechat`, `draftStore.patchWorkingCopy`, `draftStore.replaceWorkingAssets`.
- Produces jobs using exact Scopes `WECHAT_COPY_GENERATION` and `WECHAT_VISUAL_PLANNING`.

- [ ] **Step 1: Write failing generation tests**

Assert WeChat generation snapshots contain only `platform: 'WECHAT'`, missing policy throws `TASK_POLICY_REQUIRED`, a successful Worker result updates the WeChat working draft, and no code updates `project_json.versions` or `delivery.platforms`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/wechat-draft-generation.test.mjs tests/project-copy-action.test.mjs tests/visual-planning.test.mjs`

Expected: FAIL on the new draft persistence expectations.

- [ ] **Step 3: Make copy generation WeChat-only**

Replace platform-specific initial generation routing with `WECHAT_COPY_GENERATION`. Keep research preparation and account voice behavior, but persist title/body through `draftStore.upsertWechat` in the same transaction that marks `generation_runs` and `jobs` successful. Remove automatic fallback routes.

- [ ] **Step 4: Move visual working state out of project JSON**

The visual save route must receive `draftId`, validate it is the project's WeChat draft, validate up to 12 current project image assets, write `visual_plan_json`, and replace working asset rows atomically. `VisualWorkspace` migration occurs in Task 7; retain no second write to `delivery.platforms`.

- [ ] **Step 5: Expose visible task snapshots**

Every generation response or run DTO includes:

```js
{
  scope: 'WECHAT_COPY_GENERATION',
  provider: route.provider,
  connectionId: route.connectionId ?? null,
  model: route.model,
  promptVersion: template.version,
}
```

- [ ] **Step 6: Run focused and full unit tests**

Run: `node --test tests/wechat-draft-generation.test.mjs tests/project-copy-action.test.mjs tests/visual-planning.test.mjs && npm test`

Expected: PASS after updating tests that intentionally asserted the legacy platform write.

- [ ] **Step 7: Commit**

```bash
git add content-engine/server/services/project-copy-action.cjs content-engine/server/services/visual-planning.cjs content-engine/server/worker.cjs content-engine/server/routes/content-drafts.cjs content-engine/server/index.cjs content-engine/tests/project-copy-action.test.mjs content-engine/tests/visual-planning.test.mjs content-engine/tests/wechat-draft-generation.test.mjs
git commit -m "refactor: persist wechat creation as drafts"
```

### Task 5: Build WeChat Template Service And Safe Renderer

**Files:**
- Create: `content-engine/server/services/wechat-layout-renderer.cjs`
- Create: `content-engine/server/services/wechat-layout-templates.cjs`
- Create: `content-engine/server/routes/wechat-layout-templates.cjs`
- Create: `content-engine/tests/wechat-layout-templates.test.mjs`
- Modify: `content-engine/server/services/public-web.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/package.json`

**Interfaces:**
- Produces: `renderWechatDraft({ title, body, assets, templateRules }) -> { html, checks }`.
- Produces: `analyzeWechatTemplateSource({ url, confirmedRights, route, runTextTask })`.
- Produces: `createWechatLayoutTemplateStore({ query, transaction })`.

- [ ] **Step 1: Write failing renderer and template tests**

Cover escaping `<script>`, deterministic output, 12-image enforcement, missing asset checks, template whitelist validation, source-rights confirmation, WeChat-only public URLs, import failure without empty rows, template versioning, and in-use deletion returning `LAYOUT_TEMPLATE_IN_USE`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/wechat-layout-templates.test.mjs`

Expected: FAIL because services do not exist.

- [ ] **Step 3: Add `cheerio` for structured source parsing**

Run: `npm install cheerio`

Use Cheerio only to extract `#js_content`, inline style signals, headings, paragraphs, quotes, separators, figures, and color/spacing samples. Never store source body or source images in template tables.

- [ ] **Step 4: Implement strict rule schema and renderer**

The rule object must be versioned and contain only whitelisted numeric/string fields:

```js
{
  schemaVersion: 1,
  canvas: { background: '#ffffff', textColor: '#1f2937', maxWidth: 677 },
  title: { fontSize: 30, fontWeight: 700, lineHeight: 1.35, color: '#111827' },
  body: { fontSize: 16, lineHeight: 1.9, paragraphSpacing: 18 },
  heading: { fontSize: 21, color: '#1d4ed8', borderColor: '#1d4ed8' },
  quote: { background: '#f5f7fa', borderColor: '#94a3b8' },
  image: { borderRadius: 0, spacing: 20, captionColor: '#64748b' },
  divider: { color: '#d1d5db', thickness: 1 }
}
```

Validate colors as six-digit hex, clamp numeric ranges, escape all content, and generate all tags itself. Do not accept arbitrary CSS or HTML from model output.

- [ ] **Step 5: Implement import and CRUD routes**

Reuse `fetchPublicPage` protections, require `{ url, confirmedRights: true, name }`, resolve only `WECHAT_TEMPLATE_ANALYSIS`, write usage logs, and create the template/version only after parsed model rules pass the strict schema.

- [ ] **Step 6: Run tests, audit dependency, and syntax**

Run: `node --test tests/wechat-layout-templates.test.mjs && npm audit --omit=dev && node --check server/index.cjs`

Expected: PASS with no high/critical production vulnerability.

- [ ] **Step 7: Commit**

```bash
git add content-engine/package.json content-engine/package-lock.json content-engine/server/services/wechat-layout-renderer.cjs content-engine/server/services/wechat-layout-templates.cjs content-engine/server/routes/wechat-layout-templates.cjs content-engine/server/services/public-web.cjs content-engine/server/index.cjs content-engine/tests/wechat-layout-templates.test.mjs
git commit -m "feat: add wechat layout templates"
```

### Task 6: Build Template Gallery And Real Layout Preview

**Files:**
- Create: `content-engine/src/workspaces/create/WechatLayoutTemplatePicker.tsx`
- Modify: `content-engine/src/workspaces/create/LayoutWorkspace.tsx`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/styles.css`
- Create: `content-engine/tests/wechat-layout-ui.test.mjs`

**Interfaces:**
- Consumes: template list/import/duplicate/archive/preview APIs and `webDrafts.complete`.
- Produces: `LayoutWorkspace({ draft, onDraftChange, onComplete })` with no platform prop.

- [ ] **Step 1: Write failing UI contract tests**

Assert the layout UI contains a template gallery, import URL plus rights checkbox, real preview iframe, template actions, and “保存公众号草稿”; assert it contains no `<pre>`, “HTML 发布稿”, or “进入审核”.

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/wechat-layout-ui.test.mjs`

Expected: FAIL against the current raw HTML preview.

- [ ] **Step 3: Add typed template client**

Expose list, create, patch, duplicate, archive, import, and preview functions under `webWechatTemplates`. Import body must include `confirmedRights: true`; there is no model field.

- [ ] **Step 4: Implement stable gallery and preview**

Use six built-in template cards with rendered mini-previews, not decorative placeholder cards. The selected template renders into a sandboxed iframe using the exact preview HTML response. The iframe uses a stable aspect ratio/min-height and cannot execute scripts.

- [ ] **Step 5: Implement import and management states**

Show loading, unreadable link, missing policy, invalid model output, saved, duplicate, archived, and in-use states. The main action remains “保存公众号草稿”; template management stays secondary.

- [ ] **Step 6: Run UI test, typecheck, and build**

Run: `node --test tests/wechat-layout-ui.test.mjs && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add content-engine/src/workspaces/create/WechatLayoutTemplatePicker.tsx content-engine/src/workspaces/create/LayoutWorkspace.tsx content-engine/src/data/webApi.ts content-engine/src/styles.css content-engine/tests/wechat-layout-ui.test.mjs
git commit -m "feat: render wechat layout previews"
```

### Task 7: Replace The Two-Dimensional Creation UI With One Linear Workflow

**Files:**
- Create: `content-engine/src/workspaces/create/PreparationWorkspace.tsx`
- Create: `content-engine/src/workspaces/create/DraftResultWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/PlanningWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CopyWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/VisualWorkspace.tsx`
- Modify: `content-engine/src/app/navigation.mjs`
- Modify: `content-engine/src/app/navigation.d.mts`
- Modify: `content-engine/src/domain/creative-flow.mjs`
- Modify: `content-engine/src/domain/creative-flow.d.mts`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/creative-flow.test.mjs`
- Modify: `content-engine/tests/web-navigation.test.mjs`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes: `draftWorkflowSteps`, `webDrafts`, fixed WeChat copy/visual/layout components.
- Produces URL stages: `preparation | copy | visual | layout | drafts`; removes `platform` URL state.

- [ ] **Step 1: Rewrite failing navigation and E2E expectations**

Assert there are exactly five workflow buttons, no platform tabs, no Review, no Zhihu, no platform URL parameter, and only one enabled primary action per step. E2E must traverse preparation through saved WeChat draft and refresh each stage.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/creative-flow.test.mjs tests/web-navigation.test.mjs`

Expected: FAIL on legacy stage/platform navigation.

- [ ] **Step 3: Compose `PreparationWorkspace`**

Render planning first; after confirmation keep the user on the same page and show project materials, optional research Agent, and one “开始公众号正文” action. Remove target-platform checkboxes and persist `targetPlatforms: ['WECHAT']` deterministically.

- [ ] **Step 4: Rewrite `CreateWorkspace` as a small orchestrator**

Remove `activePlatform`, `onPlatform`, `ChannelView`, `channelStatus`, platform skill defaults, and `ReviewWorkspace`. Load the project's WeChat draft once and route the five steps to focused children.

- [ ] **Step 5: Convert copy and visual components**

`CopyWorkspace` receives the WeChat draft and no platform selector. `VisualWorkspace` receives `draftId`, fixed `WECHAT`, visible `WECHAT_VISUAL_PLANNING` strategy, and writes only draft working assets.

- [ ] **Step 6: Replace URL state**

Delete the `platform` query parameter and legacy create stage aliases. Invalid old URLs map to the stage derived from project state, without retaining a runtime platform compatibility branch.

- [ ] **Step 7: Run unit, E2E, typecheck, and build**

Run:

```powershell
npm test
npm run typecheck
npm run build
python C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run dev:web" --port 5173 -- python tests/creative-workspace.e2e.py
```

Expected: PASS; no console errors or horizontal overflow at 1440px and 390px.

- [ ] **Step 8: Commit**

```bash
git add content-engine/src/workspaces/create content-engine/src/app/navigation.mjs content-engine/src/app/navigation.d.mts content-engine/src/domain/creative-flow.mjs content-engine/src/domain/creative-flow.d.mts content-engine/src/main.tsx content-engine/src/styles.css content-engine/tests/creative-flow.test.mjs content-engine/tests/web-navigation.test.mjs content-engine/tests/creative-workspace.e2e.py
git commit -m "refactor: make wechat the creation workflow"
```

### Task 8: Add Explicit Xiaohongshu And Weibo Adaptation Jobs

**Files:**
- Create: `content-engine/server/services/draft-adaptation.cjs`
- Create: `content-engine/tests/draft-adaptation.test.mjs`
- Modify: `content-engine/server/routes/content-drafts.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/domain/integrations.ts`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/main.tsx`

**Interfaces:**
- Produces: `adaptationScope(platform)` returning only `XIAOHONGSHU_ADAPTATION | WEIBO_ADAPTATION`.
- Produces: `buildAdaptationPrompt(snapshot)`, `parseAdaptationOutput(content, platform)`.
- Produces job type: `DRAFT_ADAPTATION` with `{ runId, draftId, sourceDraftVersionId, platform }`.

- [ ] **Step 1: Write failing parser, policy, and Worker tests**

Cover source must be a completed WeChat version, exact Scope per target, missing policy blocks before job creation, strict JSON output, image suggestions only reference source asset IDs, 9-image limit, stale marker, and no automatic overwrite.

- [ ] **Step 2: Run test and verify failure**

Run: `node --test tests/draft-adaptation.test.mjs`

Expected: FAIL because adaptation service is absent.

- [ ] **Step 3: Define strict output contracts**

Xiaohongshu output:

```json
{"title":"","body":"","imageSuggestions":[{"sourceAssetId":"uuid-or-null","purpose":"","preferredRatio":"3:4","needsNewImage":false}]}
```

Weibo output:

```json
{"title":"","body":"","imageSuggestions":[{"sourceAssetId":"uuid","purpose":"","preferredRatio":"original","needsNewImage":false}]}
```

Reject unknown IDs, more than 9 suggestions, empty body, markdown wrapper objects, and any platform other than the two targets.

- [ ] **Step 4: Implement prepare/confirm/cancel and Worker persistence**

Resolve policy exclusively by Scope, freeze source title/body/asset list and strategy snapshot in `generation_runs`, enqueue `DRAFT_ADAPTATION`, and create/update the target working draft only after parse success. Existing ready versions remain unchanged.

- [ ] **Step 5: Add task settings names and client methods**

Add both Scopes to `modelTasks`, `ModelTask`, task groups, model requirements, usage labels, and `webDrafts.derive/confirmAdaptation/cancelAdaptation`.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/draft-adaptation.test.mjs && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add content-engine/server/services/draft-adaptation.cjs content-engine/server/routes/content-drafts.cjs content-engine/server/worker.cjs content-engine/server/index.cjs content-engine/src/domain/integrations.ts content-engine/src/data/webApi.ts content-engine/src/main.tsx content-engine/tests/draft-adaptation.test.mjs
git commit -m "feat: derive social platform drafts"
```

### Task 9: Build The One-Page Derived Draft Editor

**Files:**
- Create: `content-engine/src/workspaces/create/PlatformDraftEditor.tsx`
- Modify: `content-engine/src/workspaces/create/DraftResultWorkspace.tsx`
- Modify: `content-engine/src/workspaces/create/CreateWorkspace.tsx`
- Modify: `content-engine/src/styles.css`
- Create: `content-engine/tests/platform-draft-editor.test.mjs`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes: derived draft working copy, revision PATCH, ordered asset replacement, adaptation job status, asset picker, image generator.
- Produces a single page for text and images; no step navigation.

- [ ] **Step 1: Write failing UI and E2E expectations**

Assert both target platforms share one editor, text and ordered images are visible together, image preview works before and after selection, crop/replace/remove/reorder controls exist, max 9 is stable, and “配图/排版/审核” step labels do not exist.

- [ ] **Step 2: Run focused UI test and verify failure**

Run: `node --test tests/platform-draft-editor.test.mjs`

Expected: FAIL because editor does not exist.

- [ ] **Step 3: Implement draft result actions and stale state**

Show WeChat preview plus “生成小红书草稿”, “生成微博草稿”, and “去发布”. When the master version changes, show the frozen source version versus current version and require explicit regenerate; never run adaptation on page load.

- [ ] **Step 4: Implement one-page editor**

Use debounced revision PATCH for text and explicit asset-order saves. Reuse `AssetPreviewDialog` and `AssetPickerDialog`. A missing 3:4 Xiaohongshu card is a visible task in the same page; AI generation runs only after button click and displays `TEXT_TO_IMAGE` or `IMAGE_TO_IMAGE` strategy.

- [ ] **Step 5: Run tests and browser E2E**

Run:

```powershell
node --test tests/platform-draft-editor.test.mjs
npm run typecheck
npm run build
python C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run dev:web" --port 5173 -- python tests/creative-workspace.e2e.py
```

Expected: PASS at 1440px and 390px with no console errors.

- [ ] **Step 6: Commit**

```bash
git add content-engine/src/workspaces/create/PlatformDraftEditor.tsx content-engine/src/workspaces/create/DraftResultWorkspace.tsx content-engine/src/workspaces/create/CreateWorkspace.tsx content-engine/src/styles.css content-engine/tests/platform-draft-editor.test.mjs content-engine/tests/creative-workspace.e2e.py
git commit -m "feat: add social draft editor"
```

### Task 10: Replace Fake Authorization With Real Publishing Accounts

**Files:**
- Create: `content-engine/server/services/channel-accounts.cjs`
- Create: `content-engine/server/services/platform-draft-connectors.cjs`
- Create: `content-engine/tests/channel-accounts.test.mjs`
- Create: `content-engine/src/workspaces/publish/ChannelAccountSettings.tsx`
- Modify: `content-engine/server/routes/platform-drafts.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/SettingsWorkspace.tsx`
- Modify: `content-engine/src/app/navigation.mjs`
- Modify: `content-engine/src/app/navigation.d.mts`
- Delete: `content-engine/src/workspaces/settings/AccountAuthorizationSettings.tsx`

**Interfaces:**
- Produces account CRUD with platforms `WECHAT | XIAOHONGSHU | WEIBO`.
- Produces connector capability: `{ canCreateDraft: boolean, verifiedAt: string | null, reason: string }`.
- Produces `createPlatformDraftConnectorRegistry(connectors = [])` with no default external connector.

- [ ] **Step 1: Write failing account tests**

Cover Owner-only management, workspace isolation, manual account status `MANUAL_READY`, no fake OAuth state, encrypted credential references only, verified capability gating, and unsupported official connector errors.

- [ ] **Step 2: Run focused test and verify failure**

Run: `node --test tests/channel-accounts.test.mjs`

Expected: FAIL because account service is absent.

- [ ] **Step 3: Implement account store and connector registry**

The DTO may expose ID, platform, name, external account label, mode, status, capabilities, last verified time, and error. It must never expose `credential_id`, token, secret, or raw connector response. An empty registry means official draft delivery is unavailable, not silently manual.

- [ ] **Step 4: Register CRUD and capability routes**

Use `OWNER` for create/update/delete/connect/disconnect and `VIEWER` for list. Only persist `CONNECTED` after a connector's real verification result reports `canCreateDraft: true`.

- [ ] **Step 5: Replace the placeholder page**

Rename the setting label from “账号授权” to “发布账号”. Show actual account rows, explicit MANUAL/OFFICIAL mode, verified capability, error, create/edit/delete, and a true empty state. Remove claims about future automatic authorization.

- [ ] **Step 6: Run tests, typecheck, and build**

Run: `node --test tests/channel-accounts.test.mjs && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add content-engine/server/services/channel-accounts.cjs content-engine/server/services/platform-draft-connectors.cjs content-engine/server/routes/platform-drafts.cjs content-engine/server/index.cjs content-engine/src/data/webApi.ts content-engine/src/workspaces/publish/ChannelAccountSettings.tsx content-engine/src/SettingsWorkspace.tsx content-engine/src/app/navigation.mjs content-engine/src/app/navigation.d.mts content-engine/tests/channel-accounts.test.mjs
git rm content-engine/src/workspaces/settings/AccountAuthorizationSettings.tsx
git commit -m "feat: add publishing account management"
```

### Task 11: Implement Idempotent Platform Draft Tasks

**Files:**
- Create: `content-engine/server/services/platform-draft-tasks.cjs`
- Create: `content-engine/tests/platform-draft-tasks.test.mjs`
- Modify: `content-engine/server/routes/platform-drafts.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/server/services/workspaces.cjs`

**Interfaces:**
- Produces `createPlatformDraftTaskStore({ query, transaction, assetStore, connectorRegistry })`.
- Produces Worker job `PLATFORM_DRAFT_DELIVERY`.
- Produces manual package manifest `{ title, bodyFile, renderedHtmlFile?, assets[] }`.

- [ ] **Step 1: Write failing task tests**

Cover platform/account match, immutable version pinning, one task per idempotency key, manual package generation, manual confirmation, official capability gating, external draft ID requirement, retry from FAILED only, cancel before success only, and no public-publish status.

- [ ] **Step 2: Run focused test and verify failure**

Run: `node --test tests/platform-draft-tasks.test.mjs`

Expected: FAIL because service is absent.

- [ ] **Step 3: Implement task creation transaction**

Lock account and version in the same workspace, require matching platform and `READY` draft, create a deterministic idempotency key from account ID, version ID, and mode, and enqueue exactly one job.

- [ ] **Step 4: Implement manual delivery**

Create a ZIP containing UTF-8 text/HTML, ordered original images, and `manifest.json`; save it as a workspace asset and reference it from the task. Set `MANUAL_PENDING`, never `SUCCEEDED`. `manual-confirm` records actor/time and changes only to `MANUAL_CONFIRMED`.

- [ ] **Step 5: Implement official connector contract**

Call only a verified connector. Success requires a non-empty `externalDraftId`; store a whitelisted response summary and mark `SUCCEEDED`. Timeout leaves the task recoverable and retry first calls connector lookup by idempotency key when supported.

- [ ] **Step 6: Register list/create/retry/cancel/manual-confirm APIs**

Use `EDITOR` for task actions and `VIEWER` for list. Update workspace deletion impact to count `channel_accounts` and `platform_draft_tasks` rather than nonexistent publication tables for this phase.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test tests/platform-draft-tasks.test.mjs tests/workspaces.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add content-engine/server/services/platform-draft-tasks.cjs content-engine/server/routes/platform-drafts.cjs content-engine/server/worker.cjs content-engine/server/index.cjs content-engine/server/services/workspaces.cjs content-engine/src/data/webApi.ts content-engine/tests/platform-draft-tasks.test.mjs content-engine/tests/workspaces.test.mjs
git commit -m "feat: deliver content to platform drafts"
```

### Task 12: Replace The Fake Publish Center

**Files:**
- Create: `content-engine/src/workspaces/publish/PublishingWorkspace.tsx`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/styles.css`
- Create: `content-engine/tests/publishing-workspace.test.mjs`
- Create: `content-engine/tests/platform-draft-workspace.e2e.py`

**Interfaces:**
- Consumes: account list, compatible ready drafts, platform task list/create/retry/cancel/manual-confirm.
- Produces tabs `drafts | tasks | accounts` and exact flow account first, drafts second.

- [ ] **Step 1: Write failing UI and E2E tests**

Assert there are no fixed dates, Unsplash demo images, fake “待审核”, fake calendar posts, video account filters, or direct publish buttons. Assert account selection filters drafts by platform, checkboxes allow multiple drafts, manual package download works, official success shows external draft ID, and failure/retry is visible.

- [ ] **Step 2: Run focused UI test and verify failure**

Run: `node --test tests/publishing-workspace.test.mjs`

Expected: FAIL against the inline fake publish page in `main.tsx`.

- [ ] **Step 3: Build focused PublishingWorkspace**

Default to “内容草稿”. Disable submission until an account and at least one compatible ready draft are selected. Use a stable table/list layout for repeated work, not marketing cards. Put accounts in the third tab and reuse `ChannelAccountSettings`.

- [ ] **Step 4: Remove inline publish mock from `main.tsx`**

Delete `PublishPage`, its hard-coded dates/content, and unused icons/imports. Mount `PublishingWorkspace` for `view === 'publish'`. “去发布” from a project opens the draft tab with that project preselected.

- [ ] **Step 5: Remove obsolete publish CSS and add responsive constraints**

Delete `.calendar-grid`, `.calendar-post`, `.publish-review`, and fake review styles. New selection rows, counters, toolbars, checkboxes, and status columns must have stable dimensions and wrap at 390px without horizontal overflow.

- [ ] **Step 6: Run unit, E2E, typecheck, and build**

Run:

```powershell
node --test tests/publishing-workspace.test.mjs
npm run typecheck
npm run build
python C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run dev:web" --port 5173 -- python tests/platform-draft-workspace.e2e.py
```

Expected: PASS with no console error at 1440px and 390px.

- [ ] **Step 7: Commit**

```bash
git add content-engine/src/workspaces/publish/PublishingWorkspace.tsx content-engine/src/main.tsx content-engine/src/styles.css content-engine/tests/publishing-workspace.test.mjs content-engine/tests/platform-draft-workspace.e2e.py
git commit -m "feat: replace publish center with platform drafts"
```

### Task 13: Remove Legacy Platform Workflow And Zhihu Runtime

**Files:**
- Create: `content-engine/server/migrations/029_remove_legacy_platform_workflow.sql`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-planning.cjs`
- Modify: `content-engine/server/services/writing-brief.cjs`
- Modify: `content-engine/server/services/creativeSkills.cjs`
- Modify: `content-engine/server/services/project-copy-action.cjs`
- Modify: `content-engine/server/services/visual-planning.cjs`
- Modify: `content-engine/src/domain/content.ts`
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/domain/creative-project-center.mjs`
- Modify: `content-engine/src/domain/today.mjs`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/main.tsx`
- Delete: legacy workflow modules and `ReviewWorkspace.tsx` listed in the File Map.
- Rewrite: `content-engine/tests/delivery-workflow.test.mjs`
- Modify: all tests that assert Zhihu or legacy delivery behavior.

**Interfaces:**
- Consumes: all new draft/template/account/platform-task services.
- Produces: no active runtime reference to `delivery.platforms`, Review, Zhihu, multi-platform WritingBrief, or legacy layout/review routes.

- [ ] **Step 1: Write failing removal assertions**

Scan active source and route files, excluding migrations/docs/audit fixtures:

```js
assert.doesNotMatch(activeSource, /delivery\.platforms|ReviewWorkspace|completeReview|channel-workflow/);
assert.doesNotMatch(activeSource, /\bZHIHU\b|知乎/);
assert.doesNotMatch(api, /layout\/complete|review\/complete|platform-versions\/complete/);
assert.doesNotMatch(api, /operation === 'IMAGE_TO_IMAGE'[\s\S]*TEXT_TO_IMAGE/);
```

- [ ] **Step 2: Run removal tests and verify failure**

Run: `node --test tests/delivery-workflow.test.mjs tests/creative-platforms.test.mjs tests/writing-brief-platforms.test.mjs`

Expected: FAIL on legacy code.

- [ ] **Step 3: Implement migration 029 cleanup**

The migration must:

1. Assert every Xiaohongshu/Weibo draft has a WeChat source version.
2. Delete active Zhihu business rows after archive precondition is recorded in a migration-control table.
3. Reduce WritingBrief and skill composition platform JSON to WeChat only.
4. Remove `versions` and `delivery` from every project JSON and map project stage/status to the five-stage model.
5. Delete migrated platform-copy artifacts no longer used as business state while retaining `generation_runs` and `api_usage_logs`.
6. Drop `platform_content_versions` and `platform_strategies` only after count assertions pass.
7. Remove obsolete prompt template/action definitions for Zhihu and old platform drafts.

- [ ] **Step 4: Delete old routes, components, modules, and client methods**

Delete the visual/project delivery JSON routes, layout generate/complete, review complete, platform enable/complete, old candidate draft/outline endpoints no longer used by WeChat generation, Review component, platform tabs, and active platform URL state. Keep research and account voice services.

- [ ] **Step 5: Simplify active types and project state**

`ContentProject` must no longer contain `versions` or `delivery`. `ProjectStage` becomes the five explicit stages. WritingBrief stores WeChat rules only. `ModelTaskPolicy` removes fallback fields. Image-to-image without an explicit policy returns `TASK_POLICY_REQUIRED`.

- [ ] **Step 6: Update Today and project center**

Derive the one next action from project stage; `DRAFT_READY` opens the result page. Do not display “待审核”, “待排期”, “已发布”, or “待复盘” based on project JSON.

- [ ] **Step 7: Run source scans and full checks**

Run:

```powershell
rg -n "delivery\.platforms|ReviewWorkspace|completeReview|\bZHIHU\b|知乎" src server --glob '!migrations/**'
npm test
npm run typecheck
npm run build
node --check server/index.cjs
node --check server/worker.cjs
git diff --check
```

Expected: `rg` has no active runtime matches; every check passes.

- [ ] **Step 8: Commit**

```bash
git add -A content-engine
git commit -m "refactor: remove legacy platform workflow"
```

### Task 14: Rehearse Migration, Run End-To-End Acceptance, And Update Implementation Docs

**Files:**
- Modify: `content-engine/tests/creative-workspace.e2e.py`
- Modify: `content-engine/tests/visual-workspace.e2e.py`
- Modify: `content-engine/tests/platform-draft-workspace.e2e.py`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Generated outside repository: timestamped database dump, upload manifest, Zhihu archive, pre/post migration reports.

**Interfaces:**
- Consumes: completed implementation and both migrations.
- Produces: verified real migration report and one complete real browser workflow.

- [ ] **Step 1: Run the complete automated suite before touching real data**

Run:

```powershell
npm test
npm run typecheck
npm run build
node --check server/index.cjs
node --check server/worker.cjs
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Create a fresh timestamped backup and Zhihu archive**

Create a new directory under `F:\zimeitiyunying\backups\wechat-master-drafts-<timestamp>`. Run `pg_dump --format=custom`, hash the dump, snapshot the upload-file manifest, and run:

```powershell
npm run archive:zhihu -- --output "F:\zimeitiyunying\backups\wechat-master-drafts-<timestamp>\zhihu"
```

Expected: archive reports 6 Zhihu projects based on the 2026-08-02 preflight, unless the live database has legitimately changed; any changed count must be reviewed before continuing.

- [ ] **Step 3: Rehearse restore and migration on a separate database**

Restore the dump into a temporary database, point `DATABASE_URL` to it, run `npm run db:migrate`, then run `verify:draft-migration`. Do not apply to the real database until the rehearsal returns zero broken references, zero hash mismatches, zero orphan derived drafts, zero active Zhihu business rows, and zero project JSON `versions/delivery` fields.

- [ ] **Step 4: Apply migration to the real database in a write-stopped window**

Stop Web/API/Worker writes, run migrations once, run verification against the same preflight manifest, then restart API/Web/Worker. If verification fails, stop services and restore the complete dump plus upload directory; do not patch individual records.

- [ ] **Step 5: Run all browser suites**

Run creative, visual, workspace/assets, and platform-draft E2E at 1440px and 390px. Assert no raw HTML preview, platform tabs, Review, Zhihu, fake calendar, fake authorization, console errors, unhandled network requests, overlaps, or horizontal overflow.

- [ ] **Step 6: Perform one real logged-in acceptance flow**

Use a real project and configured task policies to complete WeChat copy, visuals, a system template, one authorized URL template analysis, rendered preview, WeChat draft, Xiaohongshu draft, Weibo draft, account selection, and manual or genuinely verified official platform-draft delivery. Do not create fake external IDs or claim unavailable official capability.

- [ ] **Step 7: Update factual documentation**

Record exact migration counts, backup paths and hashes, archive counts, automated results, real-browser results, which connector capabilities are truly available, and remaining gaps. Mark stage B/C complete only to the extent actually verified.

- [ ] **Step 8: Final repository audit and commit**

Run:

```powershell
rg -n "TODO|TBD|delivery\.platforms|ReviewWorkspace|\bZHIHU\b|知乎" content-engine/src content-engine/server --glob '!migrations/**'
git diff --check
git status --short
```

Review every remaining match; historical audit/migration references must be intentional. Then commit:

```bash
git add content-engine/tests docs/02_PLAN_内容引擎.md docs/03_IMPLEMENT_内容引擎.md
git commit -m "test: verify master draft workflow"
```

## Final Verification Matrix

| Requirement | Primary Task | Verification |
| --- | --- | --- |
| One linear WeChat workflow | 1, 7, 13 | domain tests + creative E2E |
| WeChat 12-image limit | 1, 4 | unit + API tests |
| Xiaohongshu/Weibo one-page drafts, 9 images | 8, 9 | parser/UI/E2E |
| Real WeChat layout templates and rendering | 5, 6 | renderer tests + browser preview |
| URL template analysis without content copying | 5 | source/parser/security tests + real authorized URL |
| Explicit task policy APIs and no fallback | 4, 5, 8, 13 | policy tests + source scan |
| Account-neutral drafts | 3, 11 | DTO/store/task tests |
| Account selection then draft selection | 10, 12 | publish E2E |
| Platform draft box only | 11, 12 | receipt/manual confirmation tests |
| Zhihu removal with archive | 2, 13, 14 | archive manifest + migration verifier |
| No Review or old delivery runtime | 7, 13 | source scan + E2E |
| No data loss or broken assets | 2, 14 | backup, restore rehearsal, SHA-256 reconciliation |

