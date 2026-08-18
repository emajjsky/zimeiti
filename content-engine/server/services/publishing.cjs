const { createHash } = require('node:crypto');
const { businessError } = require('./business-errors.cjs');

const SUPPORTED_PLATFORMS = new Set(['WECHAT', 'XIAOHONGSHU', 'WEIBO']);

function accountView(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    name: row.name,
    externalAccountLabel: row.external_account_label,
    mode: row.mode,
    status: row.status,
    capabilities: row.capabilities_json ?? {},
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskView(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    draftVersionId: row.draft_version_id ?? null,
    platform: row.platform,
    mode: row.mode,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    packageAssetId: row.package_asset_id ?? null,
    externalDraftId: row.external_draft_id ?? null,
    responseSummary: row.response_summary_json ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    manuallyConfirmedBy: row.manually_confirmed_by ?? null,
    manuallyConfirmedAt: row.manually_confirmed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function metricView(row) {
  if (!row?.metric_id) return null;
  const optionalCount = (value) => value === null || value === undefined ? null : Number(value);
  return {
    id: row.metric_id,
    workspaceId: row.workspace_id,
    publicationId: row.id,
    dataDate: row.metric_data_date ?? row.captured_at?.slice(0, 10) ?? null,
    capturedAt: row.metric_captured_at,
    source: row.metric_source,
    checkpoint: row.metric_checkpoint ?? 'CUSTOM',
    exposureCount: optionalCount(row.metric_exposure_count),
    readCount: optionalCount(row.metric_read_count),
    playCount: optionalCount(row.metric_play_count),
    likeCount: optionalCount(row.metric_like_count),
    shareCount: optionalCount(row.metric_share_count),
    favoriteCount: optionalCount(row.metric_favorite_count),
    commentCount: optionalCount(row.metric_comment_count),
    followerDelta: optionalCount(row.metric_follower_delta),
    createdAt: row.metric_created_at,
  };
}

function retrospectiveView(row) {
  if (!row?.retrospective_id) return null;
  return {
    id: row.retrospective_id,
    workspaceId: row.workspace_id,
    publicationId: row.id,
    summary: row.retrospective_summary,
    highlights: row.retrospective_highlights_json ?? [],
    issues: row.retrospective_issues_json ?? [],
    nextActions: row.retrospective_next_actions_json ?? [],
    createdAt: row.retrospective_created_at,
    updatedAt: row.retrospective_updated_at,
  };
}

function metricSnapshotView(row) {
  const optionalCount = (value) => value === null || value === undefined ? null : Number(value);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    publicationId: row.publication_id,
    dataDate: row.data_date ?? row.captured_at?.slice(0, 10) ?? null,
    capturedAt: row.captured_at,
    source: row.source,
    checkpoint: row.checkpoint ?? 'CUSTOM',
    exposureCount: optionalCount(row.exposure_count),
    readCount: optionalCount(row.read_count),
    playCount: optionalCount(row.play_count),
    likeCount: optionalCount(row.like_count),
    shareCount: optionalCount(row.share_count),
    favoriteCount: optionalCount(row.favorite_count),
    commentCount: optionalCount(row.comment_count),
    followerDelta: optionalCount(row.follower_delta),
    createdAt: row.created_at,
  };
}

function publicationView(row) {
  const snapshots = Array.isArray(row.metric_snapshots_json) ? row.metric_snapshots_json : [];
  const captured = new Set(snapshots.map((snapshot) => snapshot.checkpoint));
  const publishedAt = new Date(row.published_at).getTime();
  const metricSchedule = [
    { checkpoint: 'D1', label: '发布后 24 小时', hours: 24 },
    { checkpoint: 'D3', label: '发布后 72 小时', hours: 72 },
    { checkpoint: 'D7', label: '发布后 7 天', hours: 168 },
  ].map(({ checkpoint, label, hours }) => {
    const dueAt = new Date(publishedAt + hours * 60 * 60 * 1000).toISOString();
    return { checkpoint, label, dueAt, status: captured.has(checkpoint) ? 'CAPTURED' : Date.now() >= Date.parse(dueAt) ? 'DUE' : 'UPCOMING' };
  });
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id ?? null,
    accountId: row.account_id,
    draftVersionId: row.draft_version_id,
    platform: row.platform,
    title: row.title,
    url: row.url,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accountName: row.account_name ?? null,
    projectTitle: row.project_title ?? null,
    latestMetrics: metricView(row),
    retrospective: retrospectiveView(row),
    metricSchedule,
  };
}

function readyDraftView(row) {
  const assets = Array.isArray(row.assets_json) ? row.assets_json : [];
  return {
    draft: {
      id: row.draft_id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      platform: row.platform,
      status: row.draft_status,
      revision: Number(row.revision),
      title: row.draft_title,
      body: row.draft_body,
      visualPlan: row.draft_visual_plan_json ?? {},
      layoutTemplateVersionId: row.draft_layout_template_version_id ?? null,
      sourceDraftVersionId: row.draft_source_draft_version_id ?? null,
      sourceStale: Boolean(row.source_stale),
      currentVersionId: row.current_version_id ?? null,
      assets: assets.map((asset) => ({
        id: asset.id,
        workspaceId: asset.workspace_id,
        draftId: asset.draft_id,
        draftVersionId: asset.draft_version_id,
        assetId: asset.asset_id,
        role: asset.role,
        sortOrder: Number(asset.sort_order),
        createdAt: asset.created_at,
      })).sort((left, right) => left.sortOrder - right.sortOrder),
      createdAt: row.draft_created_at,
      updatedAt: row.draft_updated_at,
    },
    version: {
      id: row.version_id,
      workspaceId: row.workspace_id,
      draftId: row.draft_id,
      platform: row.platform,
      versionNumber: Number(row.version_number),
      title: row.version_title,
      body: row.version_body,
      visualPlan: row.version_visual_plan_json ?? {},
      renderedHtml: row.rendered_html ?? null,
      layoutTemplateVersionId: row.version_layout_template_version_id ?? null,
      sourceDraftVersionId: row.version_source_draft_version_id ?? null,
      generationRunId: row.generation_run_id ?? null,
      assets: assets.map((asset) => ({
        id: asset.id,
        workspaceId: asset.workspace_id,
        draftId: asset.draft_id,
        draftVersionId: asset.draft_version_id,
        assetId: asset.asset_id,
        role: asset.role,
        sortOrder: Number(asset.sort_order),
        createdAt: asset.created_at,
      })).sort((left, right) => left.sortOrder - right.sortOrder),
      createdAt: row.version_created_at,
    },
    project: {
      id: row.project_id,
      title: row.project_title || row.version_title || row.draft_title || '未命名项目',
    },
  };
}

