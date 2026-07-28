# Creative Project List Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current large project cards in the Creative project center with the approved compact project list and selected-project detail layout, while keeping `ContentProject` and the unified seven-stage workflow unchanged.

**Architecture:** Extract project-center filtering, selection fallback, and stage-action mapping into a small domain module so state behavior is independently testable. `CreativeProjectCenter` keeps the existing creation form, renders a desktop table plus detail panel, and renders compact mobile rows plus a bottom detail drawer from the same selected project state. No server API or project schema changes are required.

**Tech Stack:** React 19, TypeScript, Vite, Node Test Runner, Playwright, native CSS, Lucide React

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Do not use subagents.
- Use `apply_patch` for file edits.
- Follow strict TDD: new production behavior must have a failing test first.
- Keep the product Web-only; do not restore Electron or desktop-client code.
- Do not restore the Plan navigation, `TopicCandidate` business flow, “确认立项”, “已立项”, or project deletion.
- Keep the existing `ContentProject` API, project creation behavior, URL behavior, and seven-stage workflow unchanged.
- Visual direction: pop-retro fresh; `DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 7`.
- Use lines and selected-row state for hierarchy; do not use large floating project cards or large blank card areas.
- Macaron colors are limited to origin, stage, and platform labels.
- At 390px the document must not overflow horizontally.
- Automated tests must not call Bailian, Tavily, RSS refresh, image, audio, or video paid/external execution endpoints.

## File Structure

- `content-engine/src/domain/creative-project-center.mjs`: filter definitions, project filtering, selection fallback, and next-action mapping.
- `content-engine/src/domain/creative-project-center.d.mts`: TypeScript declarations for the project-center domain module.
- `content-engine/src/workspaces/create/CreativeProjectCenter.tsx`: creation form, desktop list/detail layout, mobile list/detail drawer.
- `content-engine/src/styles.css`: compact list, selected row, sticky detail, responsive stacked layout, and mobile drawer styles.
- `content-engine/tests/creative-project-center.test.mjs`: pure behavior tests for filtering, selection, and actions.
- `content-engine/tests/creative-workspace.e2e.py`: browser behavior and responsive acceptance.
- `docs/01_PRD_内容引擎.md`, `docs/02_PLAN_内容引擎.md`, `docs/03_IMPLEMENT_内容引擎.md`, `docs/04_ACCEPTANCE_LOG_内容引擎.md`: current product and acceptance record.

---

### Task 1: Project-center selection domain

**Files:**
- Create: `content-engine/src/domain/creative-project-center.mjs`
- Create: `content-engine/src/domain/creative-project-center.d.mts`
- Create: `content-engine/tests/creative-project-center.test.mjs`

**Interfaces:**
- Consumes: `ContentProject[]`, `ProjectStage`, project-center filter IDs.
- Produces: `projectCenterFilters`, `projectsForCenterFilter(projects, filter)`, `selectedProjectIdForList(projects, currentId)`, `projectCenterAction(stage)`.

- [ ] **Step 1: Write the failing domain tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectCenterAction,
  projectsForCenterFilter,
  selectedProjectIdForList,
} from '../src/domain/creative-project-center.mjs';

const projects = [
  { id: 'planning-1', stage: 'PLANNING' },
  { id: 'research-1', stage: 'RESEARCH' },
  { id: 'visual-1', stage: 'VISUAL' },
  { id: 'completed-1', stage: 'COMPLETED' },
];

test('项目中心阶段筛选返回对应的统一项目', () => {
  assert.deepEqual(projectsForCenterFilter(projects, 'PLANNING').map((item) => item.id), ['planning-1']);
  assert.deepEqual(projectsForCenterFilter(projects, 'PLATFORM').map((item) => item.id), ['visual-1']);
  assert.deepEqual(projectsForCenterFilter(projects, 'ALL').map((item) => item.id), projects.map((item) => item.id));
});

test('当前项目不在筛选结果时选择第一项，空结果不保留旧项目', () => {
  assert.equal(selectedProjectIdForList(projects, 'research-1'), 'research-1');
  assert.equal(selectedProjectIdForList(projectsForCenterFilter(projects, 'PLANNING'), 'research-1'), 'planning-1');
  assert.equal(selectedProjectIdForList([], 'research-1'), '');
});

