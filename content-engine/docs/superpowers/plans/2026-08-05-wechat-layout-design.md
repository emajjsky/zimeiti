# Wechat Layout Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WECHAT_LAYOUT_DESIGN intelligent layout pass that turns clean WeChat copy plus images plus an optional template into structured layout annotations, then renders final HTML with the selected template.

**Architecture:** Keep copy clean and move visual emphasis decisions into the layout stage. The model returns a constrained JSON `layoutDesign`; our renderer maps those semantic annotations to existing template colors, heading variants, callouts, emphasis marks, and image placement. Store `layoutDesign` inside `content_drafts.visual_plan_json` alongside `layoutAddons` so it can be rerendered or replaced when the user changes template or reruns smart layout.

**Tech Stack:** Node/Fastify API, existing `runTextTask` text route, PostgreSQL JSON draft patching, React layout workspace, Node test runner and Playwright e2e.

## Global Constraints

- Always preserve the original draft body as clean text; do not rewrite copy or persist generated HTML in the body.
- Do not let the model return final HTML/CSS; it may only return constrained JSON.
- The selected template remains the visual source of truth for color, font sizing, heading variants, inline emphasis, and spacing.
- When no template is selected, auto-pick the first active layout template and still run the same design flow.
- Existing imported WeChat template analysis remains `WECHAT_TEMPLATE_ANALYSIS`; the new smart layout scope is `WECHAT_LAYOUT_DESIGN`.
- Store editable per-draft layout annotations in `draft.visualPlan.layoutDesign`.

---

### Task 1: Backend Smart Layout Design Contract

**Files:**
- Create: `server/services/wechat-layout-design.cjs`
- Modify: `server/routes/wechat-layout-templates.cjs`
- Modify: `server/services/wechat-layout-renderer.cjs`
- Test: `tests/wechat-layout-design.test.mjs`

**Interfaces:**
- Produces `WECHAT_LAYOUT_DESIGN_SCOPE = 'WECHAT_LAYOUT_DESIGN'`.
- Produces `buildWechatLayoutDesignPrompt({ title, body, assets, templateRules, instruction })`.
- Produces `parseWechatLayoutDesignContent(content, context)` returning `{ schemaVersion: 1, blocks: [], inlineMarks: [], notes: string }`.
- Extends `renderWechatDraft({ title, body, assets, templateRules, layoutAddons, layoutDesign })`.

- [ ] Write failing tests for parsing, prompt constraints, and renderer applying a lead block plus inline accent.
- [ ] Verify tests fail because the new module and render parameter do not exist.
- [ ] Implement the service with strict JSON parsing and clamping.
- [ ] Extend renderer to apply `layoutDesign` without allowing raw HTML.
- [ ] Run targeted tests and keep existing renderer tests green.

### Task 2: API Route And Persistence

**Files:**
- Modify: `server/routes/wechat-layout-templates.cjs`
- Modify: `server/index.cjs`
- Modify: `src/data/webApi.ts`
- Test: `tests/wechat-layout-templates.test.mjs`
- Test: `tests/wechat-draft-generation.test.mjs`

**Interfaces:**
- Produces `POST /api/v1/creative/drafts/:draftId/layout/design` with `{ templateId?: string, templateVersionId?: string, instruction?: string }`.
- Returns `{ draft, templateId, templateVersionId, layoutDesign, html, checks, policy }`.

- [ ] Write failing route test that resolves `WECHAT_LAYOUT_DESIGN`, calls `runTextTask`, patches `visualPlan.layoutDesign`, and returns rendered preview.
- [ ] Implement route dependency wiring in `server/index.cjs`.
- [ ] Add `webDrafts.designLayout` client API.
- [ ] Run route tests.

### Task 3: Layout Workspace UX

**Files:**
- Modify: `src/workspaces/create/LayoutWorkspace.tsx`
- Modify: `src/domain/content-drafts.ts`
- Modify: `src/styles.css`
- Test: `tests/wechat-layout-ui.test.mjs`
- Test: `tests/wechat-layout-workspace.e2e.py`

**Interfaces:**
- Adds a primary `智能精排` action in the layout workspace.
- Uses selected template when present; if not selected, the backend auto-selects a template.
- Shows returned policy and preview immediately.
- Keeps `保存公众号草稿` unchanged except it saves the selected template and current preview.

- [ ] Write failing UI tests for the smart layout button and API usage.
- [ ] Implement frontend state and button flow.
- [ ] Add concise status copy for smart layout.
- [ ] Run UI/e2e tests.

### Task 4: Final Verification

**Files:**
- No production changes unless verification exposes issues.

- [ ] Run `npm run typecheck`.
- [ ] Run focused Node tests.
- [ ] Run layout and visual e2e scripts.
- [ ] Run `npm run build`.
- [ ] Restart dev service if required.
