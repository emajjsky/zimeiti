# Project Research Source Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute confirmed research-plan search and public-link actions, persist source snapshots, and show recoverable source results inside the project Agent.

**Architecture:** Reuse the existing generation-run confirmation protocol and BullMQ Worker. A focused research-source service normalizes plan actions and captured results; PostgreSQL stores run/source snapshots; the existing ProjectAgent renders the new confirmation and artifact without introducing another workspace page.

**Tech Stack:** React 19, TypeScript, Fastify, PostgreSQL, BullMQ, Tavily, existing public-web/Playwright reader, Node Test Runner, Playwright, native CSS

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Do not use subagents.
- Use `apply_patch` for file edits.
- Follow strict TDD and observe each targeted test fail before production changes.
- Preparing a source task must never call Tavily or a public website; only explicit confirmation may enqueue execution.
- Automated tests must mock Tavily, public web reading, Bailian, RSS and media APIs.
- This slice does not call an AI model and does not create evidence verdicts.
- Preserve Web-only architecture and the current project Agent timeline.
- Keep `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 7`.

---

### Task 1: Research-source contract and migration

**Files:**
- Create: `content-engine/server/migrations/019_project_research_sources.sql`
- Create: `content-engine/server/services/project-research-sources.cjs`
- Create: `content-engine/tests/project-research-sources.test.mjs`

**Interfaces:**
- Produces `PROJECT_RESEARCH_SOURCES_VERSION`, `researchSourceActions(plan)`, `sourceRunView(row)`, `normalizeSearchResults(action, results)`, and `normalizeReadResult(action, result)`.
- Adds `project_research_source_runs`, `project_research_sources`, and `RESEARCH_SOURCES` project artifacts.

- [x] Write failing tests for allowed actions, action counts, five-results-per-search limit, URL de-duplication data shape, and migration constraints.
- [x] Run `node --test tests/project-research-sources.test.mjs` and verify failure is caused by the missing module/migration.
- [x] Implement the migration and focused service.
- [x] Re-run the targeted test and verify it passes.

### Task 2: Prepare, confirm, execute, and persist

**Files:**
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/worker.cjs`
- Modify: `content-engine/server/services/project-agent.cjs`
- Modify: `content-engine/server/services/tavily.cjs`
- Modify: `content-engine/tests/project-research-sources.test.mjs`

**Interfaces:**
- Adds `POST /creative/projects/:projectId/research/sources/prepare`.
- Adds `POST /creative/research-source-runs/:id/confirm` and `/cancel`.
- Adds `PROJECT_RESEARCH_SOURCES` Worker execution with dependency-injectable normalization helpers.

- [x] Extend tests first to assert prepare creates only DRAFT state, confirm is the only enqueue boundary, active-run lookup includes both research action versions, and Worker dispatch exists.
- [x] Run the targeted test and verify the route/Worker assertions fail.
- [x] Implement route validation, Tavily credential preflight, queue boundaries, per-action execution, partial failure persistence, usage logging, and result artifact creation.
- [x] Re-run the targeted tests and the existing research-agent tests.

### Task 3: Project Agent controls and source-result preview

**Files:**
- Modify: `content-engine/src/domain/creative.ts`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/create/ProjectAgent.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Adds `PROJECT_RESEARCH_SOURCES` run action and `RESEARCH_SOURCES` artifact type.
- Adds `webCreative.prepareResearchSources(projectId)`, `confirmResearchSources(runId)`, and `cancelResearchSources(runId)` for the source-specific confirmation flow.

- [x] Extend Playwright first: open a completed plan, prepare source execution, assert confirmation counts, mock completion, open source results, refresh, and assert results remain.
- [x] Run Playwright and verify it fails because the action and artifact UI are absent.
- [x] Implement the single plan action, source-specific confirmation fields, source-result list, links, failure states, loading, and responsive CSS.
- [x] Run typecheck and Playwright at 1024px and 390px.

### Task 4: Documentation, verification, commit, and push

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Records source execution as completed without claiming AI evidence verification.

- [x] Update product, plan, implementation, and acceptance documents with the exact boundary and test evidence.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, Mock Playwright, migration idempotency, and `git diff --check`.
- [x] Commit implementation and documentation, push `main`, and verify a clean worktree with `HEAD == origin/main`.
