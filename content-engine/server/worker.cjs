const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const config = require('./config.cjs');
const { query, transaction } = require('./db.cjs');
const { encrypt, decrypt } = require('./crypto.cjs');
const { runBailianCli } = require('./runner/bailian.cjs');
const { listAvailableSkills, plannerSkillView } = require('./agent/skillRegistry.cjs');
const { parsePlan } = require('./agent/planValidation.cjs');
const { createTextModelRunner } = require('./services/text-model.cjs');
const { buildAnalysisPrompt, buildAnalysisRepairPrompt, calculateOverallScore, decisionForScore, parseAnalysisContent } = require('./services/intelligence-analysis.cjs');
const { buildOutlinePrompt, buildOutlineRepairPrompt, parseOutlineContent } = require('./services/creative-outline.cjs');
const { DRAFT_ACTION_VERSION, buildDraftPrompt, buildDraftRepairPrompt, parseDraftContent } = require('./services/creative-draft.cjs');
const { PROJECT_RESEARCH_ACTION_VERSION, RESEARCH_PLAN_TOOL_NAME, researchPlanTool, buildResearchPlanPrompt, buildResearchPlanRepairPrompt, parseResearchPlan } = require('./services/project-research.cjs');
const { searchTavily } = require('./services/tavily.cjs');
const { clipPublicLink, readPublicArticle } = require('./services/public-web.cjs');
const { createPublishingStore } = require('./services/publishing.cjs');
const { createWechatOfficialClient } = require('./services/wechat-official.cjs');
const {
  PROJECT_RESEARCH_SOURCES_VERSION,
  dedupeSourceSnapshots,
  failedSourceSnapshot,
  manualSourceSnapshot,
  normalizeReadResult,
  normalizeSearchResults,
  recommendSourceSelection,
  researchSourceActions,
} = require('./services/project-research-sources.cjs');
const {
  SOURCE_VERIFICATION_VERSION,
  buildSourceVerificationPrompt,
  buildSourceVerificationRepairPrompt,
  mergeSourceVerificationResults,
  parseSourceVerification,
} = require('./services/source-verification.cjs');
const { SIMPLIFIED_RESEARCH_WORKFLOW_VERSION, workflowSourceActionsForProject, projectOriginalSource, sourceMatchesProject, buildResearchResult } = require('./services/simplified-research.cjs');
const { createProjectAgentStore } = require('./services/project-agent.cjs');
const { createContentDraftStore } = require('./services/content-drafts.cjs');
const { createDraftAdaptationService } = require('./services/draft-adaptation.cjs');
const { WECHAT_COPY_GENERATION_SCOPE, buildCopyPrompt, buildFinishedCopyPrompt, buildWritingPacket, parseRevisionCopyBody, parseFinishedCopyBody, copyMaxTokensForLength } = require('./services/project-copy-action.cjs');
const { createStorageDeletionService } = require('./services/storageDeletion.cjs');
const { updateCreativeProjects } = require('./services/project-planning.cjs');
const { enqueue, isFinalQueueAttempt } = require('./queue.cjs');
const { createContentIngestionStore, executeContentIngestion, contentUnderstandingTimeoutMs, readableContentTitle } = require('./services/content-ingestions.cjs');
const { createAssetStore } = require('./services/assets.cjs');
const { buildContentUnderstandingPrompt, buildContentUnderstandingOmniArgs, parseContentUnderstanding } = require('./services/content-understanding.cjs');
const { buildRichContentOmniArgs, extractOmniText } = require('./services/rich-content-understanding.cjs');
const {
  VISUAL_PLANNING_OPERATION,
  buildVisualPlanningOmniPrompt,
  visualPlanningRichContent,
  parseVisualPlanningContent,
  mergePlannedItems,
  compileVisualPlan,
} = require('./services/visual-planning.cjs');
const { readAssetText, saveRemoteImageAsset, removeAssetFile } = require('./services/assetStorage.cjs');
const {
  buildVideoAnalysisPrompt,
  buildVideoAnalysisVisionArgs,
  parseVideoAnalysis,
  extractVideoKeyframes,
  withVideoAnalysisOutputDirectory,
  probeVideoDuration,
  keyframeTargetForDuration,
  readableVideoAnalysisError,
  titleFromVideoAnalysis,
  detectSceneChanges,
  extractVideoSegment,
  planVideoSegments,
  mergeVideoSegmentResults,
} = require('./services/video-analysis.cjs');

const CONTENT_UNDERSTANDING_SCOPE = 'CONTENT_UNDERSTANDING';

function safeUploadPath(storageKey) {
  const root = path.resolve(config.uploadRoot);
  const target = path.resolve(root, String(storageKey ?? ''));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error('素材存储路径无效。');
  return target;
}

