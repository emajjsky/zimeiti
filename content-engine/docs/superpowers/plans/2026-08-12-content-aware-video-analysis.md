# Content-Aware Video Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-interval video frame extraction with content-aware segmented analysis while making public-link understanding tolerant of rich model output.

**Architecture:** Public-link output is normalized at the model adapter boundary. Video analysis detects local scene candidates, groups them into semantic-sized segments, asks the configured Qwen model to analyze each segment, merges segment results, filters duplicate/low-value frame candidates, then persists progress and reusable assets.

**Tech Stack:** Node.js, PostgreSQL, BullMQ, ffmpeg/ffprobe, Bailian CLI, React, TypeScript, Zod.

## Global Constraints

- Video input remains local upload only; no direct video-link ingestion.
- `VIDEO_ANALYSIS` only accepts Qwen 3.6 through 3.8 conversational multimodal models.
- No real Bailian call is executed during automated verification.
- Final keyframe count is content-driven; duration only controls segmentation.
- Existing user changes and historical data are preserved.

---

### Task 1: Public-link output adapter

**Files:**
- Modify: `server/services/content-understanding.cjs`
- Test: `tests/content-ingestion.test.mjs`

**Interfaces:**
- Consumes: raw model JSON text.
- Produces: `parseContentUnderstanding(content)` with normalized string arrays and readable errors.

- [x] Add failing tests for arrays beyond prompt recommendations and invalid field types.
- [x] Remove business-irrelevant array maxima while retaining type and item-length validation.
- [x] Convert Zod internals into a readable content-understanding error.
- [x] Run `node --test tests/content-ingestion.test.mjs`.

### Task 2: Segmentation and keyframe semantics

**Files:**
- Modify: `server/services/video-analysis.cjs`
- Test: `tests/video-analysis.test.mjs`

**Interfaces:**
- Produces: `planVideoSegments`, `mergeVideoSegmentResults`, `selectContentKeyframes`.
- Segment results use absolute timestamps after merge.

- [ ] Add failing tests for 30-minute segmentation, sparse talking-head output, dense tutorial output, overlap deduplication, and failed-segment coverage.
- [ ] Implement deterministic segment planning from scene candidates.
- [ ] Implement global narrative merge and content-event keyframe deduplication.
- [ ] Run `node --test tests/video-analysis.test.mjs`.

### Task 3: Local media preparation

**Files:**
- Modify: `server/services/video-analysis.cjs`
- Test: `tests/video-analysis.test.mjs`

**Interfaces:**
- Produces: `detectSceneChanges({ videoPath })`, `extractVideoSegment(...)`, and quality-aware frame extraction helpers.

- [ ] Add process-argument tests without invoking ffmpeg.
- [ ] Implement scene detection using ffmpeg scene scores.
- [ ] Implement temporary segment extraction and cleanup.
- [ ] Extract multiple nearby frame candidates and choose a representative nonblank frame.

### Task 4: Resumable Worker orchestration

**Files:**
- Modify: `server/worker.cjs`
- Modify: `server/routes/video-analyses.cjs`
- Create: `server/migrations/052_video_analysis_progress.sql`
- Test: `tests/video-analysis.test.mjs`

**Interfaces:**
- Persists `progress_json` and partial `result_json.segments` after each segment.
- Reuses successful segment results when the same analysis resumes.

- [ ] Add migration and route-view tests for progress data.
- [ ] Replace the single whole-video call with segment execution and checkpoint persistence.
- [ ] Merge successful segments and mark incomplete coverage without discarding useful results.
- [ ] Preserve current project-material and title-update behavior.

### Task 5: Product progress and long-video upload

**Files:**
- Modify: `src/data/webApi.ts`
- Modify: `src/workspaces/create/CreateWorkspace.tsx`
- Modify: `src/workspaces/create/ContentIngestionPanel.tsx`
- Modify: `server/index.cjs`
- Modify: `server/services/assetStorage.cjs`
- Test: `tests/video-analysis.test.mjs`
- Test: `tests/assets.test.mjs`

**Interfaces:**
- UI displays phase, completed segments, total segments, and partial coverage.
- Video uploads accept a dedicated higher limit while other asset limits remain unchanged.

- [ ] Add failing UI/source tests for progress labels and upload guidance.
- [ ] Add a video-specific upload limit and retain the existing general asset limit.
- [ ] Display parse, scene detection, segment understanding, merge, and material extraction phases.

### Task 6: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Browser-check link ingestion error rendering and video progress layout without starting a paid model call.
