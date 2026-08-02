const { z } = require('zod');
const { businessError } = require('./business-errors.cjs');

const DRAFT_ADAPTATION_SKILL_VERSION = 'content-writing:1.0.0';
const DRAFT_ADAPTATION_PROMPT_VERSION = 'draft-adaptation:1.0.0';
const TARGET_PLATFORMS = new Set(['XIAOHONGSHU', 'WEIBO']);

function adaptationScope(platform) {
  if (platform === 'XIAOHONGSHU') return 'XIAOHONGSHU_ADAPTATION';
  if (platform === 'WEIBO') return 'WEIBO_ADAPTATION';
  throw businessError(400, 'DRAFT_PLATFORM_UNSUPPORTED', '只能生成小红书或微博草稿。', { platform });
}

function adaptationStrategy(platform) {
  adaptationScope(platform);
  return {
    platform,
    imageLimit: 9,
    layoutRequired: false,
    imageDirection: 'CONTENT_FIRST',
    sourcePolicy: 'CURRENT_WECHAT_VERSION_ONLY',
  };
}

function buildAdaptationPrompt(snapshot) {
  const platform = snapshot?.platform;
  adaptationScope(platform);
  if (!snapshot?.source || snapshot.source.platform !== 'WECHAT' || snapshot.source.id !== snapshot.sourceDraftVersionId) {
    throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '适配任务缺少有效的公众号来源版本。');
  }
  const platformRule = platform === 'XIAOHONGSHU'
    ? '标题自然、有信息量；正文适合移动端阅读；图片建议比例固定为 3:4，可提出需要新图的建议。'
    : '正文是一条完整微博；标题可以为空；图片只能复用来源素材，比例固定为 original。';
  return {
    system: `你负责把已完成的公众号母稿改写为${platform === 'XIAOHONGSHU' ? '小红书' : '微博'}图文草稿。图片内容为主、文字为辅，避免文字海报和 PPT 式画面。不要生成排版 HTML，不要杜撰事实或来源素材 ID。${platformRule} 只返回指定 JSON 对象，不要 Markdown 代码块、解释或额外字段。`,
    message: JSON.stringify({
      source: {
        versionId: snapshot.sourceDraftVersionId,
        title: snapshot.source.title,
        body: snapshot.source.body,
        assets: snapshot.source.assets.map(({ assetId, role, sortOrder }) => ({ assetId, role, sortOrder })),
      },
      strategy: snapshot.strategy ?? adaptationStrategy(platform),
      outputContract: platform === 'XIAOHONGSHU'
        ? { title: '', body: '', imageSuggestions: [{ sourceAssetId: null, purpose: '', preferredRatio: '3:4', needsNewImage: true }] }
        : { title: '', body: '', imageSuggestions: [{ sourceAssetId: 'source-asset-uuid', purpose: '', preferredRatio: 'original', needsNewImage: false }] },
    }),
  };
}

const baseOutput = {
  title: z.string().trim().max(300),
  body: z.string().trim().min(1, '适配正文不能为空。').max(200_000),
};
const xiaohongshuOutput = z.object({
  ...baseOutput,
  imageSuggestions: z.array(z.object({
    sourceAssetId: z.string().uuid().nullable(),
    purpose: z.string().trim().min(1).max(500),
    preferredRatio: z.literal('3:4'),
    needsNewImage: z.boolean(),
  }).strict()).max(9, '小红书最多允许 9 张图片建议。'),
}).strict();
const weiboOutput = z.object({
  ...baseOutput,
  imageSuggestions: z.array(z.object({
    sourceAssetId: z.string().uuid(),
    purpose: z.string().trim().min(1).max(500),
    preferredRatio: z.literal('original'),
    needsNewImage: z.literal(false),
  }).strict()).max(9, '微博最多允许 9 张图片建议。'),
}).strict();

