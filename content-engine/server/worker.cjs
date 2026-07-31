const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const config = require('./config.cjs');
const { query, transaction } = require('./db.cjs');
const { decrypt } = require('./crypto.cjs');
const { runBailianCli } = require('./runner/bailian.cjs');
const { listAvailableSkills, plannerSkillView } = require('./agent/skillRegistry.cjs');
const { parsePlan } = require('./agent/planValidation.cjs');
const { createTextModelRunner } = require('./services/text-model.cjs');
const { buildAnalysisPrompt, buildAnalysisRepairPrompt, calculateOverallScore, decisionForScore, parseAnalysisContent } = require('./services/intelligence-analysis.cjs');
const { buildOutlinePrompt, buildOutlineRepairPrompt, parseOutlineContent } = require('./services/creative-outline.cjs');
const { DRAFT_ACTION_VERSION, buildDraftPrompt, buildDraftRepairPrompt, parseDraftContent } = require('./services/creative-draft.cjs');
const { PROJECT_RESEARCH_ACTION_VERSION, buildResearchPlanPrompt, buildResearchPlanRepairPrompt, parseResearchPlan } = require('./services/project-research.cjs');
const { searchTavily } = require('./services/tavily.cjs');
const { clipPublicLink } = require('./services/public-web.cjs');
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
const { buildCopyPrompt, buildCopyRepairPrompt, buildCopyQualityReviewPrompt, candidateQualityReview, detectVoiceViolations, reconcileFactsToVerify, parseCopyOutput, parseCopyQualityReviewSafely } = require('./services/project-copy-action.cjs');

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const textRunner = createTextModelRunner();
const projectAgentStore = createProjectAgentStore({ query, transaction });

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
    await query("UPDATE generation_runs SET status = 'QUEUED', started_at = NULL, completed_at = NULL WHERE id = $1 AND workspace_id = $2 AND status = 'RUNNING'", [payload.runId, workspaceId]);
  }
  try {
    if (queueJob.name === 'AGENT_PLAN') return await generateAgentPlan({ jobId, workspaceId, planId: payload.planId });
    if (queueJob.name === 'INTELLIGENCE_ANALYSIS') return await generateIntelligenceAnalysis({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_RESEARCH_PLAN') return await generateProjectResearchPlan({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_RESEARCH_WORKFLOW') return await generateSimplifiedResearchWorkflow({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_RESEARCH_SOURCES') return await generateProjectResearchSources({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'SOURCE_VERIFICATION') return await generateSourceVerification({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'CREATIVE_OUTLINE') return await generateCreativeOutline({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'CREATIVE_DRAFT') return await generateCreativeDraft({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name === 'PROJECT_COPY_ACTION') return await generateProjectCopyAction({ jobId, workspaceId, runId: payload.runId });
    if (queueJob.name !== 'BAILIAN_TEXT') throw new Error(`暂不支持的任务类型：${queueJob.name}`);
    const keyRow = await query('SELECT encrypted_secret FROM credential_vault WHERE workspace_id = $1 AND provider = $2', [workspaceId, 'BAILIAN']);
    if (!keyRow.rowCount) throw new Error('工作空间未配置百炼 Key。');
    const output = await runBailianCli(['text', 'chat', '--model', payload.model, '--system', payload.system, '--message', payload.message, '--output', 'json'], decrypt(keyRow.rows[0].encrypted_secret));
    await query('UPDATE jobs SET status = $1, result_json = $2, completed_at = now() WHERE id = $3', ['SUCCEEDED', JSON.stringify({ output }), jobId]);
    return { jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务失败。';
    if (queueJob.name === 'AGENT_PLAN' && payload.planId) await query('UPDATE agent_plans SET status = $1, error = $2, updated_at = now() WHERE id = $3 AND workspace_id = $4', ['FAILED', message.slice(0, 2_000), payload.planId, workspaceId]);
    await query("UPDATE jobs SET status = $1, error = $2, completed_at = now() WHERE id = $3 AND status <> 'CANCELLED'", ['FAILED', message.slice(0, 2_000), jobId]);
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
  const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
  try {
    return { output: parseResearchPlan(first.content), inputTokens: first.inputTokens ?? 0, outputTokens: first.outputTokens ?? 0 };
  } catch (error) {
    const validationError = error instanceof Error ? error.message : '研究计划输出不符合 JSON 契约。';
    const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildResearchPlanRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
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
        const results = normalizeSearchResults(action, searched.filter((item) => sourceMatchesProject(item, project)));
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
    return {
      output: parseSourceVerification(repaired.content, { claims: plan.claims, sources: selectedSources }),
      inputTokens: (first.inputTokens ?? 0) + (repaired.inputTokens ?? 0),
      outputTokens: (first.outputTokens ?? 0) + (repaired.outputTokens ?? 0),
    };
  }
}

async function verifyWorkflowClaims(workspaceId, plan, sources, route, template) {
  const selectedIds = new Set(recommendSourceSelection(sources, 8));
  const selectedSources = sources.filter((source) => selectedIds.has(source.id) && String(source.summary ?? '').trim());
  if (!route || !selectedSources.length || !Array.isArray(plan.claims) || !plan.claims.length) return null;
  try {
    return { ...(await runWorkflowVerificationAttempt(workspaceId, plan, selectedSources, route, template)), recovered: false };
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3 AND status <> 'CANCELLED'", [runId, message.slice(0, 2_000), workspaceId]);
      await client.query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND status <> 'CANCELLED'", [jobId, message.slice(0, 2_000)]);
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3", [runId, message.slice(0, 2_000), workspaceId]);
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3 AND status <> 'CANCELLED'", [runId, message.slice(0, 2_000), workspaceId]);
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
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseResearchPlan(first.content); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合研究计划 JSON 契约。';
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildResearchPlanRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3", [runId, message.slice(0, 2_000), workspaceId]);
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
    const prompt = buildAnalysisPrompt({ template: input.template.body, item: snapshot.item, profile: snapshot.profile, platforms: input.selectedPlatforms });
    const connectionInput = await textConnectionInput(workspaceId, route);
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseAnalysisContent(first.content, input.selectedPlatforms); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合 JSON 契约。';
      const repaired = await textRunner.runText({ provider: route.provider, model: route.model, system: buildAnalysisRepairPrompt(prompt.system, validationError), message: first.content, ...connectionInput });
      inputTokens = (inputTokens ?? 0) + (repaired.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (repaired.outputTokens ?? 0);
      output = parseAnalysisContent(repaired.content, input.selectedPlatforms);
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3 AND status <> 'CANCELLED'", [runId, message.slice(0, 2_000), workspaceId]);
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3", [runId, message.slice(0, 2_000), workspaceId]);
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
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3", [runId, message.slice(0, 2_000), workspaceId]);
      await client.query(`INSERT INTO api_usage_logs (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'CONTENT_WRITING', 'FAILED', $5, $6, $7, $8)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null, message.slice(0, 2_000)]);
    });
    throw error;
  }
}

async function generateProjectCopyAction({ jobId, workspaceId, runId }) {
  const startedAt = Date.now();
  let route;
  let inputTokens;
  let outputTokens;
  try {
    const runResult = await query(`SELECT id, action_version_id, source_snapshot_json, input_json
      FROM generation_runs WHERE id = $1 AND workspace_id = $2
        AND action_version_id LIKE 'project-copy-%' AND status = 'QUEUED'`, [runId, workspaceId]);
    if (!runResult.rowCount) throw new Error('文案任务当前不能执行。');
    await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2", [runId, workspaceId]);
    const run = runResult.rows[0];
    const snapshot = run.source_snapshot_json;
    const input = run.input_json;
    route = input.route;
    const connectionInput = await textConnectionInput(workspaceId, route);
    const prompt = buildCopyPrompt({ ...snapshot, template: input.template.body });
    const isOutlineAction = snapshot.action === 'GENERATE_OUTLINE';
    const first = await textRunner.runText({ provider: route.provider, model: route.model, system: prompt.system, message: prompt.message, ...connectionInput });
    inputTokens = first.inputTokens;
    outputTokens = first.outputTokens;
    let output;
    try { output = parseCopyOutput(first.content, snapshot.action, snapshot); }
    catch (error) {
      const validationError = error instanceof Error ? error.message : '输出不符合文案 JSON 契约。';
      const repaired = await textRunner.runText({
        provider: route.provider,
        model: route.model,
        system: buildCopyRepairPrompt(prompt.system, validationError),
        message: first.content,
        ...connectionInput,
      });
      inputTokens = (inputTokens ?? 0) + (repaired.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (repaired.outputTokens ?? 0);
      output = parseCopyOutput(repaired.content, snapshot.action, snapshot);
    }
    if (!isOutlineAction) {
      let qualityReview;
      const pipelineIssues = [];
      const voiceIssues = detectVoiceViolations(output.body, snapshot.accountVoice?.rules);
      if (voiceIssues.length) {
        try {
          const rewritten = await textRunner.runText({
            provider: route.provider,
            model: route.model,
            system: buildCopyRepairPrompt(prompt.system, voiceIssues.map((issue) => issue.message).join('；')),
            message: JSON.stringify(output),
            ...connectionInput,
          });
          inputTokens = (inputTokens ?? 0) + (rewritten.inputTokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (rewritten.outputTokens ?? 0);
          output = parseCopyOutput(rewritten.content, snapshot.action, snapshot);
        } catch {
          pipelineIssues.push('账号声音自动修正未完成，已保留修正前正文，请人工检查。');
        }
      }
      let review = { approved: true, issues: [], malformed: false };
      try {
        const reviewPrompt = buildCopyQualityReviewPrompt({ action: snapshot.action, platform: snapshot.platform, output, researchContext: snapshot.researchContext, currentContent: snapshot.currentContent });
        const reviewed = await textRunner.runText({ provider: route.provider, model: route.model, system: reviewPrompt.system, message: reviewPrompt.message, ...connectionInput });
        inputTokens = (inputTokens ?? 0) + (reviewed.inputTokens ?? 0);
        outputTokens = (outputTokens ?? 0) + (reviewed.outputTokens ?? 0);
        review = parseCopyQualityReviewSafely(reviewed.content);
        if (!review.approved && !review.malformed) {
          const qualityError = `质量审稿未通过：${review.issues.join('；')}`;
          const rewritten = await textRunner.runText({
            provider: route.provider,
            model: route.model,
            system: buildCopyRepairPrompt(prompt.system, qualityError),
            message: JSON.stringify(output),
            ...connectionInput,
          });
          inputTokens = (inputTokens ?? 0) + (rewritten.inputTokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (rewritten.outputTokens ?? 0);
          output = parseCopyOutput(rewritten.content, snapshot.action, snapshot);
          const finalReviewPrompt = buildCopyQualityReviewPrompt({ action: snapshot.action, platform: snapshot.platform, output, researchContext: snapshot.researchContext, currentContent: snapshot.currentContent });
          const finalReviewed = await textRunner.runText({ provider: route.provider, model: route.model, system: finalReviewPrompt.system, message: finalReviewPrompt.message, ...connectionInput });
          inputTokens = (inputTokens ?? 0) + (finalReviewed.inputTokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (finalReviewed.outputTokens ?? 0);
          review = parseCopyQualityReviewSafely(finalReviewed.content);
        }
      } catch {
        pipelineIssues.push('质量审稿未完成，候选正文已保留，请人工检查。');
      }
      const finalVoiceIssues = snapshot.accountVoice ? detectVoiceViolations(output.body, snapshot.accountVoice.rules) : [];
      qualityReview = candidateQualityReview(review, [...finalVoiceIssues, ...pipelineIssues]);
      output.qualityReview = qualityReview;
    }
    // 项目历史核验池不属于本次候选，候选版本只保存正文直接涉及的核验项。
    const candidateFactsToVerify = reconcileFactsToVerify(output.factsToVerify, snapshot.researchContext?.verifiedFacts);
    output.factsToVerify = candidateFactsToVerify;
    const saved = await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(output), JSON.stringify({ inputTokens, outputTokens })]);
      const isOutline = isOutlineAction;
      const artifact = await projectAgentStore.createArtifact(client, {
        workspaceId,
        projectId: snapshot.projectId,
        type: isOutline ? 'OUTLINE' : 'PLATFORM_COPY',
        stage: 'COPY',
        platform: snapshot.platform,
        status: 'CANDIDATE',
        actionRunId: runId,
        title: isOutline ? output.titleOptions[0] : output.title,
        metadata: { action: snapshot.action, payload: output },
      });
      let versionId = null;
      if (!isOutline) {
        const versionResult = await client.query(`SELECT
            COALESCE(MAX(v.version_number), 0) + 1 AS next_version,
            (ARRAY_AGG(v.id ORDER BY v.version_number DESC) FILTER (WHERE a.status = 'ACCEPTED'))[1] AS parent_version_id,
            (ARRAY_AGG(v.content_master_version_id ORDER BY v.version_number DESC) FILTER (WHERE a.status = 'ACCEPTED'))[1] AS master_version_id
          FROM platform_content_versions v
          JOIN project_artifacts a ON a.id = v.artifact_id
          WHERE v.workspace_id = $1 AND v.project_id = $2 AND v.platform = $3`, [workspaceId, snapshot.projectId, snapshot.platform]);
        const version = versionResult.rows[0];
        const inserted = await client.query(`INSERT INTO platform_content_versions
          (workspace_id, project_id, platform, artifact_id, content_master_version_id, parent_version_id,
           version_number, title, body, facts_to_verify_json, change_summary)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [
          workspaceId,
          snapshot.projectId,
          snapshot.platform,
          artifact.id,
          version.master_version_id ?? null,
          version.parent_version_id ?? null,
          Number(version.next_version),
          output.title,
          output.body,
          JSON.stringify(output.factsToVerify),
          output.changeSummary,
        ]);
        versionId = inserted.rows[0].id;
      }
      const message = await client.query(`INSERT INTO project_agent_messages
        (workspace_id, project_id, action_run_id, role, content, stage, message_type, artifact_refs_json, metadata_json)
        VALUES ($1, $2, $3, 'ASSISTANT', $4, 'COPY', 'ARTIFACT', $5, $6) RETURNING id`, [
        workspaceId,
        snapshot.projectId,
        runId,
        isOutline ? output.summary : output.changeSummary,
        JSON.stringify([artifact.id]),
        JSON.stringify({ platform: snapshot.platform, action: snapshot.action, model: route.model, status: 'CANDIDATE' }),
      ]);
      await client.query('UPDATE project_artifacts SET created_by_message_id = $1 WHERE id = $2 AND workspace_id = $3', [message.rows[0].id, artifact.id, workspaceId]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ artifactId: artifact.id, versionId })]);
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
        VALUES ($1, $2, $3, $4, 'PROJECT_COPY', 'SUCCESS', $5, $6, $7)`, [
        workspaceId, jobId, route.provider, route.model, Date.now() - startedAt, inputTokens ?? null, outputTokens ?? null,
      ]);
      return { artifactId: artifact.id, versionId };
    });
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : '文案任务执行失败。';
    await transaction(async (client) => {
      await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3", [runId, message.slice(0, 2_000), workspaceId]);
      await client.query(`INSERT INTO api_usage_logs
        (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
        VALUES ($1, $2, $3, $4, 'PROJECT_COPY', 'FAILED', $5, $6, $7, $8)`, [
        workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, Date.now() - startedAt,
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
worker.on('ready', () => console.log('Content Engine Worker 已启动'));
worker.on('failed', (job, error) => console.error(`任务 ${job?.id} 失败：${error.message}`));

async function close() { await worker.close(); await connection.quit(); }
process.on('SIGINT', () => void close().finally(() => process.exit(0)));
process.on('SIGTERM', () => void close().finally(() => process.exit(0)));