function packageFromReadyDraft(readyDraft, account) {
  const cover = readyDraft.version.assets.find((asset) => asset.role === 'COVER') ?? readyDraft.version.assets[0] ?? null;
  return {
    schemaVersion: 1,
    platform: readyDraft.version.platform,
    account: { id: account.id, name: account.name, mode: account.mode, externalAccountLabel: account.externalAccountLabel },
    project: readyDraft.project,
    draftId: readyDraft.draft.id,
    draftVersionId: readyDraft.version.id,
    versionNumber: readyDraft.version.versionNumber,
    title: readyDraft.version.title,
    body: readyDraft.version.body,
    html: readyDraft.version.renderedHtml || readyDraft.version.body,
    coverAssetId: cover?.assetId ?? null,
    assets: readyDraft.version.assets.map(({ assetId, role, sortOrder }) => ({ assetId, role, sortOrder })),
    generatedAt: new Date().toISOString(),
    publishChecklist: [
      '复制标题与精排正文到公众号后台',
      '按正文占位顺序粘贴或上传图片',
      '在公众号后台保存草稿或发布后回填链接',
      '发布后录入阅读、点赞、分享、收藏等数据',
    ],
  };
}

function idempotencyKey({ workspaceId, accountId, draftVersionId, mode }) {
  return createHash('sha256').update([workspaceId, accountId, draftVersionId, mode].join(':')).digest('hex');
}