function parseAdaptationOutput(content, platform, sourceAssetIds = []) {
  adaptationScope(platform);
  let payload;
  try {
    payload = JSON.parse(String(content));
  } catch {
    throw businessError(502, 'DRAFT_ADAPTATION_OUTPUT_INVALID', '平台适配模型必须返回严格 JSON。');
  }
  const parsed = (platform === 'XIAOHONGSHU' ? xiaohongshuOutput : weiboOutput).safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message?.includes('9') ? issue.message
      : issue?.path?.includes('body') ? '适配正文不能为空。'
        : issue?.path?.includes('sourceAssetId') ? '微博图片建议必须引用来源素材。'
          : '平台适配输出字段或格式不符合契约。';
    throw businessError(502, 'DRAFT_ADAPTATION_OUTPUT_INVALID', message, { issues: parsed.error.issues });
  }
  const allowedIds = new Set(sourceAssetIds);
  const referencedIds = parsed.data.imageSuggestions.flatMap(({ sourceAssetId }) => sourceAssetId ? [sourceAssetId] : []);
  if (referencedIds.some((assetId) => !allowedIds.has(assetId))) {
    throw businessError(502, 'DRAFT_ADAPTATION_ASSET_UNKNOWN', '图片建议引用了不属于公众号来源版本的来源素材。');
  }
  if (new Set(referencedIds).size !== referencedIds.length) {
    throw businessError(502, 'DRAFT_ADAPTATION_ASSET_DUPLICATED', '图片建议不能重复引用同一张来源素材。');
  }
  return parsed.data;
}

function runView(row, confirmation) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    confirmation,
  };
}

