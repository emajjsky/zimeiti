# Zero-Material Research Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a confirmed content project to prepare a research plan with zero selected materials, provide one novice-friendly quick action, and render each pending confirmation only once.

**Architecture:** Add a small frontend domain module for composer eligibility, the fixed research quick action, and thread message filtering. Remove the server route's zero-material rejection while retaining project, policy, credential, snapshot, and confirmation checks. Extend the existing Playwright creative workflow with a zero-material prepare request that is mocked before any paid confirmation.

**Tech Stack:** React 19, TypeScript, Fastify, Node Test Runner, Playwright, native CSS

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Do not use subagents.
- Use `apply_patch` for file edits.
- Follow strict TDD: tests must fail for the intended missing behavior before production changes.
- Keep the product Web-only and keep the existing `ContentProject` and project Agent APIs.
- Preparing a task must never call Bailian; only explicit confirmation may enqueue execution.
- Do not implement `SEARCH_WEB`, `READ_LINK`, Playwright research, source snapshots, or evidence claims in this slice.
- Keep one quick action only; do not add explanatory cards, fake results, or additional settings.
- Preserve the current pop-retro fresh visual language with `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 7`.
- Automated tests must mock all business APIs and must not call Bailian, Tavily, RSS refresh, image, audio, or video endpoints.

---

### Task 1: Zero-material research domain and server contract

**Files:**
- Create: `content-engine/src/domain/project-agent-composer.mjs`
- Create: `content-engine/src/domain/project-agent-composer.d.mts`
- Create: `content-engine/tests/project-agent-composer.test.mjs`
- Modify: `content-engine/tests/project-research-agent.test.mjs`
- Modify: `content-engine/server/services/project-research.cjs`
- Modify: `content-engine/server/index.cjs`

**Interfaces:**
- Produces `researchQuickAction`, `canPrepareAgentRequest(input)`, and `messagesForAgentThread(messages)`.
- The research prepare route accepts empty `inputIds` and `referenceIds` but still validates all non-empty IDs through `researchSnapshot()`.

- [ ] Write failing domain tests asserting the fixed quick action, prepare eligibility without a material-count input, and removal of `CONFIRMATION` messages from the visible thread.
- [ ] Add failing research tests asserting that an empty-material prompt explicitly derives questions from confirmed planning and that the prepare route no longer contains the zero-material rejection.
- [ ] Run `node --test tests/project-agent-composer.test.mjs tests/project-research-agent.test.mjs` and verify failures are caused by the missing module and old rejection.
- [ ] Implement the domain module and declarations, add the zero-material prompt rule, and remove only the route's `请至少选择一条项目资料` guard.
- [ ] Re-run the targeted tests and verify all pass.
- [ ] Commit with `git commit -m "feat: allow zero-material research planning"`.

### Task 2: Research quick action and single confirmation state

**Files:**
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes Task 1 helpers.
- The quick action calls the existing `webCreative.prepareAgent()` with empty arrays when no materials are selected.

- [ ] Extend Playwright first: mock the research prepare endpoint, click “制定研究计划” on an empty project, assert the POST body has empty material arrays, assert the confirmation card reports `0 条`, and assert the duplicate confirmation message is absent.
- [ ] Run the creative Playwright workflow and verify it fails because the quick action is missing.
- [ ] Update `ProjectAgent` so typed requests and the quick action share one `prepare(nextRequest)` path; remove the frontend material blocker; render `未选资料` at zero; filter confirmation messages through the domain helper.
- [ ] Add restrained CSS for one compact quick action adjacent to the composer status; preserve existing responsive layout and focus states.
- [ ] Re-run targeted Node tests, typecheck, and Playwright; verify 1024px and 390px remain free of document overflow.
- [ ] Commit with `git commit -m "feat: start research without materials"`.

### Task 3: Documentation, verification, and push

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Records the completed zero-material planning boundary without claiming search or evidence execution.

- [ ] Update all four documents with the zero-material user path, confirmation boundary, hidden duplicate state, test evidence, and next `SEARCH_WEB`/`READ_LINK` slice.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, the Mock Playwright creative workflow, and `git diff --check`.
- [ ] Commit documentation with `git commit -m "docs: record zero-material research acceptance"`.
- [ ] Push `main`, then verify `HEAD` equals `origin/main` and the worktree is clean.