async function runContentUnderstanding({ workspaceId, document, media = [] }) {
  const policy = await query('SELECT model FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2 AND provider = $3', [workspaceId, CONTENT_UNDERSTANDING_SCOPE, 'BAILIAN_CLI']);
  if (!policy.rowCount) throw Object.assign(new Error('请先配置内容理解任务策略。'), { code: 'CONTENT_UNDERSTANDING_POLICY_REQUIRED' });
  const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
  if (!keyRow.rowCount) throw Object.assign(new Error('请先配置阿里云百炼 API Key。'), { code: 'BAILIAN_CREDENTIAL_REQUIRED' });
  const resolvedMedia = media.map((item) => ({ ...item, source: item.storageKey ? safeUploadPath(item.storageKey) : item.source })).filter((item) => item.source);
  const prompt = buildContentUnderstandingPrompt(document, resolvedMedia);
  const model = policy.rows[0].model;
  const args = buildContentUnderstandingOmniArgs({ model, system: prompt.system, message: prompt.message, media: resolvedMedia });
  const startedAt = Date.now();
  try {
    const content = extractOmniText(await runBailianCli(args, decrypt(keyRow.rows[0].encrypted_secret), contentUnderstandingTimeoutMs(resolvedMedia)));
    if (!content) throw new Error('内容理解模型没有返回可用内容。');
    const output = parseContentUnderstanding(content);
    const generatedText = [output.summary, ...output.coreViewpoints, ...output.structureOutline].filter(Boolean).join('\n\n');
    const plainText = String(document.plainText ?? '').trim() || generatedText;
    const blocks = document.blocks?.length ? document.blocks : plainText.split(/\n{2,}/).filter(Boolean).map((text, index) => ({ id: `analysis-${index + 1}`, type: 'paragraph', text, sourcePosition: index }));
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms)
      VALUES ($1, 'BAILIAN_CLI', $2, $3, 'SUCCESS', $4)`, [workspaceId, model, CONTENT_UNDERSTANDING_SCOPE, Date.now() - startedAt]);
    return {
      ...document,
      title: readableContentTitle(document.title, generatedText),
      plainText,
      blocks,
      extraction: { ...document.extraction, contentHash: createHash('sha256').update(plainText).digest('hex') },
      understanding: { scope: CONTENT_UNDERSTANDING_SCOPE, model, result: output },
    };
  } catch (error) {
    await query(`INSERT INTO api_usage_logs (workspace_id, provider, model, operation, status, duration_ms, error)
      VALUES ($1, 'BAILIAN_CLI', $2, $3, 'ERROR', $4, $5)`, [workspaceId, model, CONTENT_UNDERSTANDING_SCOPE, Date.now() - startedAt, (error instanceof Error ? error.message : '内容理解失败').slice(0, 2_000)]).catch(() => {});
    throw error;
  }
}

async function executeVideoAnalysis({ jobId, workspaceId, analysisId }) {
  const analysisResult = await query(`SELECT analysis.*, asset.storage_key, asset.title AS asset_title
    FROM video_analyses analysis
    JOIN workspace_assets asset ON asset.workspace_id = analysis.workspace_id AND asset.id = analysis.source_asset_id
    WHERE analysis.workspace_id = $1 AND analysis.id = $2`, [workspaceId, analysisId]);
  if (!analysisResult.rowCount) throw new Error('没有找到视频拉片任务。');
  const analysis = analysisResult.rows[0];
  const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
  if (!keyRow.rowCount) throw new Error('请先配置阿里云百炼 API Key。');
  const videoPath = safeUploadPath(analysis.storage_key);
  const segmentDirectory = safeUploadPath(`${workspaceId}/assets/video-analysis-${analysisId}-segments`);
  try {
    const durationSeconds = await probeVideoDuration({ videoPath });
    await query("UPDATE video_analyses SET progress_json = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, JSON.stringify({ phase: 'DETECTING_SCENES', completedSegments: 0, totalSegments: 0 })]);
    const sceneChanges = await detectSceneChanges({ videoPath });
    const plannedSegments = planVideoSegments({ durationSeconds, sceneChanges });
    const savedEntries = Array.isArray(analysis.result_json?.segmentEntries) ? analysis.result_json.segmentEntries : [];
    const entries = [];
    await fs.mkdir(segmentDirectory, { recursive: true });
    for (const [index, segment] of plannedSegments.entries()) {
      const saved = savedEntries.find((entry) => entry.segment?.id === segment.id && entry.segment.status === 'SUCCEEDED');
      if (saved) { entries.push(saved); continue; }
      const progress = { phase: 'ANALYZING_SEGMENTS', completedSegments: entries.filter((entry) => entry.segment.status === 'SUCCEEDED').length, totalSegments: plannedSegments.length, currentSegment: index + 1 };
      await query("UPDATE video_analyses SET progress_json = $3, result_json = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, JSON.stringify(progress), JSON.stringify({ segmentEntries: entries })]);
      const sourceExtension = path.extname(videoPath).toLowerCase() === '.webm' ? '.webm' : '.mp4';
      const segmentPath = path.join(segmentDirectory, `${segment.id}${sourceExtension}`);
      try {
        await extractVideoSegment({ videoPath, outputPath: segmentPath, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds });
        const prompt = buildVideoAnalysisPrompt({ title: analysis.asset_title, targetPlatform: analysis.target_platform, durationSeconds: segment.endSeconds - segment.startSeconds });
        const requestPrompt = `${prompt.system}\n\n本次只分析全片 ${segment.startSeconds}-${segment.endSeconds} 秒对应的片段。关键帧按内容事件选择，不按时间平均分配，也不要求固定数量。为每个关键帧提供稳定的 eventKey 和 0 到 1 的 valueScore。\n\n任务输入：${prompt.message}`;
        const raw = await runBailianCli(buildVideoAnalysisVisionArgs({ model: analysis.model, videoPath: segmentPath, prompt: requestPrompt }), decrypt(keyRow.rows[0].encrypted_secret), 600_000);
        entries.push({ segment: { ...segment, status: 'SUCCEEDED' }, result: parseVideoAnalysis(extractOmniText(raw)) });
      } catch (error) {
        entries.push({ segment: { ...segment, status: 'FAILED', error: readableVideoAnalysisError(error) } });
      } finally {
        await fs.rm(segmentPath, { force: true }).catch(() => undefined);
      }
      await query("UPDATE video_analyses SET result_json = $3, progress_json = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, JSON.stringify({ segmentEntries: entries }), JSON.stringify({ phase: 'ANALYZING_SEGMENTS', completedSegments: entries.filter((entry) => entry.segment.status === 'SUCCEEDED').length, totalSegments: plannedSegments.length, currentSegment: index + 1 })]);
    }
    const result = mergeVideoSegmentResults(entries, durationSeconds);
    if (!result.narrativeStructure.length) throw new Error('视频分段均未返回可用拉片结果。');
    await query("UPDATE video_analyses SET progress_json = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, JSON.stringify({ phase: 'EXTRACTING_MATERIALS', completedSegments: entries.filter((entry) => entry.segment.status === 'SUCCEEDED').length, totalSegments: plannedSegments.length })]);
    await query("UPDATE video_analyses SET status = 'EXTRACTING_FRAMES', result_json = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, JSON.stringify(result)]);
    const relativeDirectory = `${workspaceId}/assets/video-analysis-${analysisId}`;
    const outputDirectory = safeUploadPath(relativeDirectory);
    const assetIds = await withVideoAnalysisOutputDirectory(outputDirectory, async () => {
      const frames = await extractVideoKeyframes({ videoPath, outputDirectory, keyframes: result.keyframes });
      return transaction(async (client) => {
        const ids = [];
        for (const [index, frame] of frames.entries()) {
        const storageKey = `${relativeDirectory}/${frame.filename}`.replace(/\\/g, '/');
        const existing = await client.query(`SELECT id FROM workspace_assets WHERE workspace_id = $1 AND sha256 = $2 AND status <> 'DELETING'`, [workspaceId, frame.sha256]);
        let assetId = existing.rows[0]?.id;
        if (!assetId) {
          const inserted = await client.query(`INSERT INTO workspace_assets
            (workspace_id, kind, origin, title, original_filename, mime_type, size_bytes, sha256, storage_key, source_note, copyright_status, created_by)
            VALUES ($1, 'IMAGE', 'AI_GENERATED', $2, $3, 'image/jpeg', $4, $5, $6, $7, 'OWNED', $8) RETURNING id`, [workspaceId, frame.caption, frame.filename, frame.sizeBytes, frame.sha256, storageKey, `视频关键帧 ${frame.timestampSeconds}s：${frame.reason}`, analysis.created_by]);
          assetId = inserted.rows[0].id;
        } else {
          await fs.rm(frame.outputPath, { force: true }).catch(() => undefined);
        }
        ids.push(assetId);
        await client.query(`INSERT INTO project_asset_links (workspace_id, project_id, asset_id, role, scope, title, notes, platforms_json, sort_order)
          VALUES ($1, $2, $3, 'VISUAL', 'PROJECT', $4, $5, $6, $7)
          ON CONFLICT (workspace_id, project_id, asset_id) DO UPDATE SET notes = excluded.notes, sort_order = excluded.sort_order, updated_at = now()`, [workspaceId, analysis.project_id, assetId, frame.caption, frame.reason, JSON.stringify([analysis.target_platform]), index]);
      }
      const analysisText = [result.summary, ...result.narrativeStructure.map((segment) => `${segment.startSeconds}-${segment.endSeconds}s ${segment.segment}：${segment.content}；画面：${segment.visual}`), ...result.reusableInsights].join('\n\n');
      await client.query(`INSERT INTO project_inputs (workspace_id, project_id, kind, title, body, scope, platforms_json)
        VALUES ($1, $2, 'NOTE', '视频拉片结果', $3, 'RESEARCH', $4)`, [workspaceId, analysis.project_id, analysisText.slice(0, 50_000), JSON.stringify([analysis.target_platform])]);
      await client.query("UPDATE video_analyses SET status = 'SUCCEEDED', result_json = $3, keyframe_asset_ids = $4, progress_json = $5, error = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, JSON.stringify(result), JSON.stringify(ids), JSON.stringify({ phase: 'SUCCEEDED', completedSegments: entries.filter((entry) => entry.segment.status === 'SUCCEEDED').length, totalSegments: plannedSegments.length })]);
      const derivedTitle = titleFromVideoAnalysis(result.summary, analysis.asset_title);
      await updateCreativeProjects(client, workspaceId, (state) => ({
        ...state,
        projects: state.projects.map((project) => {
          if (project.id !== analysis.project_id || !/^(?:[a-f0-9]{32,64}|视频拉片项目)$/i.test(String(project.title ?? ''))) return project;
          return {
            ...project,
            title: derivedTitle,
            planning: { ...project.planning, title: derivedTitle },
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      await client.query(`UPDATE content_drafts SET title = $3, updated_at = now()
        WHERE workspace_id = $1 AND project_id = $2 AND title ~* '^(?:[a-f0-9]{32,64}|视频拉片项目)$'`, [workspaceId, analysis.project_id, derivedTitle]);
        return ids;
      });
    });
    await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ analysisId, keyframeAssetIds: assetIds }), jobId]);
    await fs.rm(segmentDirectory, { recursive: true, force: true }).catch(() => undefined);
    return { analysisId, keyframeAssetIds: assetIds };
  } catch (error) {
    const message = readableVideoAnalysisError(error);
    await query("UPDATE video_analyses SET status = 'FAILED', error = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, analysisId, message.slice(0, 2_000)]).catch(() => undefined);
    throw new Error(message, { cause: error });
  }
}

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const textRunner = createTextModelRunner();
const projectAgentStore = createProjectAgentStore({ query, transaction });
const draftStore = createContentDraftStore({ query, transaction });
const draftAdaptationService = createDraftAdaptationService({
  query,
  transaction,
  draftStore,
  runTextTask: async ({ workspaceId, route, system, message }) => {
    const connectionInput = await textConnectionInput(workspaceId, route);
    return textRunner.runText({ provider: route.provider, model: route.model, system, message, ...connectionInput });
  },
});
const storageDeletion = createStorageDeletionService({ query, transaction, uploadRoot: config.uploadRoot });
const contentIngestionStore = createContentIngestionStore({ query, transaction });
const assetStore = createAssetStore({ query, transaction, removeStoredFile: (storageKey) => removeAssetFile(config.uploadRoot, storageKey) });

async function importIngestionRemoteMedia({ workspaceId, ingestionId, media, document }) {
  const stored = await saveRemoteImageAsset(config.uploadRoot, workspaceId, media.resolvedUrl || media.sourceUrl, { fallbackUrl: media.sourceUrl });
  const creatorId = await contentIngestionStore.getCreator(workspaceId, ingestionId);
  const title = String(media.caption || media.altText || document.title || '链接正文配图').trim().slice(0, 200) || '链接正文配图';
  const created = await assetStore.createFromStoredFile(workspaceId, creatorId, stored, {
    origin: 'WEB_IMPORT',
    title,
    sourceUrl: stored.sourceUrl,
    sourceNote: `由链接内容读取任务 ${ingestionId} 自动导入`,
    copyrightStatus: 'PENDING',
  });
  return { assetId: created.asset.id };
}
const publicationMetricsStore = createPublishingStore({ query, transaction, encryptSecret: encrypt, decryptSecret: decrypt, officialDraftClient: createWechatOfficialClient(), clipPublicLink });
const PUBLICATION_METRICS_INTERVAL_MS = 30 * 60 * 1000;
let metricsRefreshRunning = false;
async function refreshAllPublicationMetrics() {
  if (metricsRefreshRunning) return;
  metricsRefreshRunning = true;
  try {
    const workspaces = await query(`SELECT DISTINCT workspace_id FROM publications WHERE status = 'PUBLISHED' AND url <> ''`);
    for (const row of workspaces.rows) {
      try {
        const result = await publicationMetricsStore.syncMetricsForAll(row.workspace_id, null, {});
        console.log(`[PUBLICATION_METRICS] workspace=${row.workspace_id} synced=${result.syncedCount} failed=${result.failedCount}`);
      } catch (error) { console.error(`[PUBLICATION_METRICS] workspace=${row.workspace_id} failed`, error); }
    }
  } finally { metricsRefreshRunning = false; }
}

async function processJob(queueJob) {
  const { jobId, workspaceId, payload } = queueJob.data;
  const claimed = await query(`WITH claimable AS (
      SELECT id, status AS previous_status FROM jobs
      WHERE id = $1 AND workspace_id = $2 AND status IN ('PENDING', 'RUNNING')
      FOR UPDATE
    )
    UPDATE jobs j SET status = 'RUNNING', started_at = COALESCE(j.started_at, now()), completed_at = NULL
    FROM claimable c WHERE j.id = c.id
    RETURNING j.id, c.previous_status`, [jobId, workspaceId]);
  if (!claimed.rowCount) return { jobId, skipped: true };
  if (claimed.rows[0].previous_status === 'RUNNING' && payload.runId) {
    await query("UPDATE generation_runs SET status = 'QUEUED', error = NULL, started_at = NULL, completed_at = NULL WHERE id = $1 AND workspace_id = $2 AND status IN ('RUNNING', 'FAILED')", [payload.runId, workspaceId]);
  }
  if (claimed.rows[0].previous_status === 'RUNNING' && payload.visualPlanningRunId) {
    await query("UPDATE visual_planning_runs SET status = 'QUEUED', error = NULL, started_at = NULL, completed_at = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('RUNNING', 'FAILED')", [payload.visualPlanningRunId, workspaceId]);
  }
  try {
    if (queueJob.name === 'STORAGE_DELETE') return await storageDeletion.executeById({ workspaceId, deletionJobId: payload.deletionJobId, queueJobId: jobId });
    if (queueJob.name === 'AGENT_PLAN') return await generateAgentPlan({ jobId, workspaceId, planId: payload.planId });
    if (queueJob.name === 'INTELLIGENCE_ANALYSIS') return await generateIntelligenceAnalysis({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_RESEARCH_PLAN') return await generateProjectResearchPlan({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_RESEARCH_WORKFLOW') return await generateSimplifiedResearchWorkflow({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_RESEARCH_SOURCES') return await generateProjectResearchSources({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'SOURCE_VERIFICATION') return await generateSourceVerification({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'CREATIVE_OUTLINE') return await generateCreativeOutline({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'CREATIVE_DRAFT') return await generateCreativeDraft({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_COPY_ACTION') return await generateProjectCopyAction({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'DRAFT_ADAPTATION') return await draftAdaptationService.execute({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'VIDEO_ANALYSIS') return await executeVideoAnalysis({ jobId, workspaceId, analysisId: payload.analysisId });
    if (queueJob.name === 'VISUAL_PLANNING') return await executeVisualPlanning({ jobId, workspaceId, runId: payload.visualPlanningRunId });
    if (queueJob.name === 'CONTENT_INGESTION') {
      await executeContentIngestion({ query, store: contentIngestionStore, workspaceId, ingestionId: payload.ingestionId, readPublicArticle, readAssetText, uploadRoot: config.uploadRoot, runContentUnderstanding, importRemoteMedia: importIngestionRemoteMedia });
      await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3 AND status <> $4', ['SUCCEEDED', JSON.stringify({ ingestionId: payload.ingestionId }), jobId, 'CANCELLED']);
      return { jobId, ingestionId: payload.ingestionId };
    }
    if (queueJob.name !== 'BAILIAN_TEXT') throw new Error(`暂不支持的任务类型：${queueJob.name}`);
    const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
    if (!keyRow.rowCount) throw new Error('工作空间未配置百炼 Key。');
    const output = await runBailianCli(['text', 'chat', '--model', payload.model, '--system', payload.system, '--message', payload.message, '--output', 'json'], decrypt(keyRow.rows[0].encrypted_secret));
    await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ output }), jobId]);
    return { jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务失败。';
    if (isFinalQueueAttempt(queueJob)) {
      await transaction(async (client) => {
        if (payload.runId) await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3 AND status IN ('QUEUED', 'RUNNING', 'FAILED')", [payload.runId, message.slice(0, 2_000), workspaceId]);
        if (payload.visualPlanningRunId) await client.query("UPDATE visual_planning_runs SET status = 'FAILED', error = $2, completed_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $3 AND status IN ('QUEUED', 'RUNNING')", [payload.visualPlanningRunId, message.slice(0, 2_000), workspaceId]);
        if (queueJob.name === 'AGENT_PLAN' && payload.planId) await client.query('UPDATE agent_plans SET status = $1, error = $2, updated_at = now() WHERE id = $3 AND workspace_id = $4', ['FAILED', message.slice(0, 2_000), payload.planId, workspaceId]);
        await client.query("UPDATE jobs SET status = $1, error = $2, completed_at = now() WHERE id = $3 AND status <> 'CANCELLED'", ['FAILED', message.slice(0, 2_000), jobId]);
      });
    }
    throw error;
  }
}

async function executeVisualPlanning({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  const result = await query(`SELECT run.*, draft.title AS draft_title, draft.body AS draft_body, project.project_json
    FROM visual_planning_runs run
    JOIN content_drafts draft ON draft.workspace_id = run.workspace_id AND draft.id = run.draft_id
    JOIN content_projects project ON project.workspace_id = run.workspace_id AND project.project_id = run.project_id
    WHERE run.workspace_id = $1 AND run.id = $2`, [workspaceId, runId]);
  if (!result.rowCount) throw new Error('没有找到配图策划任务。');
  const run = result.rows[0];
  await query("UPDATE visual_planning_runs SET status = 'RUNNING', started_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, runId]);
  try {
    const key = await query("SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = 'BAILIAN'", [workspaceId]);
    if (!key.rowCount) throw new Error('请先配置阿里云百炼 API Key。');
    const input = run.input_json;
    const assets = await query(`SELECT asset.kind, asset.title, asset.origin, asset.storage_key
      FROM project_asset_links link JOIN workspace_assets asset ON asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
      WHERE link.workspace_id = $1 AND link.project_id = $2 AND asset.status = 'ACTIVE' AND asset.kind IN ('IMAGE','VIDEO','AUDIO')
      ORDER BY link.sort_order, asset.updated_at DESC`, [workspaceId, run.project_id]);
    const draft = { title: run.draft_title, body: run.draft_body };
    const prompt = buildVisualPlanningOmniPrompt({
      project: { ...run.project_json, versionTitle: draft.title, versionBody: draft.body },
      platform: input.platform,
      quantityMode: input.quantityMode,
      bodyItemCount: input.bodyItemCount,
      styleProfile: input.styleProfile,
      request: input.request,
      currentItem: input.currentItem,
    });
    const richContent = visualPlanningRichContent({
      draft,
      assets: assets.rows.map((asset) => ({ ...asset, source: safeUploadPath(asset.storage_key) })),
    });
    const raw = await runBailianCli(
      buildRichContentOmniArgs({ model: run.model, system: prompt.system, message: prompt.message, content: richContent, maxTokens: 16_000 }),
      decrypt(key.rows[0].encrypted_secret),
      richContent.media.some((item) => item.kind === 'VIDEO') ? 600_000 : 240_000,
    );
    const content = extractOmniText(raw);
    if (!content) throw new Error('配图策划模型没有返回可用内容。');
    const parsed = parseVisualPlanningContent(content, {
      platform: input.platform,
      quantityMode: input.quantityMode,
      bodyItemCount: input.bodyItemCount,
      singleItem: Boolean(input.currentItemId),
      expectedRole: input.currentItem?.role,
    });
    const merged = mergePlannedItems({
      platform: input.platform,
      plannedItems: parsed.items,
      currentPlan: input.currentPlan,
      currentItemId: input.currentItemId,
      keepAssignedAssets: input.keepAssignedAssets,
    });
    const plan = await compileVisualPlan({ platform: input.platform, title: draft.title, body: draft.body, items: merged, styleProfile: input.styleProfile });
    const output = { plan, bodyItemCount: plan.filter((item) => item.role === 'BODY').length, quantityMode: input.quantityMode, strategy: parsed.strategy };
    await transaction(async (client) => {
      await client.query("UPDATE visual_planning_runs SET status = 'SUCCEEDED', result_json = $3, error = NULL, completed_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, runId, JSON.stringify(output)]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ visualPlanningRunId: runId })]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms)
        VALUES ($1,$2,$3,$4,$5,'SUCCESS',$6)`, [workspaceId, jobId, run.provider, run.model, VISUAL_PLANNING_OPERATION, Date.now() - startedAt]);
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : '配图策划失败。';
    await transaction(async (client) => {
      await client.query("UPDATE visual_planning_runs SET status = 'FAILED', error = $3, completed_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2", [workspaceId, runId, message.slice(0, 2_000)]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, error)
        VALUES ($1,$2,$3,$4,$5,'ERROR',$6,$7)`, [workspaceId, jobId, run.provider, run.model, VISUAL_PLANNING_OPERATION, Date.now() - startedAt, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function updateSimplifiedResearchPhase(workspaceId, runId, phase, progress) {
  await query(`UPDATE generation_runs
    SET source_snapshot_json = jsonb_set(source_snapshot_json, '{process}', $3::jsonb, true)
    WHERE workspace_id = $1 AND id = $2`, [workspaceId, runId, JSON.stringify({ phase, progress })]);
}

async function runWorkflowResearchPlan(workspaceId, snapshot, route) {
  const connectionInput = await textConnectionInput(workspaceId, route);
  const prompt = buildResearchPlanPrompt(snapshot);
  const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, tools: [researchPlanTool], requiredToolName: RESEARCH_PLAN_TOOL_NAME, timeoutMs: 300_000, ...connectionInput });
  try {
    return { output: parseResearchPlan(first.content), inputTokens: first.inputTokens ?? 0, outputTokens: first.outputTokens ?? 0 };
  } catch (error) {
    const validationError = error instanceof Error ? error.message : '研究计划输出不符合 JSON 契约。';
    const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildResearchPlanRepairPrompt(prompt.system, validationError), message: first.content, tools: [researchPlanTool], requiredToolName: RESEARCH_PLAN_TOOL_NAME, timeoutMs: 300_000, ...connectionInput });
    return {
      output: parseResearchPlan(repaired.content),
      inputTokens: (first.inputTokens ?? 0) + (repaired.inputTokens ?? 0),
      outputTokens: (first.outputTokens ?? 0) + (repaired.outputTokens ?? 0),
    };
  }
}

async function captureWorkflowSources(workspaceId, plan, project) {
  let actions;
  try { actions = researchSourceActions({ ...plan, nextActions: workflowSourceActionsForProject(plan, project) }).actions; }
  catch { return []; }
  const captured = [];
  for (const action of actions) {
    if (action.action === 'ASK_USER') { captured.push(manualSourceSnapshot(action)); continue; }
    try {
      if (action.action === 'SEARCH_WEB') {
        const searched = await searchTavily(workspaceId, { query: action.target, category: '其他', domains: [] });
        const results = normalizeSearchResults(action, searched.filter((item) => sourceMatchesProject(item, project, plan)));
        captured.push(...(results.length ? results : [failedSourceSnapshot(action, new Error('网页搜索没有返回可保存的结果。'))]));
      } else if (action.action === 'READ_LINK') {
        const original = projectOriginalSource(project);
        const source = original?.url === action.target ? original : await clipPublicLink(action.target);
        captured.push(normalizeReadResult(action, source));
      }
    } catch (error) {
      captured.push(failedSourceSnapshot(action, error));
    }
  }
  return dedupeSourceSnapshots(captured).map((source, index) => ({ ...source, id: `source-${index + 1}` }));
}

async function runWorkflowVerificationAttempt(workspaceId, plan, selectedSources, route, template) {
  const connectionInput = await textConnectionInput(workspaceId, route);
  const prompt = buildSourceVerificationPrompt({ claims: plan.claims, sources: selectedSources, template });
  const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
  try {
    return { output: parseSourceVerification(first.content, { claims: plan.claims, sources: selectedSources }), inputTokens: first.inputTokens ?? 0, outputTokens: first.outputTokens ?? 0 };
  } catch (error) {
    const validationError = error instanceof Error ? error.message : '事实核验输出不符合 JSON 契约。';
    const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildSourceVerificationRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
    const output = parseSourceVerification(repaired.content, { claims: plan.claims, sources: selectedSources, recoverInvalidClaims: true });
    const recoveredClaims = output.claims.filter((claim) => claim.evidenceValidationFailed).length;
    return {
      output,
      inputTokens: (first.inputTokens ?? 0) + (repaired.inputTokens ?? 0),
      outputTokens: (first.outputTokens ?? 0) + (repaired.outputTokens ?? 0),
      recoveredClaims,
    };
  }
}

async function verifyWorkflowClaims(workspaceId, plan, sources, route, template) {
  const selectedIds = new Set(recommendSourceSelection(sources, 8));
  const selectedSources = sources.filter((source) => selectedIds.has(source.id) && String(source.summary ?? '').trim());
  if (!route || !selectedSources.length || !Array.isArray(plan.claims) || !plan.claims.length) return null;
  try {
    const verified = await runWorkflowVerificationAttempt(workspaceId, plan, selectedSources, route, template);
    return {
      ...verified,
      recovered: Boolean(verified.recoveredClaims),
      ...(verified.recoveredClaims ? { warning: `${verified.recoveredClaims} 条主张的证据引用无效，已隔离为待补充核验。` } : {}),
    };
  } catch (primaryError) {
    const results = [];
    const failures = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for (const source of selectedSources) {
      try {
        const verified = await runWorkflowVerificationAttempt(workspaceId, plan, [source], route, template);
        results.push(verified.output);
        inputTokens += verified.inputTokens;
        outputTokens += verified.outputTokens;
      } catch (error) {
        failures.push(`${source.title}：${error instanceof Error ? error.message : '核验失败'}`);
      }
    }
    if (!results.length) throw primaryError;
    return {
      output: mergeSourceVerificationResults({ claims: plan.claims, results }),
      inputTokens,
      outputTokens,
      recovered: true,
      warning: failures.length ? `${failures.length} 个来源内容不足，已忽略并保留其他来源的核验结果。` : '已改用逐来源核验并合并结果。',
    };
  }
}

async function generateSimplifiedResearchWorkflow({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const runResult = await query(`SELECT id, source_snapshot_json, input_json
      FROM generation_runs
      WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'QUEUED'`, [runId, workspaceId, SIMPLIFIED_RESEARCH_WORKFLOW_VERSION]);
    if (!runResult.rowCount) throw new Error('研究任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const snapshot = runResult.rows[0].source_snapshot_json;
    const input = runResult.rows[0].input_json;
    route = input.route;

    await updateSimplifiedResearchPhase(workspaceId, runId, 'PLANNING', 15);
    const planned = await runWorkflowResearchPlan(workspaceId, snapshot, route);
    inputTokens += planned.inputTokens;
    outputTokens += planned.outputTokens;

    await updateSimplifiedResearchPhase(workspaceId, runId, 'SOURCES', 45);
    const sources = await captureWorkflowSources(workspaceId, planned.output, snapshot.project);

    await updateSimplifiedResearchPhase(workspaceId, runId, 'VERIFYING', 75);
    let verification = null;
    let verificationStatus = 'FAILED';
    let verificationMessage = '';
    try {
      verification = await verifyWorkflowClaims(workspaceId, planned.output, sources, input.verificationRoute, input.verificationTemplate);
      inputTokens += verification?.inputTokens ?? 0;
      outputTokens += verification?.outputTokens ?? 0;
      verificationStatus = verification?.recovered ? 'PARTIAL' : verification ? 'COMPLETE' : 'FAILED';
      verificationMessage = verification?.warning ?? '';
    } catch (error) {
      verification = null;
      verificationMessage = error instanceof Error ? `现有来源未能完成直接证据核验：${error.message}` : '现有来源未能完成直接证据核验。';
      console.warn(`[PROJECT_RESEARCH_WORKFLOW] verification failed for run ${runId}: ${verificationMessage}`);
    }
    const result = buildResearchResult({
      plan: planned.output,
      sources,
      verification: verification?.output ?? null,
      materials: snapshot.materials,
      verificationStatus,
      verificationMessage,
    });

    const saved = await transaction(async (client) => {
      const activeRun = await client.query("SELECT id FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND status = 'RUNNING' FOR UPDATE", [runId, workspaceId]);
      if (!activeRun.rowCount) throw new Error('研究任务已取消或中断。');
      const artifact = await projectAgentStore.createArtifact(client, {
        workspaceId,
        projectId: snapshot.projectId,
        type: 'RESEARCH_RESULT',
        stage: 'RESEARCH',
        status: 'CANDIDATE',
        actionRunId: runId,
        title: '研究结果',
        metadata: { action: 'PROJECT_RESEARCH_WORKFLOW', payload: result },
      });
      const researchResult = await client.query(`INSERT INTO project_research_results
        (workspace_id, project_id, generation_run_id, artifact_id, output_json)
        VALUES ($1, $2, $3, $4, $5) RETURNING id`, [workspaceId, snapshot.projectId, runId, artifact.id, JSON.stringify(result)]);
      const message = await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
        VALUES ($1, $2, $3, 'ASSISTANT', $4, 'RESEARCH', 'ARTIFACT', $5, $6) RETURNING id`, [
        workspaceId, snapshot.projectId, runId, result.summary, JSON.stringify([artifact.id]), JSON.stringify({ action: 'PROJECT_RESEARCH_WORKFLOW', phase: 'COMPLETE', progress: 100 }),
      ]);
      await client.query('UPDATE project_artifacts SET created_by_message_id = $1 WHERE id = $2 AND workspace_id = $3', [message.rows[0].id, artifact.id, workspaceId]);
      await projectAgentStore.upsertStageSummary(client, { workspaceId, projectId: snapshot.projectId, stage: 'RESEARCH', summary: result.summary, throughMessageId: message.rows[0].id });
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, source_snapshot_json = jsonb_set(source_snapshot_json, '{process}', $4::jsonb, true), completed_at = now() WHERE id = $1", [runId, JSON.stringify(result), JSON.stringify({ inputTokens, outputTokens }), JSON.stringify({ phase: 'COMPLETE', progress: 100 })]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ artifactId: artifact.id, researchResultId: researchResult.rows[0].id })]);
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'PROJECT_RESEARCH_WORKFLOW', 'SUCCESS', $5, $6, $7)`, [workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens || null, outputTokens || null]);
      return { artifactId: artifact.id, researchResultId: researchResult.rows[0].id };
    });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : '研究任务失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'PROJECT_RESEARCH_WORKFLOW', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens || null, outputTokens || null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function generateProjectResearchSources({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  try {
    const runResult = await query(`SELECT id, source_snapshot_json
      FROM generation_runs
      WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'QUEUED'`, [
      runId,
      workspaceId,
      PROJECT_RESEARCH_SOURCES_VERSION,
    ]);
    if (!runResult.rowCount) throw new Error('研究来源任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const snapshot = runResult.rows[0].source_snapshot_json;
    const captured = [];
    for (const action of Array.isArray(snapshot.actions) ? snapshot.actions : []) {
      if (action.action === 'ASK_USER') {
        captured.push(manualSourceSnapshot(action));
        continue;
      }
      try {
        if (action.action === 'SEARCH_WEB') {
          const results = normalizeSearchResults(action, await searchTavily(workspaceId, { query: action.target, category: '其它', domains: [] }));
          if (results.length) captured.push(...results);
          else captured.push(failedSourceSnapshot(action, new Error('网页搜索没有返回可保存的结果。')));
        } else if (action.action === 'READ_LINK') {
          captured.push(normalizeReadResult(action, await clipPublicLink(action.target)));
        }
      } catch (error) {
        captured.push(failedSourceSnapshot(action, error));
      }
    }
    const sources = dedupeSourceSnapshots(captured);
    const counts = {
      captured: sources.filter((item) => item.status === 'CAPTURED').length,
      needsUser: sources.filter((item) => item.status === 'NEEDS_USER').length,
      failed: sources.filter((item) => item.status === 'FAILED').length,
    };
    const automaticCount = Number(snapshot.counts?.automatic ?? 0);
    const allAutomaticFailed = automaticCount > 0 && counts.captured === 0 && counts.failed >= automaticCount;
    const runStatus = allAutomaticFailed ? 'FAILED' : 'SUCCEEDED';
    const errorMessage = allAutomaticFailed ? '所有自动来源动作均执行失败，请查看来源结果并调整研究计划。' : null;
    const summary = counts.captured
      ? `已保存 ${counts.captured} 条来源，${counts.needsUser} 项需要补充，${counts.failed} 项失败。`
      : `${counts.needsUser} 项需要补充，${counts.failed} 项自动动作失败。`;

    const saved = await transaction(async (client) => {
      const sourceRun = await client.query(`INSERT INTO project_research_source_runs
        (workspace_id, project_id, research_plan_id, generation_run_id, summary_json)
        VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
        workspaceId,
        snapshot.projectId,
        snapshot.planId,
        runId,
        JSON.stringify({ counts, summary, verified: false }),
      ]);
      const savedSources = [];
      for (const source of sources) {
        const inserted = await client.query(`INSERT INTO project_research_sources
          (workspace_id, project_id, source_run_id, action_index, action, purpose, target, status,
           title, url, source_name, summary, metadata_json, selected, error)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14)
          RETURNING id, retrieved_at`, [
          workspaceId,
          snapshot.projectId,
          sourceRun.rows[0].id,
          source.actionIndex,
          source.action,
          source.purpose,
          source.target,
          source.status,
          source.title,
          source.url,
          source.source,
          source.summary,
          JSON.stringify(source.metadata ?? {}),
          source.error,
        ]);
        savedSources.push({ ...source, id: inserted.rows[0].id, selected: false, retrievedAt: inserted.rows[0].retrieved_at });
      }
      const recommendedIds = recommendSourceSelection(savedSources);
      if (recommendedIds.length) await client.query('UPDATE project_research_sources SET selected = true WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [workspaceId, recommendedIds]);
      const recommended = new Set(recommendedIds);
      const sourcesWithSelection = savedSources.map((source) => ({ ...source, selected: recommended.has(source.id) }));
      const payload = {
        title: '研究来源',
        summary,
        notice: '来源已保存，尚未完成事实核验。',
        verified: false,
        counts,
        sources: sourcesWithSelection,
      };
      const artifact = await projectAgentStore.createArtifact(client, {
        workspaceId,
        projectId: snapshot.projectId,
        type: 'RESEARCH_SOURCES',
        stage: 'RESEARCH',
        status: 'CANDIDATE',
        actionRunId: runId,
        title: '研究来源',
        metadata: { action: 'PROJECT_RESEARCH_SOURCES', payload },
      });
      await client.query('UPDATE project_research_source_runs SET artifact_id = $1 WHERE id = $2', [artifact.id, sourceRun.rows[0].id]);
      const message = await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
        VALUES ($1, $2, $3, 'ASSISTANT', $4, 'RESEARCH', 'ARTIFACT', $5, $6) RETURNING id`, [
        workspaceId,
        snapshot.projectId,
        runId,
        summary,
        JSON.stringify([artifact.id]),
        JSON.stringify({ action: 'PROJECT_RESEARCH_SOURCES', status: runStatus, verified: false }),
      ]);
      await client.query('UPDATE project_artifacts SET created_by_message_id = $1 WHERE id = $2 AND workspace_id = $3', [message.rows[0].id, artifact.id, workspaceId]);
      await client.query(`UPDATE generation_runs
        SET status = $2, output_json = $3, error = $4, completed_at = now()
        WHERE id = $1`, [runId, runStatus, JSON.stringify(payload), errorMessage]);
      await client.query(`UPDATE jobs SET status = $2, result_json = $3, error = $4, completed_at = now()
        WHERE id = $1`, [jobId, runStatus, JSON.stringify({ artifactId: artifact.id, sourceRunId: sourceRun.rows[0].id }), errorMessage]);
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, error)
        VALUES ($1, $2, $3, NULL, 'SOURCE_DISCOVERY', $4, $5, $6)`, [
        workspaceId,
        jobId,
        snapshot.counts?.search ? 'TAVILY' : 'PUBLIC_WEB',
        runStatus === 'SUCCEEDED' ? 'SUCCESS' : 'FAILED',
        Date.now() - startedAt,
        errorMessage,
      ]);
      return { artifactId: artifact.id, sourceRunId: sourceRun.rows[0].id, status: runStatus };
    });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : '研究来源任务失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, error)
        VALUES ($1, $2, 'UNKNOWN', NULL, 'SOURCE_DISCOVERY', 'FAILED', $3, $4)`, [workspaceId, jobId, Date.now() - startedAt, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function generateSourceVerification({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens;
  let outputTokens;
  try {
    const runResult = await query(`SELECT id, source_snapshot_json, input_json FROM generation_runs
      WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = 'QUEUED'`, [runId, workspaceId, SOURCE_VERIFICATION_VERSION]);
    if (!runResult.rowCount) throw new Error('事实核验任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const snapshot = runResult.rows[0].source_snapshot_json;
    route = runResult.rows[0].input_json.route;
    const connectionInput = await textConnectionInput(workspaceId, route);
    const prompt = buildSourceVerificationPrompt({ claims: snapshot.claims, sources: snapshot.sources, template: runResult.rows[0].input_json.template?.body });
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseSourceVerification(first.content, { claims: snapshot.claims, sources: snapshot.sources }); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合事实核验 JSON 契约。';
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildSourceVerificationRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
      inputTokens = (inputTokens ?? 0) + (repaired.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (repaired.outputTokens ?? 0);
      output = parseSourceVerification(repaired.content, { claims: snapshot.claims, sources: snapshot.sources });
    }
    const payload = { title: '事实核验结论', ...output, sourceCount: snapshot.sources.length, confirmed: false };
    const saved = await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(payload), JSON.stringify({ inputTokens, outputTokens })]);
      const artifact = await projectAgentStore.createArtifact(client, {
        workspaceId,
        projectId: snapshot.projectId,
        type: 'RESEARCH_VERIFICATION',
        stage: 'RESEARCH',
        status: 'CANDIDATE',
        actionRunId: runId,
        title: '事实核验结论',
        metadata: { action: 'SOURCE_VERIFICATION', payload },
      });
      const verification = await client.query(`INSERT INTO project_source_verifications
        (workspace_id, project_id, source_run_id, generation_run_id, artifact_id, output_json)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [workspaceId, snapshot.projectId, snapshot.sourceRunId, runId, artifact.id, JSON.stringify(payload)]);
      const message = await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
        VALUES ($1, $2, $3, 'ASSISTANT', $4, 'RESEARCH', 'ARTIFACT', $5, $6) RETURNING id`, [
        workspaceId,
        snapshot.projectId,
        runId,
        output.summary,
        JSON.stringify([artifact.id]),
        JSON.stringify({ action: 'SOURCE_VERIFICATION', model: route.model, status: 'CANDIDATE' }),
      ]);
      await client.query('UPDATE project_artifacts SET created_by_message_id = $1 WHERE id = $2 AND workspace_id = $3', [message.rows[0].id, artifact.id, workspaceId]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ artifactId: artifact.id, verificationId: verification.rows[0].id })]);
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'SOURCE_VERIFICATION', 'SUCCESS', $5, $6, $7)`, [workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null]);
      return { artifactId: artifact.id, verificationId: verification.rows[0].id };
    });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : '事实核验失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'SOURCE_VERIFICATION', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function generateProjectResearchPlan({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens;
  let outputTokens;
  try {
    const runResult = await query('SELECT id, source_snapshot_json, input_json FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = \'QUEUED\'', [runId, workspaceId, PROJECT_RESEARCH_ACTION_VERSION]);
    if (!runResult.rowCount) throw new Error('研究计划当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const snapshot = runResult.rows[0].source_snapshot_json;
    route = runResult.rows[0].input_json.route;
    const connectionInput = await textConnectionInput(workspaceId, route);
    const prompt = buildResearchPlanPrompt(snapshot);
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, tools: [researchPlanTool], requiredToolName: RESEARCH_PLAN_TOOL_NAME, timeoutMs: 300_000, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseResearchPlan(first.content); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合研究计划 JSON 契约。';
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildResearchPlanRepairPrompt(prompt.system, validationError), message: first.content, tools: [researchPlanTool], requiredToolName: RESEARCH_PLAN_TOOL_NAME, timeoutMs: 300_000, ...connectionInput });
      inputTokens = (inputTokens ?? 0) + (repaired.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (repaired.outputTokens ?? 0);
      output = parseResearchPlan(repaired.content);
    }
    const saved = await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(output), JSON.stringify({ inputTokens, outputTokens })]);
      const artifact = await projectAgentStore.createArtifact(client, {
        workspaceId,
        projectId: snapshot.projectId,
        type: 'RESEARCH_PLAN',
        stage: 'RESEARCH',
        status: 'CANDIDATE',
        actionRunId: runId,
        title: output.title,
      });
      const plan = await client.query('INSERT INTO project_research_plans (workspace_id, project_id, generation_run_id, artifact_id, output_json) VALUES ($1, $2, $3, $4, $5) RETURNING id', [workspaceId, snapshot.projectId, runId, artifact.id, JSON.stringify(output)]);
      const message = await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
        VALUES ($1, $2, $3, 'ASSISTANT', $4, 'RESEARCH', 'ARTIFACT', $5, $6) RETURNING id`, [
        workspaceId,
        snapshot.projectId,
        runId,
        output.summary,
        JSON.stringify([artifact.id]),
        JSON.stringify({ model: route.model, action: 'PROJECT_RESEARCH_PLAN' }),
      ]);
      await client.query('UPDATE project_artifacts SET created_by_message_id = $1 WHERE workspace_id = $2 AND project_id = $3 AND id = $4', [message.rows[0].id, workspaceId, snapshot.projectId, artifact.id]);
      await projectAgentStore.upsertStageSummary(client, {
        workspaceId,
        projectId: snapshot.projectId,
        stage: 'RESEARCH',
        summary: output.summary,
        throughMessageId: message.rows[0].id,
      });
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ planId: plan.rows[0].id, artifactId: artifact.id })]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'PROJECT_RESEARCH', 'SUCCESS', $5, $6, $7)`, [workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null]);
      return { ...plan.rows[0], artifactId: artifact.id };
    });
    return { planId: saved.id, artifactId: saved.artifactId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '研究计划生成失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'PROJECT_RESEARCH', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function textConnectionInput(workspaceId, route) {
  if (route.provider === 'BAILIAN_CLI') {
    const credential = await query("SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = 'BAILIAN' AND status = 'READY'", [workspaceId]);
    if (!credential.rowCount) throw new Error('百炼 Key 当前不可用。');
    return { apiKey: decrypt(credential.rows[0].encrypted_secret) };
  }
  const external = await query("SELECT base_url, encrypted_secret FROM model_connections WHERE id = $1 AND workspace_id = $2 AND status = 'READY'", [route.connectionId, workspaceId]);
  if (!external.rowCount) throw new Error('外部 API 连接当前不可用。');
  return { connection: { baseUrl: external.rows[0].base_url, apiKey: decrypt(external.rows[0].encrypted_secret) } };
}