function createDraftAdaptationService({ query, transaction, draftStore, resolveTaskRoute, enqueue, runTextTask }) {
  if (typeof query !== 'function' || typeof transaction !== 'function' || !draftStore) throw new TypeError('草稿适配服务缺少数据库或草稿 Store。');

  async function prepare({ workspaceId, sourceDraftId, platform }) {
    const scope = adaptationScope(platform);
    const sourceDraft = await draftStore.get(workspaceId, sourceDraftId);
    if (sourceDraft.platform !== 'WECHAT' || sourceDraft.status !== 'READY' || !sourceDraft.currentVersionId) {
      throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '请先完成公众号母稿，再生成平台草稿。');
    }
    const versions = await draftStore.versions(workspaceId, sourceDraftId);
    const source = versions.find(({ id }) => id === sourceDraft.currentVersionId);
    if (!source || source.platform !== 'WECHAT' || !String(source.body ?? '').trim()) {
      throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '公众号当前完成版本不存在或已经变化。');
    }
    if (typeof resolveTaskRoute !== 'function') throw new TypeError('草稿适配服务缺少任务策略解析器。');
    const route = await resolveTaskRoute(workspaceId, scope, platform === 'XIAOHONGSHU' ? '小红书内容派生' : '微博内容派生');
    const policy = {
      scope,
      provider: route.provider,
      connectionId: route.connectionId ?? null,
      model: route.model,
      promptVersion: DRAFT_ADAPTATION_PROMPT_VERSION,
    };
    const snapshot = {
      draftId: sourceDraftId,
      projectId: sourceDraft.projectId,
      platform,
      sourceDraftVersionId: source.id,
      source,
      strategy: adaptationStrategy(platform),
      policy,
    };
    const input = { route: { provider: route.provider, connectionId: route.connectionId ?? null, model: route.model } };
    const created = await query(`INSERT INTO generation_runs
      (workspace_id, skill_version_id, status, source_snapshot_json, input_json, model, prompt_version, estimated_cost)
      VALUES ($1, '${DRAFT_ADAPTATION_SKILL_VERSION}', 'DRAFT', $2, $3, $4, $5, 'null'::jsonb)
      RETURNING id, status, created_at`, [workspaceId, JSON.stringify(snapshot), JSON.stringify(input), route.model, DRAFT_ADAPTATION_PROMPT_VERSION]);
    return runView(created.rows[0], {
      platform,
      sourceDraftVersionId: source.id,
      sourceAssetCount: source.assets.length,
      policy,
    });
  }

  async function get({ workspaceId, runId }) {
    const result = await query(`SELECT run.id, run.status, run.created_at, run.error,
        job.id AS job_id, job.result_json
      FROM generation_runs run
      LEFT JOIN LATERAL (
        SELECT id, result_json FROM jobs
        WHERE workspace_id = run.workspace_id AND job_type = 'DRAFT_ADAPTATION'
          AND payload_json->>'runId' = run.id::text
        ORDER BY created_at DESC LIMIT 1
      ) job ON true
      WHERE run.id = $1 AND run.workspace_id = $2
        AND run.skill_version_id = '${DRAFT_ADAPTATION_SKILL_VERSION}'`, [runId, workspaceId]);
    if (!result.rowCount) throw businessError(404, 'DRAFT_ADAPTATION_RUN_NOT_FOUND', '没有找到这项平台适配任务。');
    const row = result.rows[0];
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      jobId: row.job_id ?? undefined,
      error: row.error ?? undefined,
      result: row.result_json ?? undefined,
    };
  }

  async function confirm({ workspaceId, runId }) {
    const prepared = await transaction(async (client) => {
      const updated = await client.query(`UPDATE generation_runs SET status = 'QUEUED'
        WHERE id = $1 AND workspace_id = $2 AND skill_version_id = '${DRAFT_ADAPTATION_SKILL_VERSION}'
          AND status = 'DRAFT' AND source_snapshot_json->>'platform' IN ('XIAOHONGSHU', 'WEIBO')
        RETURNING *`, [runId, workspaceId]);
      if (!updated.rowCount) throw businessError(409, 'DRAFT_ADAPTATION_RUN_NOT_CONFIRMABLE', '这项平台适配任务当前不能确认。');
      const run = updated.rows[0];
      const snapshot = run.source_snapshot_json;
      const payload = { runId, draftId: snapshot.draftId, sourceDraftVersionId: snapshot.sourceDraftVersionId, platform: snapshot.platform };
      const inserted = await client.query("INSERT INTO jobs (workspace_id, job_type, payload_json) VALUES ($1, 'DRAFT_ADAPTATION', $2) RETURNING *", [workspaceId, JSON.stringify(payload)]);
      return { run, job: inserted.rows[0] };
    });
    try {
      if (typeof enqueue !== 'function') throw new TypeError('草稿适配服务缺少任务队列。');
      await enqueue(prepared.job);
    } catch (error) {
      const message = error instanceof Error ? error.message : '平台适配任务入队失败。';
      await query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3", [runId, message.slice(0, 2_000), workspaceId]);
      await query("UPDATE jobs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1", [prepared.job.id, message.slice(0, 2_000)]);
      throw error;
    }
    return { id: runId, status: 'QUEUED', jobId: prepared.job.id };
  }

  async function cancel({ workspaceId, runId }) {
    return transaction(async (client) => {
      const cancelled = await client.query(`UPDATE generation_runs SET status = 'CANCELLED', completed_at = now()
        WHERE id = $1 AND workspace_id = $2 AND skill_version_id = '${DRAFT_ADAPTATION_SKILL_VERSION}'
          AND status IN ('DRAFT', 'QUEUED') RETURNING id, status`, [runId, workspaceId]);
      if (!cancelled.rowCount) throw businessError(409, 'DRAFT_ADAPTATION_RUN_NOT_CANCELLABLE', '这项平台适配任务当前不能取消。');
      await client.query(`UPDATE jobs SET status = 'CANCELLED', completed_at = now()
        WHERE workspace_id = $1 AND job_type = 'DRAFT_ADAPTATION' AND status = 'PENDING'
          AND payload_json->>'runId' = $2`, [workspaceId, runId]);
      return cancelled.rows[0];
    });
  }

  async function execute({ workspaceId, jobId, runId }) {
    const startedAt = Date.now();
    let route;
    let scope;
    let inputTokens;
    let outputTokens;
    try {
      const result = await query(`SELECT id, source_snapshot_json, input_json FROM generation_runs
        WHERE id = $1 AND workspace_id = $2 AND skill_version_id = '${DRAFT_ADAPTATION_SKILL_VERSION}' AND status = 'QUEUED'`, [runId, workspaceId]);
      if (!result.rowCount) throw businessError(409, 'DRAFT_ADAPTATION_RUN_NOT_EXECUTABLE', '这项平台适配任务当前不能执行。');
      const run = result.rows[0];
      const snapshot = run.source_snapshot_json;
      scope = adaptationScope(snapshot.platform);
      if (snapshot.policy?.scope !== scope || snapshot.source?.id !== snapshot.sourceDraftVersionId || snapshot.source?.platform !== 'WECHAT') {
        throw businessError(409, 'DRAFT_ADAPTATION_SNAPSHOT_INVALID', '平台适配任务的来源或策略快照无效。');
      }
      route = run.input_json?.route;
      if (!route || route.provider !== snapshot.policy.provider || route.model !== snapshot.policy.model || (route.connectionId ?? null) !== snapshot.policy.connectionId) {
        throw businessError(409, 'DRAFT_ADAPTATION_SNAPSHOT_INVALID', '平台适配任务的模型路由快照无效。');
      }
      const currentSource = await draftStore.get(workspaceId, snapshot.draftId);
      if (currentSource.platform !== 'WECHAT' || currentSource.status !== 'READY' || currentSource.currentVersionId !== snapshot.sourceDraftVersionId) {
        throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '公众号来源版本已变化，请基于当前完成版本重新生成。');
      }
      await query("UPDATE generation_runs SET status = 'RUNNING', started_at = now() WHERE id = $1 AND workspace_id = $2 AND status = 'QUEUED'", [runId, workspaceId]);
      if (typeof runTextTask !== 'function') throw new TypeError('草稿适配服务缺少文本模型执行器。');
      const prompt = buildAdaptationPrompt(snapshot);
      const modelResult = await runTextTask({ workspaceId, route, system: prompt.system, message: prompt.message });
      inputTokens = modelResult.inputTokens ?? null;
      outputTokens = modelResult.outputTokens ?? null;
      const sourceAssetIds = snapshot.source.assets.map(({ assetId }) => assetId);
      const output = parseAdaptationOutput(modelResult.content, snapshot.platform, sourceAssetIds);
      return transaction(async (client) => {
        const active = await client.query("SELECT id FROM generation_runs WHERE id = $1 AND workspace_id = $2 AND status = 'RUNNING' FOR UPDATE", [runId, workspaceId]);
        if (!active.rowCount) throw businessError(409, 'DRAFT_ADAPTATION_RUN_INTERRUPTED', '平台适配任务已取消或中断。');
        const target = await draftStore.createDerivedWorkingCopy(workspaceId, snapshot.projectId, snapshot.platform, snapshot.sourceDraftVersionId, client);
        const patched = await draftStore.patchWorkingCopy(workspaceId, target.id, {
          revision: target.revision,
          title: output.title,
          body: output.body,
          visualPlan: { adaptation: { promptVersion: DRAFT_ADAPTATION_PROMPT_VERSION, imageSuggestions: output.imageSuggestions } },
        }, client);
        const sourceAssets = new Map(snapshot.source.assets.map((asset) => [asset.assetId, asset]));
        const selectedAssets = output.imageSuggestions.flatMap(({ sourceAssetId }) => sourceAssetId ? [{ assetId: sourceAssetId, role: sourceAssets.get(sourceAssetId)?.role ?? 'BODY' }] : []);
        const savedDraft = await draftStore.replaceWorkingAssets(workspaceId, target.id, { revision: patched.revision, assets: selectedAssets }, client);
        await client.query("UPDATE generation_runs SET status = 'SUCCEEDED', output_json = $2, usage_json = $3, completed_at = now() WHERE id = $1", [runId, JSON.stringify(output), JSON.stringify({ inputTokens, outputTokens })]);
        await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [jobId, JSON.stringify({ draftId: savedDraft.id, platform: snapshot.platform })]);
        await client.query(`INSERT INTO api_usage_logs
          (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens)
          VALUES ($1, $2, $3, $4, $5, 'SUCCESS', $6, $7, $8)`, [workspaceId, jobId, route.provider, route.model, scope, Date.now() - startedAt, inputTokens, outputTokens]);
        return { draftId: savedDraft.id, platform: snapshot.platform };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '平台适配任务失败。';
      await transaction(async (client) => {
        await client.query("UPDATE generation_runs SET status = 'FAILED', error = $2, completed_at = now() WHERE id = $1 AND workspace_id = $3 AND status <> 'CANCELLED'", [runId, message.slice(0, 2_000), workspaceId]);
        if (scope) await client.query(`INSERT INTO api_usage_logs
          (workspace_id, job_id, provider, model, operation, status, duration_ms, input_tokens, output_tokens, error)
          VALUES ($1, $2, $3, $4, $5, 'FAILED', $6, $7, $8, $9)`, [workspaceId, jobId, route?.provider ?? 'UNKNOWN', route?.model ?? null, scope, Date.now() - startedAt, inputTokens, outputTokens, message.slice(0, 2_000)]);
      });
      throw error;
    }
  }

  return { prepare, get, confirm, cancel, execute };
}

module.exports = {
  DRAFT_ADAPTATION_PROMPT_VERSION,
  DRAFT_ADAPTATION_SKILL_VERSION,
  adaptationScope,
  adaptationStrategy,
  buildAdaptationPrompt,
  createDraftAdaptationService,
  parseAdaptationOutput,
};