function createPublishingStore({ query, transaction, encryptSecret, decryptSecret, officialDraftClient, loadAsset, clipPublicLink } = {}) {
  if (typeof query !== 'function' || typeof transaction !== 'function') throw new TypeError('发布 Store 需要 query 和 transaction。');

  async function listAccounts(workspaceId) {
    const result = await query(`SELECT account.*
      FROM channel_accounts account
      WHERE account.workspace_id = $1
      ORDER BY CASE platform WHEN 'WECHAT' THEN 0 WHEN 'XIAOHONGSHU' THEN 1 ELSE 2 END, updated_at DESC`, [workspaceId]);
    return result.rows.map(accountView);
  }

  async function createAccount(workspaceId, userId, input) {
    if (!SUPPORTED_PLATFORMS.has(input.platform)) throw businessError(400, 'CHANNEL_PLATFORM_UNSUPPORTED', '暂不支持这个平台账号。');
    const mode = input.mode;
    const status = mode === 'MANUAL' ? 'MANUAL_READY' : 'DISCONNECTED';
    const capabilities = mode === 'MANUAL'
      ? { canCreateDraft: false, verifiedAt: null, reason: '手动发布包可用；官方草稿箱接口未接入。' }
      : { canCreateDraft: false, verifiedAt: null, reason: '需要完成公众号官方授权与接口验证。' };
    const result = await query(`INSERT INTO channel_accounts
      (workspace_id, platform, name, external_account_label, mode, status, capabilities_json, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (workspace_id, platform, name) DO UPDATE SET
        external_account_label = excluded.external_account_label,
        mode = excluded.mode,
        status = excluded.status,
        capabilities_json = excluded.capabilities_json,
        last_error = NULL,
        updated_at = now()
      RETURNING *`, [
      workspaceId,
      input.platform,
      input.name.trim(),
      input.externalAccountLabel?.trim() ?? '',
      mode,
      status,
      JSON.stringify(capabilities),
      userId,
    ]);
    return accountView(result.rows[0]);
  }

  async function archiveAccount(workspaceId, accountId) {
    const result = await query(`UPDATE channel_accounts
      SET status = CASE WHEN mode = 'MANUAL' THEN 'DISCONNECTED' ELSE 'DISCONNECTED' END,
        capabilities_json = jsonb_set(capabilities_json, '{reason}', to_jsonb('账号已停用。'::text), true),
        updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING *`, [workspaceId, accountId]);
    if (!result.rows.length) throw businessError(404, 'CHANNEL_ACCOUNT_NOT_FOUND', '没有找到这个平台账号。');
    return accountView(result.rows[0]);
  }

  function requireOfficialSupport() {
    if (!encryptSecret || !decryptSecret) throw businessError(500, 'OFFICIAL_CREDENTIAL_CRYPTO_MISSING', '官方账号凭证加密模块未配置。');
    if (!officialDraftClient) throw businessError(501, 'WECHAT_OFFICIAL_CLIENT_MISSING', '公众号官方接口客户端未接入。');
  }

  async function saveOfficialCredential(workspaceId, accountId, input) {
    requireOfficialSupport();
    const secret = JSON.stringify({ appId: input.appId.trim(), appSecret: input.appSecret.trim() });
    const result = await transaction(async (client) => {
      const account = await client.query('SELECT * FROM channel_accounts WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [workspaceId, accountId]);
      if (!account.rows.length) throw businessError(404, 'CHANNEL_ACCOUNT_NOT_FOUND', '没有找到这个平台账号。');
      if (account.rows[0].platform !== 'WECHAT') throw businessError(400, 'WECHAT_OFFICIAL_ONLY', '自动草稿箱目前只支持公众号账号。');
      await client.query(`INSERT INTO channel_account_credentials (workspace_id, account_id, encrypted_secret)
        VALUES ($1, $2, $3)
        ON CONFLICT (workspace_id, account_id) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, updated_at = now()`, [workspaceId, accountId, encryptSecret(secret)]);
      return client.query(`UPDATE channel_accounts SET
          mode = 'OFFICIAL',
          external_account_label = $3,
          status = 'DISCONNECTED',
          capabilities_json = $4::jsonb,
          last_error = NULL,
          updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING *`, [workspaceId, accountId, input.appId.trim(), JSON.stringify({ canCreateDraft: false, verifiedAt: null, reason: 'AppSecret 已保存，请测试连接。' })]);
    });
    return accountView(result.rows[0]);
  }

  async function officialCredential(workspaceId, accountId, client = { query }) {
    if (!decryptSecret) throw businessError(500, 'OFFICIAL_CREDENTIAL_CRYPTO_MISSING', '官方账号凭证解密模块未配置。');
    const result = await client.query('SELECT encrypted_secret FROM channel_account_credentials WHERE workspace_id = $1 AND account_id = $2', [workspaceId, accountId]);
    if (!result.rows.length) throw businessError(409, 'WECHAT_OFFICIAL_CREDENTIAL_MISSING', '请先保存公众号 AppID/AppSecret。');
    try {
      const parsed = JSON.parse(decryptSecret(result.rows[0].encrypted_secret));
      if (!parsed.appId || !parsed.appSecret) throw new Error('missing fields');
      return parsed;
    } catch {
      throw businessError(500, 'WECHAT_OFFICIAL_CREDENTIAL_INVALID', '公众号凭证无法解密，请重新保存 AppSecret。');
    }
  }

  async function testOfficialCredential(workspaceId, accountId) {
    requireOfficialSupport();
    const credential = await officialCredential(workspaceId, accountId);
    try {
      await officialDraftClient.testCredential(credential);
      const result = await query(`UPDATE channel_accounts SET
          mode = 'OFFICIAL',
          status = 'CONNECTED',
          capabilities_json = $3::jsonb,
          last_error = NULL,
          updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING *`, [workspaceId, accountId, JSON.stringify({ canCreateDraft: true, verifiedAt: new Date().toISOString(), reason: '官方接口已验证，可自动导入公众号草稿箱。' })]);
      if (!result.rows.length) throw businessError(404, 'CHANNEL_ACCOUNT_NOT_FOUND', '没有找到这个平台账号。');
      return accountView(result.rows[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '官方接口测试失败。';
      const result = await query(`UPDATE channel_accounts SET
          status = 'ERROR',
          capabilities_json = jsonb_set(capabilities_json, '{reason}', to_jsonb($3::text), true),
          last_error = $3,
          updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING *`, [workspaceId, accountId, message.slice(0, 1000)]);
      if (error?.statusCode) throw error;
      throw businessError(502, 'WECHAT_OFFICIAL_CREDENTIAL_TEST_FAILED', message, result.rows[0] ? { account: accountView(result.rows[0]) } : undefined);
    }
  }

  async function readyDrafts(workspaceId) {
    const result = await readyDraftRows({ query }, workspaceId);
    return result.rows.map(readyDraftView);
  }

  async function findReadyDraftByVersion(client, workspaceId, draftVersionId) {
    const result = await readyDraftRows(client, workspaceId, draftVersionId);
    if (!result.rows.length) throw businessError(404, 'PUBLISH_DRAFT_VERSION_NOT_READY', '没有找到可发布的完成版本，请先完成草稿。');
    return readyDraftView(result.rows[0]);
  }

  async function readyDraftRows(client, workspaceId, draftVersionId = null) {
    const values = [workspaceId];
    const versionFilter = draftVersionId ? 'AND version.id = $2' : '';
    if (draftVersionId) values.push(draftVersionId);
    return client.query(`SELECT
        project.project_json->>'title' AS project_title,
        draft.id AS draft_id,
        draft.workspace_id,
        draft.project_id,
        draft.platform,
        draft.status AS draft_status,
        draft.revision,
        draft.title AS draft_title,
        draft.body AS draft_body,
        draft.visual_plan_json AS draft_visual_plan_json,
        draft.layout_template_version_id AS draft_layout_template_version_id,
        draft.source_draft_version_id AS draft_source_draft_version_id,
        draft.source_stale,
        draft.current_version_id,
        draft.created_at AS draft_created_at,
        draft.updated_at AS draft_updated_at,
        version.id AS version_id,
        version.version_number,
        version.title AS version_title,
        version.body AS version_body,
        version.visual_plan_json AS version_visual_plan_json,
        version.rendered_html,
        version.layout_template_version_id AS version_layout_template_version_id,
        version.source_draft_version_id AS version_source_draft_version_id,
        version.generation_run_id,
        version.created_at AS version_created_at,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(asset) ORDER BY asset.sort_order)
          FROM content_draft_assets asset
          WHERE asset.workspace_id = version.workspace_id AND asset.draft_version_id = version.id
        ), '[]'::jsonb) AS assets_json
      FROM content_drafts draft
      JOIN content_projects project ON project.workspace_id = draft.workspace_id AND project.project_id = draft.project_id
      JOIN content_draft_versions version ON version.workspace_id = draft.workspace_id AND version.id = draft.current_version_id
      WHERE draft.workspace_id = $1 AND draft.status = 'READY' ${versionFilter}
      ORDER BY version.created_at DESC, draft.updated_at DESC`, values);
  }

  async function createManualPackage(workspaceId, userId, input) {
    return transaction(async (client) => {
      const accountResult = await client.query('SELECT * FROM channel_accounts WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [workspaceId, input.accountId]);
      if (!accountResult.rows.length) throw businessError(404, 'CHANNEL_ACCOUNT_NOT_FOUND', '没有找到这个平台账号。');
      const account = accountView(accountResult.rows[0]);
      if (account.mode !== 'MANUAL') throw businessError(409, 'CHANNEL_ACCOUNT_REQUIRES_OFFICIAL_API', '官方账号需要完成接口接入后才能发送草稿箱。');
      const readyDraft = await findReadyDraftByVersion(client, workspaceId, input.draftVersionId);
      if (readyDraft.version.platform !== account.platform) throw businessError(400, 'PUBLISH_PLATFORM_MISMATCH', '账号平台和草稿平台不一致。');
      const summary = packageFromReadyDraft(readyDraft, account);
      const key = idempotencyKey({ workspaceId, accountId: account.id, draftVersionId: readyDraft.version.id, mode: 'MANUAL' });
      const result = await client.query(`INSERT INTO platform_draft_tasks
        (workspace_id, account_id, draft_version_id, platform, mode, status, idempotency_key, response_summary_json, requested_by)
        VALUES ($1, $2, $3, $4, 'MANUAL', 'MANUAL_PENDING', $5, $6::jsonb, $7)
        ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
          response_summary_json = excluded.response_summary_json,
          updated_at = now()
        RETURNING *`, [
        workspaceId,
        account.id,
        readyDraft.version.id,
        readyDraft.version.platform,
        key,
        JSON.stringify(summary),
        userId,
      ]);
      return { task: taskView(result.rows[0]), package: summary };
    });
  }

  async function createOfficialDraft(workspaceId, userId, input) {
    requireOfficialSupport();
    if (typeof loadAsset !== 'function') throw businessError(500, 'PUBLISH_ASSET_LOADER_MISSING', '发布素材读取器未配置。');
    const accountResult = await query('SELECT * FROM channel_accounts WHERE workspace_id = $1 AND id = $2', [workspaceId, input.accountId]);
    if (!accountResult.rows.length) throw businessError(404, 'CHANNEL_ACCOUNT_NOT_FOUND', '没有找到这个平台账号。');
    const account = accountView(accountResult.rows[0]);
    if (account.mode !== 'OFFICIAL') throw businessError(409, 'CHANNEL_ACCOUNT_REQUIRES_MANUAL_PACKAGE', '手动账号只能生成发布包，不能自动导入草稿箱。');
    if (account.platform !== 'WECHAT') throw businessError(400, 'WECHAT_OFFICIAL_ONLY', '自动导入草稿箱目前只支持公众号。');
    const credential = await officialCredential(workspaceId, account.id);
    const readyDraft = await findReadyDraftByVersion({ query }, workspaceId, input.draftVersionId);
    if (readyDraft.version.platform !== account.platform) throw businessError(400, 'PUBLISH_PLATFORM_MISMATCH', '账号平台和草稿平台不一致。');
    const summary = packageFromReadyDraft(readyDraft, account);
    const key = idempotencyKey({ workspaceId, accountId: account.id, draftVersionId: readyDraft.version.id, mode: 'OFFICIAL_API' });
    const running = await query(`INSERT INTO platform_draft_tasks
      (workspace_id, account_id, draft_version_id, platform, mode, status, idempotency_key, response_summary_json, requested_by, started_at)
      VALUES ($1, $2, $3, $4, 'OFFICIAL_API', 'RUNNING', $5, $6::jsonb, $7, now())
      ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
        status = 'RUNNING',
        error_code = NULL,
        error_message = NULL,
        response_summary_json = excluded.response_summary_json,
        started_at = now(),
        completed_at = NULL,
        updated_at = now()
      RETURNING *`, [
      workspaceId,
      account.id,
      readyDraft.version.id,
      readyDraft.version.platform,
      key,
      JSON.stringify(summary),
      userId,
    ]);
    const task = running.rows[0];
    try {
      const assets = await Promise.all(summary.assets.map(async (asset) => ({ ...asset, ...(await loadAsset(workspaceId, asset.assetId)) })));
      const draftResult = await officialDraftClient.createDraft({ credential, publishPackage: summary, assets });
      const updated = await query(`UPDATE platform_draft_tasks SET
          status = 'SUCCEEDED',
          external_draft_id = $3,
          response_summary_json = COALESCE(response_summary_json, '{}'::jsonb) || $4::jsonb,
          completed_at = now(),
          updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING *`, [workspaceId, task.id, draftResult.mediaId, JSON.stringify({ wechat: draftResult })]);
      return { task: taskView(updated.rows[0]), package: summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入公众号草稿箱失败。';
      const code = error?.code || 'WECHAT_OFFICIAL_DRAFT_FAILED';
      await query(`UPDATE platform_draft_tasks SET
          status = 'FAILED',
          error_code = $3,
          error_message = $4,
          completed_at = now(),
          updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, task.id, code, message.slice(0, 2000)]);
      throw error?.statusCode ? error : businessError(502, code, message);
    }
  }

  async function listTasks(workspaceId) {
    const result = await query(`SELECT task.*, account.name AS account_name, project.project_json->>'title' AS project_title, version.title AS draft_title
      FROM platform_draft_tasks task
      JOIN channel_accounts account ON account.workspace_id = task.workspace_id AND account.id = task.account_id
      JOIN content_draft_versions version ON version.workspace_id = task.workspace_id AND version.id = task.draft_version_id
      JOIN content_drafts draft ON draft.workspace_id = version.workspace_id AND draft.id = version.draft_id
      JOIN content_projects project ON project.workspace_id = draft.workspace_id AND project.project_id = draft.project_id
      WHERE task.workspace_id = $1
      ORDER BY task.updated_at DESC`, [workspaceId]);
    return result.rows.map((row) => ({
      ...taskView(row),
      accountName: row.account_name,
      projectTitle: row.project_title,
      draftTitle: row.draft_title,
    }));
  }

  async function registerPublication(workspaceId, userId, taskId, input) {
    const url = String(input?.url ?? '').trim();
    if (!url) throw businessError(400, 'PUBLICATION_URL_REQUIRED', '请填写已发布文章的公开链接。');
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw businessError(400, 'PUBLICATION_URL_INVALID', '文章链接格式不正确。');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw businessError(400, 'PUBLICATION_URL_INVALID', '文章链接必须使用 HTTP 或 HTTPS。');
    if (typeof clipPublicLink !== 'function') throw businessError(500, 'PUBLICATION_METADATA_READER_MISSING', '文章链接读取器未配置。');
    let metadata;
    try {
      metadata = await clipPublicLink(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取公开文章信息。';
      throw businessError(422, 'PUBLICATION_METADATA_READ_FAILED', message);
    }
    const publishedAt = metadata?.publishedAt ?? null;
    if (!publishedAt) throw businessError(422, 'PUBLICATION_PUBLISHED_AT_NOT_FOUND', '无法从公开文章链接读取发布时间，请确认链接指向已发布文章。');
    const registration = await transaction(async (client) => {
      const taskResult = await client.query(`SELECT task.*, version.title
        FROM platform_draft_tasks task
        JOIN content_draft_versions version ON version.workspace_id = task.workspace_id AND version.id = task.draft_version_id
        WHERE task.workspace_id = $1 AND task.id = $2 FOR UPDATE`, [workspaceId, taskId]);
      if (!taskResult.rows.length) throw businessError(404, 'PUBLISH_TASK_NOT_FOUND', '没有找到这条发布任务。');
      const task = taskResult.rows[0];
      const canRegister = task.mode === 'MANUAL'
        ? ['MANUAL_PENDING', 'MANUAL_CONFIRMED'].includes(task.status)
        : task.mode === 'OFFICIAL_API' && task.status === 'SUCCEEDED';
      if (!canRegister) throw businessError(409, 'PUBLISH_TASK_NOT_REGISTERABLE', '这条任务当前不能登记为已发布。');
      const nextStatus = task.mode === 'MANUAL' ? 'MANUAL_CONFIRMED' : task.status;
      const updated = await client.query(`UPDATE platform_draft_tasks
        SET status = $4,
          manually_confirmed_by = $3,
          manually_confirmed_at = now(),
          completed_at = CASE WHEN mode = 'MANUAL' THEN now() ELSE completed_at END,
          response_summary_json = COALESCE(response_summary_json, '{}'::jsonb) || $5::jsonb,
          updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING *`, [workspaceId, taskId, userId, nextStatus, JSON.stringify({ publishedUrl: url, publishedAt, confirmedNote: input.note ?? '', publicationRegistered: true })]);
      const publication = await client.query(`INSERT INTO publications
        (workspace_id, task_id, account_id, draft_version_id, platform, title, url, published_at, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9)
        ON CONFLICT (workspace_id, task_id) DO UPDATE SET
          url = excluded.url,
          published_at = excluded.published_at,
          updated_at = now()
        RETURNING *`, [workspaceId, taskId, task.account_id, task.draft_version_id, task.platform, metadata.title || task.title || '', url, publishedAt, userId]);
      return { task: taskView(updated.rows[0]), publication: publicationView(publication.rows[0]) };
    });
    if (metadata.metrics) {
      registration.publication.latestMetrics = await insertMetricSnapshot(workspaceId, userId, registration.publication.id, {
        dataDate: publishedAt.slice(0, 10),
        capturedAt: new Date().toISOString(),
        checkpoint: 'CUSTOM',
        ...metadata.metrics,
      }, 'PUBLIC_PAGE');
    }
    return registration;
  }

  async function registerStandalonePublication(workspaceId, userId, input) {
    const url = String(input?.url ?? '').trim();
    if (!url) throw businessError(400, 'PUBLICATION_URL_REQUIRED', '请填写已发布文章的公开链接。');
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw businessError(400, 'PUBLICATION_URL_INVALID', '文章链接格式不正确。');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw businessError(400, 'PUBLICATION_URL_INVALID', '文章链接必须使用 HTTP 或 HTTPS。');
    }
    if (typeof clipPublicLink !== 'function') throw businessError(500, 'PUBLICATION_METADATA_READER_MISSING', '文章链接读取器未配置。');
    let metadata;
    try {
      metadata = await clipPublicLink(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取公开文章信息。';
      throw businessError(422, 'PUBLICATION_METADATA_READ_FAILED', message);
    }
    if (!metadata?.publishedAt) throw businessError(422, 'PUBLICATION_PUBLISHED_AT_NOT_FOUND', '无法从公开文章链接读取发布时间，请确认链接指向已发布文章。');

    const registration = await transaction(async (client) => {
      const accountQuery = input?.accountId
        ? await client.query('SELECT * FROM channel_accounts WHERE workspace_id = $1 AND id = $2', [workspaceId, input.accountId])
        : await client.query(`SELECT * FROM channel_accounts
            WHERE workspace_id = $1 AND platform = 'WECHAT' AND status <> 'DISCONNECTED'
            ORDER BY updated_at DESC LIMIT 1`, [workspaceId]);
      if (!accountQuery.rows.length) throw businessError(409, 'PUBLICATION_ACCOUNT_REQUIRED', '请先在账号设置中添加公众号账号，再登记已发布文章。');
      const account = accountQuery.rows[0];
      if (account.platform !== 'WECHAT') throw businessError(400, 'PUBLICATION_PLATFORM_UNSUPPORTED', '当前复盘台账仅支持微信公众号文章。');
      if (account.status === 'DISCONNECTED') throw businessError(409, 'PUBLICATION_ACCOUNT_DISCONNECTED', '当前公众号账号已停用，请先在账号设置中恢复或重新添加。');
      const result = await client.query(`INSERT INTO publications
        (workspace_id, task_id, account_id, draft_version_id, platform, title, url, published_at, created_by)
        VALUES ($1, NULL, $2, NULL, 'WECHAT', $3, $4, $5, $6)
        ON CONFLICT (workspace_id, url) WHERE url <> '' DO UPDATE SET
          account_id = excluded.account_id,
          title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE publications.title END,
          published_at = excluded.published_at,
          updated_at = now()
        RETURNING *`, [workspaceId, account.id, metadata.title || '', url, metadata.publishedAt, userId]);
      return { publication: publicationView({ ...result.rows[0], account_name: account.name }) };
    });
    if (metadata.metrics) {
      registration.publication.latestMetrics = await insertMetricSnapshot(workspaceId, userId, registration.publication.id, {
        dataDate: metadata.publishedAt.slice(0, 10),
        capturedAt: new Date().toISOString(),
        checkpoint: 'CUSTOM',
        ...metadata.metrics,
      }, 'PUBLIC_PAGE');
    }
    return registration;
  }

  const manualConfirm = registerPublication;

  async function listPublications(workspaceId) {
    const result = await query(`SELECT publication.*,
        account.name AS account_name,
        project.project_json->>'title' AS project_title,
        metric.id AS metric_id,
        metric.data_date AS metric_data_date,
        metric.captured_at AS metric_captured_at,
        metric.source AS metric_source,
        metric.checkpoint AS metric_checkpoint,
        metric.exposure_count AS metric_exposure_count,
        metric.read_count AS metric_read_count,
        metric.play_count AS metric_play_count,
        metric.like_count AS metric_like_count,
        metric.share_count AS metric_share_count,
        metric.favorite_count AS metric_favorite_count,
        metric.comment_count AS metric_comment_count,
        metric.follower_delta AS metric_follower_delta,
        metric.created_at AS metric_created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('checkpoint', history.checkpoint, 'capturedAt', history.captured_at)
          ORDER BY history.captured_at DESC, history.created_at DESC)
          FROM metric_snapshots history
          WHERE history.workspace_id = publication.workspace_id AND history.publication_id = publication.id), '[]'::jsonb) AS metric_snapshots_json,
        retrospective.id AS retrospective_id,
        retrospective.summary AS retrospective_summary,
        retrospective.highlights_json AS retrospective_highlights_json,
        retrospective.issues_json AS retrospective_issues_json,
        retrospective.next_actions_json AS retrospective_next_actions_json,
        retrospective.created_at AS retrospective_created_at,
        retrospective.updated_at AS retrospective_updated_at
      FROM publications publication
      JOIN channel_accounts account ON account.workspace_id = publication.workspace_id AND account.id = publication.account_id
      LEFT JOIN content_draft_versions version ON version.workspace_id = publication.workspace_id AND version.id = publication.draft_version_id
      LEFT JOIN content_drafts draft ON draft.workspace_id = version.workspace_id AND draft.id = version.draft_id
      LEFT JOIN content_projects project ON project.workspace_id = draft.workspace_id AND project.project_id = draft.project_id
      LEFT JOIN LATERAL (
        SELECT * FROM metric_snapshots metric
        WHERE metric.workspace_id = publication.workspace_id AND metric.publication_id = publication.id
        ORDER BY metric.captured_at DESC, metric.created_at DESC
        LIMIT 1
      ) metric ON true
      LEFT JOIN retrospectives retrospective ON retrospective.workspace_id = publication.workspace_id AND retrospective.publication_id = publication.id
      WHERE publication.workspace_id = $1
      ORDER BY publication.published_at DESC`, [workspaceId]);
    return result.rows.map(publicationView);
  }

  async function deletePublication(workspaceId, publicationId) {
    const result = await query(`DELETE FROM publications
      WHERE workspace_id = $1 AND id = $2
      RETURNING id`, [workspaceId, publicationId]);
    if (!result.rows.length) throw businessError(404, 'PUBLICATION_NOT_FOUND', '没有找到这篇复盘文章。');
    return { publicationId: result.rows[0].id };
  }

  async function insertMetricSnapshot(workspaceId, userId, publicationId, input, source) {
    const result = await query(`INSERT INTO metric_snapshots
      (workspace_id, publication_id, data_date, captured_at, source, checkpoint, exposure_count, read_count, play_count, like_count, share_count, favorite_count, comment_count, follower_delta, raw_json, created_by)
      SELECT $1, publication.id, COALESCE($3::date, COALESCE($4::timestamptz, now())::date), COALESCE($4::timestamptz, now()), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
      FROM publications publication
      WHERE publication.workspace_id = $1 AND publication.id = $2
      RETURNING *`, [
      workspaceId,
      publicationId,
      input.dataDate ?? null,
      input.capturedAt ?? null,
      source,
      input.checkpoint ?? 'CUSTOM',
      input.exposureCount ?? null,
      input.readCount ?? null,
      input.playCount ?? null,
      input.likeCount ?? null,
      input.shareCount ?? null,
      input.favoriteCount ?? null,
      input.commentCount ?? null,
      input.followerDelta ?? null,
      JSON.stringify(input.raw ?? {}),
      userId,
    ]);
    if (!result.rows.length) throw businessError(404, 'PUBLICATION_NOT_FOUND', '没有找到这篇已发布文章。');
    return metricSnapshotView(result.rows[0]);
  }

  async function addMetricSnapshot(workspaceId, userId, publicationId, input) {
    return insertMetricSnapshot(workspaceId, userId, publicationId, input, 'MANUAL');
  }

  function normalizeArticleTitle(title) {
    return String(title ?? '').replace(/[\s\u3000]+/g, '').trim();
  }

  function resolveMetricCaptureInput(publication, input = {}) {
    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
    const safeCapturedAt = Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt;
    const publishedAt = publication?.published_at ? new Date(publication.published_at) : safeCapturedAt;
    const ageHours = Math.max(0, (safeCapturedAt.getTime() - publishedAt.getTime()) / 3_600_000);
    return {
      dataDate: input.dataDate ?? safeCapturedAt.toISOString().slice(0, 10),
      capturedAt: safeCapturedAt.toISOString(),
      checkpoint: input.checkpoint ?? (ageHours >= 168 ? 'D7' : ageHours >= 72 ? 'D3' : ageHours >= 24 ? 'D1' : 'CUSTOM'),
    };
  }

  async function syncPublicPageMetrics(workspaceId, userId, publicationId, input) {
    const result = await query(`SELECT id, url, published_at
      FROM publications
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, publicationId]);
    if (!result.rows.length) throw businessError(404, 'PUBLICATION_NOT_FOUND', '没有找到这篇已发布文章。');
    const publication = result.rows[0];
    if (!publication.url) throw businessError(422, 'PUBLICATION_URL_REQUIRED', '这篇文章没有公开链接，无法读取公开数据。');
    let metadata;
    try {
      metadata = await clipPublicLink(publication.url);
    } catch (error) {
      throw businessError(422, 'PUBLIC_PAGE_METRICS_READ_FAILED', error instanceof Error ? error.message : '读取公开文章页面失败。');
    }
    const metrics = metadata?.metrics;
    if (!metrics || !Object.entries(metrics).some(([key, value]) => key.endsWith('Count') && value !== null)) {
      throw businessError(422, 'PUBLIC_PAGE_METRICS_NOT_FOUND', '公开文章页面当前没有可读取的文章数据。');
    }
    const capture = resolveMetricCaptureInput(publication, input);
    return insertMetricSnapshot(workspaceId, userId, publicationId, {
      ...capture,
      exposureCount: metrics.exposureCount ?? null,
      readCount: metrics.readCount ?? null,
      playCount: metrics.playCount ?? null,
      likeCount: metrics.likeCount ?? null,
      shareCount: metrics.shareCount ?? null,
      favoriteCount: metrics.favoriteCount ?? null,
      commentCount: metrics.commentCount ?? null,
      followerDelta: metrics.followerDelta ?? null,
      raw: metrics.raw ?? metrics,
    }, 'PUBLIC_PAGE');
  }

  async function syncMetrics(workspaceId, userId, publicationId, input) {
    const accountResult = await query(`SELECT publication.platform, account.mode
      FROM publications publication
      JOIN channel_accounts account ON account.workspace_id = publication.workspace_id AND account.id = publication.account_id
      WHERE publication.workspace_id = $1 AND publication.id = $2`, [workspaceId, publicationId]);
    const account = accountResult.rows[0];
    if (account?.platform === 'WECHAT' && account.mode === 'OFFICIAL') {
      try { return await syncOfficialMetrics(workspaceId, userId, publicationId, input); }
      catch (officialError) {
        if (officialError?.code !== 'WECHAT_METRICS_ARTICLE_NOT_FOUND' && officialError?.code !== 'WECHAT_METRICS_ARTICLE_AMBIGUOUS') throw officialError;
      }
    }
    try {
      return await syncPublicPageMetrics(workspaceId, userId, publicationId, input);
    } catch (publicError) {
      try {
        return await syncOfficialMetrics(workspaceId, userId, publicationId, input);
      } catch (officialError) {
        if (officialError?.code === 'WECHAT_METRICS_OFFICIAL_ACCOUNT_REQUIRED' || officialError?.code === 'WECHAT_METRICS_SYNC_UNAVAILABLE') throw publicError;
        throw officialError;
      }
    }
  }

  async function syncMetricsForAll(workspaceId, userId, input) {
    const result = await query(`SELECT publication.id, publication.title, publication.platform, publication.url,
        account.name AS account_name, account.mode, account.status AS account_status
      FROM publications publication
      JOIN channel_accounts account ON account.workspace_id = publication.workspace_id AND account.id = publication.account_id
      WHERE publication.workspace_id = $1 AND publication.status = 'PUBLISHED' AND publication.url <> ''
      ORDER BY publication.published_at DESC`, [workspaceId]);
    const results = [];
    for (const publication of result.rows) {
      if (publication.account_status === 'DISCONNECTED') {
        results.push({ articleId: publication.id, title: publication.title, accountName: publication.account_name, status: 'SKIPPED', message: '当前账号已停用，请重新配置账号。' });
        continue;
      }
      try {
        const metric = await syncMetrics(workspaceId, userId, publication.id, input);
        results.push({ articleId: publication.id, title: publication.title, accountName: publication.account_name, status: 'SYNCED', metric });
      } catch (error) {
        results.push({ articleId: publication.id, title: publication.title, accountName: publication.account_name, status: 'FAILED', message: error instanceof Error ? error.message : '刷新文章数据失败。', code: error?.code ?? null });
      }
    }
    return {
      results,
      syncedCount: results.filter((item) => item.status === 'SYNCED').length,
      skippedCount: results.filter((item) => item.status === 'SKIPPED').length,
      failedCount: results.filter((item) => item.status === 'FAILED').length,
    };
  }

  async function syncOfficialMetrics(workspaceId, userId, publicationId, input) {
    if (!officialDraftClient?.articleSummary) throw businessError(501, 'WECHAT_METRICS_SYNC_UNAVAILABLE', '公众号文章数据同步能力尚未接入。');
    const publicationResult = await query(`SELECT publication.*, account.mode, account.platform
      FROM publications publication
      JOIN channel_accounts account ON account.workspace_id = publication.workspace_id AND account.id = publication.account_id
      WHERE publication.workspace_id = $1 AND publication.id = $2`, [workspaceId, publicationId]);
    if (!publicationResult.rows.length) throw businessError(404, 'PUBLICATION_NOT_FOUND', '没有找到这篇已发布文章。');
    const publication = publicationResult.rows[0];
    if (publication.platform !== 'WECHAT' || publication.mode !== 'OFFICIAL') throw businessError(409, 'WECHAT_METRICS_OFFICIAL_ACCOUNT_REQUIRED', '只有已接入公众号官方接口的账号才能同步文章数据；当前账号请手工回填。');
    const publicationTitle = normalizeArticleTitle(publication.title);
    if (!publicationTitle) throw businessError(409, 'WECHAT_METRICS_ARTICLE_TITLE_REQUIRED', '这篇发布记录没有文章标题，无法安全匹配微信数据，请先补充标题后再同步。');
    const credential = await officialCredential(workspaceId, publication.account_id);
    const capture = resolveMetricCaptureInput(publication, input);
    const apiDate = input.dataDate ?? new Date(publication.published_at).toISOString().slice(0, 10);
    const rows = await officialDraftClient.articleSummary({ credential, beginDate: apiDate, endDate: apiDate });
    const candidates = rows.filter((row) => normalizeArticleTitle(row.title) === publicationTitle);
    if (candidates.length !== 1) {
      throw businessError(409, candidates.length ? 'WECHAT_METRICS_ARTICLE_AMBIGUOUS' : 'WECHAT_METRICS_ARTICLE_NOT_FOUND', candidates.length ? '微信返回了多篇同名文章，无法安全匹配数据，请手工回填。' : '微信在该日期没有返回标题完全匹配的文章，请确认采集日期或手工回填。', { dataDate: input.dataDate, matchedCount: candidates.length });
    }
    const row = candidates[0];
    return insertMetricSnapshot(workspaceId, userId, publicationId, {
      ...capture,
      exposureCount: null,
      readCount: row.int_page_read_count ?? null,
      playCount: null,
      likeCount: row.like_count ?? null,
      shareCount: row.share_count ?? null,
      favoriteCount: row.add_to_fav_count ?? null,
      commentCount: row.comment_count ?? null,
      followerDelta: null,
      raw: row,
    }, 'OFFICIAL_API');
  }

  async function syncOfficialMetricsForAll(workspaceId, userId, input) {
    if (!officialDraftClient?.articleSummary) throw businessError(501, 'WECHAT_METRICS_SYNC_UNAVAILABLE', '公众号文章数据同步能力尚未接入。');
    const result = await query(`SELECT publication.id, publication.account_id, publication.title, publication.platform, account.mode, account.status AS account_status, account.name AS account_name
      FROM publications publication
      JOIN channel_accounts account ON account.workspace_id = publication.workspace_id AND account.id = publication.account_id
      WHERE publication.workspace_id = $1 AND publication.status = 'PUBLISHED'
      ORDER BY publication.published_at DESC`, [workspaceId]);
    const results = [];
    const officialPublicationsByAccount = new Map();
    for (const publication of result.rows) {
      if (publication.account_status === 'DISCONNECTED' || publication.platform !== 'WECHAT' || publication.mode !== 'OFFICIAL') {
        results.push({ articleId: publication.id, title: publication.title, accountName: publication.account_name, status: 'SKIPPED', message: publication.account_status === 'DISCONNECTED' ? '当前账号已停用，请重新配置账号' : '当前账号未接入公众号官方数据接口' });
        continue;
      }
      const grouped = officialPublicationsByAccount.get(publication.account_id) ?? [];
      grouped.push(publication);
      officialPublicationsByAccount.set(publication.account_id, grouped);
    }
    for (const [accountId, publications] of officialPublicationsByAccount) {
      try {
        const credential = await officialCredential(workspaceId, accountId);
        const rows = await officialDraftClient.articleSummary({ credential, beginDate: input.dataDate, endDate: input.dataDate });
        const articlesByTitle = new Map();
        for (const row of rows) {
          const title = normalizeArticleTitle(row.title);
          if (!title) continue;
          const matches = articlesByTitle.get(title) ?? [];
          matches.push(row);
          articlesByTitle.set(title, matches);
        }
        for (const publication of publications) {
          const candidates = articlesByTitle.get(normalizeArticleTitle(publication.title)) ?? [];
          if (candidates.length !== 1) {
            results.push({
              articleId: publication.id,
              title: publication.title,
              accountName: publication.account_name,
              status: 'FAILED',
              code: candidates.length ? 'WECHAT_METRICS_ARTICLE_AMBIGUOUS' : 'WECHAT_METRICS_ARTICLE_NOT_FOUND',
              message: candidates.length ? '微信公众号返回多篇同名文章，无法安全匹配数据' : '指定日期没有找到标题匹配的公众号文章',
            });
            continue;
          }
          const row = candidates[0];
          const metric = await insertMetricSnapshot(workspaceId, userId, publication.id, {
            dataDate: input.dataDate,
            capturedAt: input.capturedAt ?? new Date().toISOString(),
            exposureCount: null,
            readCount: row.int_page_read_count ?? null,
            playCount: null,
            likeCount: row.like_count ?? null,
            shareCount: row.share_count ?? null,
            favoriteCount: row.add_to_fav_count ?? null,
            commentCount: row.comment_count ?? null,
            followerDelta: null,
            raw: row,
            checkpoint: input.checkpoint ?? 'CUSTOM',
          }, 'OFFICIAL_API');
          results.push({ articleId: publication.id, title: publication.title, accountName: publication.account_name, status: 'SYNCED', metric });
        }
      } catch (error) {
        for (const publication of publications) {
          results.push({ articleId: publication.id, title: publication.title, accountName: publication.account_name, status: 'FAILED', message: error instanceof Error ? error.message : '同步失败', code: error?.code ?? null });
        }
      }
    }
    return {
      results,
      syncedCount: results.filter((item) => item.status === 'SYNCED').length,
      skippedCount: results.filter((item) => item.status === 'SKIPPED').length,
      failedCount: results.filter((item) => item.status === 'FAILED').length,
    };
  }

  async function listMetricSnapshots(workspaceId, publicationId) {
    const result = await query(`SELECT metric.*
      FROM metric_snapshots metric
      JOIN publications publication
        ON publication.workspace_id = metric.workspace_id AND publication.id = metric.publication_id
      WHERE metric.workspace_id = $1 AND metric.publication_id = $2
      ORDER BY captured_at DESC, created_at DESC`, [workspaceId, publicationId]);
    return result.rows.map(metricSnapshotView);
  }

  async function saveRetrospective(workspaceId, userId, publicationId, input) {
    const result = await query(`INSERT INTO retrospectives
      (workspace_id, publication_id, summary, highlights_json, issues_json, next_actions_json, created_by)
      SELECT $1, publication.id, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7
      FROM publications publication
      WHERE publication.workspace_id = $1 AND publication.id = $2
      ON CONFLICT (workspace_id, publication_id) DO UPDATE SET
        summary = excluded.summary,
        highlights_json = excluded.highlights_json,
        issues_json = excluded.issues_json,
        next_actions_json = excluded.next_actions_json,
        updated_at = now()
      RETURNING *`, [
      workspaceId,
      publicationId,
      input.summary ?? '',
      JSON.stringify(input.highlights ?? []),
      JSON.stringify(input.issues ?? []),
      JSON.stringify(input.nextActions ?? []),
      userId,
    ]);
    if (!result.rows.length) throw businessError(404, 'PUBLICATION_NOT_FOUND', '没有找到这篇已发布文章。');
    return {
      id: result.rows[0].id,
      workspaceId: result.rows[0].workspace_id,
      publicationId: result.rows[0].publication_id,
      summary: result.rows[0].summary,
      highlights: result.rows[0].highlights_json ?? [],
      issues: result.rows[0].issues_json ?? [],
      nextActions: result.rows[0].next_actions_json ?? [],
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  }

  return {
    listAccounts,
    createAccount,
    archiveAccount,
    saveOfficialCredential,
    testOfficialCredential,
    readyDrafts,
    createManualPackage,
    createOfficialDraft,
    listTasks,
    registerPublication,
    registerStandalonePublication,
    manualConfirm,
    listPublications,
    deletePublication,
    addMetricSnapshot,
    syncMetrics,
    syncMetricsForAll,
    syncOfficialMetrics,
    syncOfficialMetricsForAll,
    listMetricSnapshots,
    saveRetrospective,
  };
}

module.exports = { accountView, taskView, publicationView, createPublishingStore };