test('项目阶段映射为唯一下一步动作', () => {
  assert.equal(projectCenterAction('PLANNING'), '完成规划');
  assert.equal(projectCenterAction('RESEARCH'), '继续研究');
  assert.equal(projectCenterAction('MASTER_WRITING'), '继续正文');
  assert.equal(projectCenterAction('COMPLETED'), '查看项目');
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `node --test tests/creative-project-center.test.mjs`

Expected: FAIL because `src/domain/creative-project-center.mjs` does not exist.

- [ ] **Step 3: Implement the minimal domain module**

```js
export const projectCenterFilters = [
  { id: 'ALL', label: '全部' },
  { id: 'PLANNING', label: '待规划', stages: ['PLANNING'] },
  { id: 'RESEARCH', label: '研究中', stages: ['RESEARCH'] },
  { id: 'MASTER', label: '正文中', stages: ['MASTER_WRITING'] },
  { id: 'PLATFORM', label: '制作中', stages: ['PLATFORM_ADAPTATION', 'VISUAL', 'LAYOUT'] },
  { id: 'REVIEW', label: '待审核', stages: ['REVIEW'] },
  { id: 'COMPLETED', label: '已完成', stages: ['COMPLETED'] },
];

export function projectsForCenterFilter(projects, filter) {
  const stages = projectCenterFilters.find((item) => item.id === filter)?.stages;
  return stages ? projects.filter((project) => stages.includes(project.stage)) : projects;
}

export function selectedProjectIdForList(projects, currentId) {
  return projects.some((project) => project.id === currentId) ? currentId : projects[0]?.id ?? '';
}

export function projectCenterAction(stage) {
  return {
    PLANNING: '完成规划', RESEARCH: '继续研究', MASTER_WRITING: '继续正文',
    PLATFORM_ADAPTATION: '制作平台版本', VISUAL: '处理配图', LAYOUT: '继续排版',
    REVIEW: '完成审核', COMPLETED: '查看项目',
  }[stage];
}
```

The declaration file must expose exact filter and return types using `ContentProject` and `ProjectStage` imports.

- [ ] **Step 4: Run the domain tests**

Run: `node --test tests/creative-project-center.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the domain behavior**

```powershell
git add src/domain/creative-project-center.mjs src/domain/creative-project-center.d.mts tests/creative-project-center.test.mjs
git commit -m "test: define creative project list behavior"
```

### Task 2: Restore the list and detail layout

**Files:**
- Modify: `content-engine/src/workspaces/create/CreativeProjectCenter.tsx`
- Modify: `content-engine/src/styles.css`
- Modify: `content-engine/tests/creative-workspace.e2e.py`

**Interfaces:**
- Consumes: Task 1 helpers and the existing `CreativeProjectCenter` props.
- Produces: `.creative-project-list-layout`, `.creative-project-table`, `.creative-project-detail`, `.creative-project-mobile-list`, and `.creative-project-mobile-drawer` browser surfaces.

- [ ] **Step 1: Extend E2E with the approved list behavior before changing the component**

After creating and confirming the manual project, and after adding the hotspot project, navigate to the project center and assert:

```python
page.get_by_role("button", name="创作", exact=True).click()
page.locator(".creative-project-table").wait_for()
rows = page.locator(".creative-project-table tbody tr")
assert rows.count() == 2
rows.filter(has_text=HOTSPOT_TITLE).click()
page.locator(".creative-project-detail").get_by_role(
    "heading", name=HOTSPOT_TITLE, exact=True
).wait_for()
assert page.locator(".creative-project-card").count() == 0
```

At 390px assert the desktop table is hidden, compact rows exist, clicking one opens the detail drawer, and document width does not overflow.

- [ ] **Step 2: Run E2E and verify it fails on the missing list selector**

Run:

```powershell
python 'C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py' --server "npm run dev:web" --port 5173 -- python tests\creative-workspace.e2e.py
```

Expected: FAIL waiting for `.creative-project-table`.

- [ ] **Step 3: Replace project cards with selected-list state**

In `CreativeProjectCenter.tsx`:

- Import Task 1 helpers.
- Keep creation source, form fields, validation, and submit behavior unchanged.
- Add `selectedProjectId` and `mobileDetailOpen` state.
- Derive `visibleProjects` with `projectsForCenterFilter()`.
- Use an effect to call `selectedProjectIdForList()` whenever the visible list changes.
- Render a desktop table with the six approved columns.
- Make each row selectable by click, Enter, and Space, and set `aria-selected`.
- Render the selected project in one detail component used by desktop, stacked tablet layout, and mobile drawer.
- The detail primary button calls `onOpenProject(selectedProject)` and uses `projectCenterAction(selectedProject.stage)`.
- Do not render delete, edit, confirm-establishment, or Topic actions.

- [ ] **Step 4: Replace the card CSS with compact list CSS**

Implement:

- Desktop `grid-template-columns:minmax(0,1fr) 340px` at widths above 1100px.
- A bordered white table with a sticky header, 52-68px rows, selected blue inset bar, and visible focus state.
- A sticky detail panel using existing 14px radius and restrained macaron labels.
- At 1100px and below, one-column list followed by non-sticky detail.
- At 790px and below, hide the table and desktop detail; show compact row buttons and a fixed bottom drawer.
- At 390px, constrain every grid child with `min-width:0`; filters and platform labels may scroll inside their own containers only.
- Remove obsolete `.creative-project-grid`, `.creative-project-card`, `.creative-project-card-main`, `.creative-project-accent`, and card footer rules.

- [ ] **Step 5: Run E2E and targeted tests**

Run:

```powershell
node --test tests/creative-project-center.test.mjs tests/web-navigation.test.mjs
python 'C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py' --server "npm run dev:web" --port 5173 -- python tests\creative-workspace.e2e.py
```

Expected: all pass; no console errors, failed responses, paid API calls, or horizontal overflow.

- [ ] **Step 6: Commit the restored layout**

```powershell
git add src/workspaces/create/CreativeProjectCenter.tsx src/styles.css tests/creative-workspace.e2e.py
git commit -m "feat: restore creative project list layout"
```

### Task 3: Documentation and final verification

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Consumes: the completed list layout and browser evidence.
- Produces: current product, implementation, and acceptance records.

- [ ] **Step 1: Update the four documents**

Record that the project center uses the restored planning-list visual structure inside Creative, but continues using `ContentProject`. Document desktop list/detail, tablet stacking, mobile drawer, the absence of project deletion, and the fact that no old Topic flow returned.

- [ ] **Step 2: Run complete verification**

```powershell
npm test
npm run typecheck
npm run build
python 'C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py' --server "npm run dev:web" --port 5173 -- python tests\creative-workspace.e2e.py
git diff --check
```

Expected: 0 failed, all commands exit 0.

- [ ] **Step 3: Commit documentation and acceptance evidence**

```powershell
git add ../docs
git commit -m "docs: record creative project list acceptance"
```

- [ ] **Step 4: Push and verify remote main**

```powershell
git push origin main
git status --branch --short
git rev-parse HEAD
git rev-parse origin/main
```

Expected: `main -> main`, clean status, and identical local/remote commit hashes.