async function generateIntelligenceAnalysis({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens;
  let outputTokens;
  try {
    const runResult = await query("SELECT id, source_snapshot_json, input_json FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND status = 'QUEUED'", [runId, workspaceId]);
    if (!runResult.rowCount) throw new Error('热点分析任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const run = runResult.rows[0];
    const snapshot = run.source_snapshot_json;
    const input = run.input_json;
    route = input.route;
    if (route.provider !== 'BAILIAN_CLI') throw new Error('热点分析需要使用支持富内容理解的百炼 CLI 模型。');
    const prompt = buildAnalysisPrompt({ template: input.template.body, item: snapshot.item, profile: snapshot.profile, platforms: input.selectedPlatforms });
    const connectionInput = await textConnectionInput(workspaceId, route);
    const richContent = snapshot.item.richContent ?? { text: { title: snapshot.item.title, body: snapshot.item.summary }, media: [] };
    const firstContent = extractOmniText(await runBailianCli(buildRichContentOmniArgs({ model: route.model, system: prompt.system, message: prompt.message, content: richContent, maxTokens: 3_000 }), connectionInput.apiKey, richContent.media?.some((item) => item.kind === 'VIDEO') ? 180_000 : 120_000));
    if (!firstContent) throw new Error('热点分析模型没有返回可用内容。');
    let output;
    try { output = parseAnalysisContent(firstContent, input.selectedPlatforms); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合 JSON 契约。';
      const repairMessage = JSON.stringify({ invalidOutput: firstContent, context: JSON.parse(prompt.message) });
      const repairedContent = extractOmniText(await runBailianCli(buildRichContentOmniArgs({ model: route.model, system: buildAnalysisRepairPrompt(prompt.system, validationError), message: repairMessage, content: richContent, maxTokens: 3_000 }), connectionInput.apiKey, richContent.media?.some((item) => item.kind === 'VIDEO') ? 180_000 : 120_000));
      output = parseAnalysisContent(repairedContent, input.selectedPlatforms);
    }
    const overallScore = calculateOverallScore(output.dimensions);
    const decision = decisionForScore(overallScore);
    const finalOutput = { ...output, overallScore, decision, model: route.model, promptVersion: String(input.template.version), analyzedAt: new Date().toISOString() };
    const saved = await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(finalOutput), JSON.stringify({ inputTokens, outputTokens })]);
      const analysis = await client.query(`INSERT INTO intelligence_analyses (workspace_id, intelligence_item_id, generation_run_id, selected_platforms, output_json, overall_score, decision)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [workspaceId, snapshot.item.id, runId, JSON.stringify(input.selectedPlatforms), JSON.stringify(output), overallScore, decision]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ analysisId: analysis.rows[0].id })]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'INTELLIGENCE_ANALYSIS', 'SUCCESS', $5, $6, $7)`, [workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null]);
      return analysis.rows[0];
    });
    return { analysisId: saved.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : '热点分析失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'INTELLIGENCE_ANALYSIS', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function generateCreativeOutline({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens;
  let outputTokens;
  try {
    const runResult = await query("SELECT id, source_snapshot_json, input_json FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND action_version_id = 'creative-outline:1.1.0' AND status = 'QUEUED'", [runId, workspaceId]);
    if (!runResult.rowCount) throw new Error('大纲任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const snapshot = runResult.rows[0].source_snapshot_json;
    route = runResult.rows[0].input_json.route;
    const connectionInput = await textConnectionInput(workspaceId, route);
    const prompt = buildOutlinePrompt({ ...snapshot, template: runResult.rows[0].input_json.template?.body });
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseOutlineContent(first.content); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合大纲 JSON 契约。';
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildOutlineRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
      inputTokens = (inputTokens ?? 0) + (repaired.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (repaired.outputTokens ?? 0);
      output = parseOutlineContent(repaired.content);
    }
    const candidate = await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(output), JSON.stringify({ inputTokens, outputTokens })]);
      const saved = await client.query(`INSERT INTO creative_outline_candidates
        (workspace_id, project_id, platform, generation_run_id, output_json)
        VALUES ($1, $2, $3, $4, $5) RETURNING id`, [workspaceId, snapshot.project.id, snapshot.platform, runId, JSON.stringify(output)]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ candidateId: saved.rows[0].id })]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'CONTENT_WRITING', 'SUCCESS', $5, $6, $7)`, [workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null]);
      return saved.rows[0];
    });
    return { candidateId: candidate.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : '大纲生成失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'CONTENT_WRITING', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function generateCreativeDraft({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens;
  let outputTokens;
  try {
    const runResult = await query('SELECT id, source_snapshot_json, input_json FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND action_version_id = $3 AND status = \'QUEUED\'', [runId, workspaceId, DRAFT_ACTION_VERSION]);
    if (!runResult.rowCount) throw new Error('初稿任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const snapshot = runResult.rows[0].source_snapshot_json;
    const input = runResult.rows[0].input_json;
    route = input.route;
    const connectionInput = await textConnectionInput(workspaceId, route);
    const prompt = buildDraftPrompt({ ...snapshot, template: input.template.body });
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseDraftContent(first.content); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合初稿 JSON 契约。';
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildDraftRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
      inputTokens = (inputTokens ?? 0) + (repaired.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (repaired.outputTokens ?? 0);
      output = parseDraftContent(repaired.content);
    }
    const candidate = await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(output), JSON.stringify({ inputTokens, outputTokens })]);
      const saved = await client.query(`INSERT INTO creative_draft_candidates
        (workspace_id, project_id, platform, outline_candidate_id, generation_run_id, output_json)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [workspaceId, snapshot.project.id, snapshot.platform, snapshot.outline.id, runId, JSON.stringify(output)]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ candidateId: saved.rows[0].id })]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'CONTENT_WRITING', 'SUCCESS', $5, $6, $7)`, [workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null]);
      return saved.rows[0];
    });
    return { candidateId: candidate.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : '初稿生成失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'CONTENT_WRITING', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

function copyResearchContext(result) {
  if (!result) return null;
  return {
    verifiedFacts: Array.isArray(result.facts) ? result.facts.filter((item) => item?.status === 'VERIFIED') : [],
    cautions: Array.isArray(result.cautions) ? result.cautions : [],
    creativeReferences: result.materialContext?.creativeReferences ?? [],
    userContent: result.materialContext?.userContent ?? [],
    visualAssets: result.materialContext?.visualAssets ?? [],
  };
}

function hasVerifiedCopyFacts(researchContext) {
  return (researchContext?.verifiedFacts ?? []).some((item) => typeof item === 'string' ? item.trim() : item?.status === 'VERIFIED' && String(item.claim ?? '').trim());
}

function canWriteFromAuthorMaterials(snapshot) {
  const materials = [
    ...(Array.isArray(snapshot.materials) ? snapshot.materials : []),
    ...(Array.isArray(snapshot.researchContext?.userContent) ? snapshot.researchContext.userContent : []),
  ];
  const hasAuthorContent = materials.some((item) => ['DRAFT', 'OPINION', 'EXPERIENCE', 'REFERENCE'].includes(String(item?.kind ?? '').toUpperCase()) && String(item?.body ?? item?.content ?? '').trim());
  const explicitlyNeedsSources = Boolean(String(snapshot.project?.planning?.sourceRequirements ?? snapshot.brief?.sourceRequirements ?? '').trim()) || (snapshot.project?.factChecks ?? []).length > 0;
  return hasAuthorContent && !explicitlyNeedsSources;
}

async function prepareCopyResearchContext(workspaceId, snapshot, input) {
  if (hasVerifiedCopyFacts(snapshot.researchContext) || canWriteFromAuthorMaterials(snapshot) || !input.researchRoute) {
    return { researchContext: snapshot.researchContext, inputTokens: 0, outputTokens: 0, sourceCount: 0 };
  }
  const researchSnapshot = {
    projectId: snapshot.projectId,
    project: snapshot.project,
    brief: snapshot.brief,
    request: '为最终成稿自动补齐与当前选题直接相关的公开事实，不改变已确认选题。',
    materials: snapshot.materials ?? [],
    stage: 'COPY',
  };
  const planned = await runWorkflowResearchPlan(workspaceId, researchSnapshot, input.researchRoute);
  const sources = await captureWorkflowSources(workspaceId, planned.output, snapshot.project);
  const verification = await verifyWorkflowClaims(workspaceId, planned.output, sources, input.verificationRoute, input.verificationTemplate);
  const result = buildResearchResult({
    plan: planned.output,
    sources,
    verification: verification?.output ?? null,
    materials: snapshot.materials ?? [],
    verificationStatus: verification?.recovered ? 'PARTIAL' : verification ? 'COMPLETE' : 'FAILED',
    verificationMessage: verification?.warning ?? '',
  });
  return {
    researchContext: copyResearchContext(result),
    inputTokens: planned.inputTokens + (verification?.inputTokens ?? 0),
    outputTokens: planned.outputTokens + (verification?.outputTokens ?? 0),
    sourceCount: result.sources.length,
  };
}

async function generateProjectCopyAction({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const runResult = await query(`SELECT id, action_version_id, source_snapshot_json, input_json
      FROM generation_runs WHERE id = $1 AND workspace_id = $2
        AND action_version_id LIKE 'project-copy-%' AND status = 'QUEUED'`, [runId, workspaceId]);
    if (!runResult.rowCount) throw new Error('文案任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const run = runResult.rows[0];
    const snapshot = run.source_snapshot_json;
    const input = run.input_json;
    if (snapshot.platform !== 'WECHAT' || snapshot.policy?.scope !== WECHAT_COPY_GENERATION_SCOPE) throw new Error('正文任务不是有效的公众号母稿任务。');
    route = input.route;
    const policy = {
      scope: WECHAT_COPY_GENERATION_SCOPE,
      provider: route.provider,
      connectionId: route.connectionId ?? null,
      model: route.model,
      promptVersion: input.template.version,
    };
    if (policy.provider !== snapshot.policy.provider
      || policy.connectionId !== (snapshot.policy.connectionId ?? null)
      || policy.model !== snapshot.policy.model
      || String(policy.promptVersion) !== String(snapshot.policy.promptVersion)) {
      throw new Error('正文任务策略快照与执行参数不一致。');
    }
    const isOutlineAction = snapshot.action === 'GENERATE_OUTLINE';
    const isInitialDraft = snapshot.action === 'GENERATE_DRAFT';
    const prepared = isInitialDraft
      ? await prepareCopyResearchContext(workspaceId, snapshot, input)
      : { researchContext: snapshot.researchContext, inputTokens: 0, outputTokens: 0, sourceCount: 0 };
    inputTokens += prepared.inputTokens;
    outputTokens += prepared.outputTokens;
    const preparedSnapshot = { ...snapshot, researchContext: prepared.researchContext };
    const writingPacket = buildWritingPacket(preparedSnapshot, prepared.researchContext);
    const connectionInput = await textConnectionInput(workspaceId, route);
    const prompt = isInitialDraft
      ? buildFinishedCopyPrompt(writingPacket, input.template.body)
      : buildCopyPrompt({ ...preparedSnapshot, template: input.template.body });
    const first = await textRunner.runText({
      provider: route.provider,
      model: route.model,
      system: prompt.system,
      message: prompt.message,
      ...(typeof prompt.enableThinking === 'boolean' ? { enableThinking: prompt.enableThinking } : {}),
      ...(typeof prompt.contentFormat === 'string' ? { contentFormat: prompt.contentFormat } : {}),
      maxTokens: copyMaxTokensForLength(writingPacket.targetLength),
      ...connectionInput,
    });
    inputTokens += first.inputTokens ?? 0;
    outputTokens += first.outputTokens ?? 0;
    const output = isOutlineAction
      ? parseOutlineContent(first.content)
      : isInitialDraft
      ? { ...parseFinishedCopyBody(first.content, writingPacket, snapshot.action, preparedSnapshot), changeSummary: '已生成正式正文。' }
      : parseRevisionCopyBody(first.content, snapshot.action, { ...preparedSnapshot, lockedTitle: writingPacket.lockedTitle });
    const saved = await transaction(async (client) => {
      const activeRun = await client.query("SELECT id FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND status = 'RUNNING' FOR UPDATE", [runId, workspaceId]);
      if (!activeRun.rowCount) throw new Error('文案任务已取消或中断。');
      const isRevisionCandidate = !isOutlineAction && !isInitialDraft;
      let artifact = isOutlineAction ? await projectAgentStore.createArtifact(client, {
        workspaceId,
        projectId: snapshot.projectId,
        type: 'OUTLINE',
        stage: 'COPY',
        platform: 'WECHAT',
        status: 'CANDIDATE',
        actionRunId: runId,
        title: output.titleOptions[0],
        metadata: { action: snapshot.action, payload: output },
      }) : null;
      let draft = null;
      if (isInitialDraft) {
        draft = await draftStore.upsertWechat(workspaceId, snapshot.projectId, {
          title: output.title,
          body: output.body,
        }, client);
      }
      if (isRevisionCandidate) {
        artifact = await projectAgentStore.createArtifact(client, {
          workspaceId,
          projectId: snapshot.projectId,
          type: 'PLATFORM_COPY',
          stage: 'COPY',
          platform: 'WECHAT',
          status: 'CANDIDATE',
          actionRunId: runId,
          title: output.title,
          metadata: { action: snapshot.action, payload: output },
        });
        const parent = await client.query(`SELECT id, version_number FROM platform_content_versions
          WHERE workspace_id = $1 AND project_id = $2 AND platform = 'WECHAT'
          ORDER BY version_number DESC LIMIT 1`, [workspaceId, snapshot.projectId]);
        const parentVersion = parent.rows[0] ?? null;
        await client.query(`INSERT INTO platform_content_versions
          (workspace_id, project_id, platform, artifact_id, parent_version_id, version_number, title, body, facts_to_verify_json, change_summary)
          VALUES ($1, $2, 'WECHAT', $3, $4, $5, $6, $7, $8, $9)`, [
          workspaceId,
          snapshot.projectId,
          artifact.id,
          parentVersion?.id ?? null,
          Number(parentVersion?.version_number ?? 0) + 1,
          output.title,
          output.body,
          JSON.stringify(output.factsToVerify ?? []),
          output.changeSummary ?? '',
        ]);
      }
      const message = await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
        VALUES ($1, $2, $3, 'ASSISTANT', $4, 'COPY', 'ARTIFACT', $5, $6) RETURNING id`, [
        workspaceId,
        snapshot.projectId,
        runId,
        isOutlineAction ? output.summary : isInitialDraft ? '正文已生成并自动保存。' : output.changeSummary,
        JSON.stringify(artifact ? [artifact.id] : []),
        JSON.stringify({ platform: 'WECHAT', action: snapshot.action, policy, draftId: draft?.id ?? null }),
      ]);
      if (artifact) await client.query('UPDATE project_artifacts SET created_by_message_id = $1 WHERE id = $2 AND workspace_id = $3', [message.rows[0].id, artifact.id, workspaceId]);
      if (isInitialDraft) {
        await projectAgentStore.upsertStageSummary(client, {
          workspaceId,
          projectId: snapshot.projectId,
          stage: 'COPY',
          platform: 'WECHAT',
          summary: isInitialDraft ? '正文已生成并自动保存。' : output.changeSummary,
          throughMessageId: message.rows[0].id,
        });
      }
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(output), JSON.stringify({ inputTokens, outputTokens, automaticResearchSources: prepared.sourceCount })]);
      const result = { artifactId: artifact?.id ?? null, draftId: draft?.id ?? null };
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify(result)]);
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, $5, 'SUCCESS', $6, $7, $8)`, [
        workspaceId, jobId, route.provider, route.model, WECHAT_COPY_GENERATION_SCOPE, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null,
      ]);
      return result;
    });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : '文案任务执行失败。';
    await transaction(async (client) => {
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, $5, 'FAILED', $6, $7, $8, $9)`, [
        workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, WECHAT_COPY_GENERATION_SCOPE, Date.now() - startedAt,
        inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000),
      ]);
    });
    throw error;
  }
}

async function generateAgentPlan({ jobId, workspaceId, planId }) {
  const planRow = await query('SELECT request_text, context_json FROM agent_plans WHERE id = $1 AND workspace_id = $2', [planId, workspaceId]);
  if (!planRow.rowCount) throw new Error('未找到 Agent 计划。');
  const policyRow = await query('SELECT model FROM agent_model_policies WHERE workspace_id = $1 AND scope = $2 AND provider = $3', [workspaceId, 'AGENT_PLANNER', 'BAILIAN_CLI']);
  if (!policyRow.rowCount) throw new Error('请先为核心 Agent 配置规划模型。');
  const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
  if (!keyRow.rowCount) throw new Error('工作空间未配置百炼 Key。');
  const skills = await listAvailableSkills(workspaceId);
  const system = `你是内容运营核心 Agent。你只负责生成受限任务计划，不直接执行。只可从以下 Skill 中选择，不能编造 Skill、URL、工具或发布动作。必须仅返回 JSON：{"goal":"","contextSummary":"","estimatedCost":"","risks":[""],"steps":[{"skillVersionId":"","purpose":"","inputs":[""]}]}。可用 Skill：${JSON.stringify(plannerSkillView(skills))}`;
  const prompt = JSON.stringify({ request: planRow.rows[0].request_text, context: planRow.rows[0].context_json });
  const output = await runBailianCli(['text', 'chat', '--model', policyRow.rows[0].model, '--system', system, '--message', prompt, '--max-tokens', '1200', '--temperature', '0.2', '--output', 'json'], decrypt(keyRow.rows[0].encrypted_secret));
  const payload = JSON.parse(output);
  const content = payload?.choices?.[0]?.message?.content ?? payload?.content;
  if (typeof content !== 'string') throw new Error('核心 Agent 没有返回计划内容。');
  const plan = parsePlan(content, skills);
  await query('UPDATE agent_plans SET status = $1, plan_json = $2, planner_model = $3, updated_at = now() WHERE id = $4', ['WAITING_CONFIRMATION', JSON.stringify(plan), policyRow.rows[0].model, planId]);
  await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ planId }), jobId]);
  return { planId };
}

const worker = new Worker('content-engine', processJob, { connection });
worker.on('ready', async () => {
  console.log('Content Engine Worker 已启动');
  void refreshAllPublicationMetrics();
  try {
    const recovered = await storageDeletion.recoverPendingDeletionJobs();
    await Promise.all(recovered.map((job) => enqueue(job)));
    if (recovered.length) console.log(`已恢复 ${recovered.length} 个存储删除任务`);
  } catch (error) {
    console.error(`恢复存储删除任务失败：${error instanceof Error ? error.message : String(error)}`);
  }
});
worker.on('failed', (job, error) => console.error(`任务 ${job?.id} 失败：${error.message}`));

const metricsTimer = setInterval(() => { void refreshAllPublicationMetrics(); }, PUBLICATION_METRICS_INTERVAL_MS);
metricsTimer.unref?.();
async function close() { clearInterval(metricsTimer); await worker.close(); await connection.quit(); }
process.on('SIGINT', () => void close().finally(() => process.exit(0)));
process.on('SIGTERM', () => void close().finally(() => process.exit(0)));
