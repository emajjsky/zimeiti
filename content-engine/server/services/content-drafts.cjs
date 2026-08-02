const { businessError } = require('./business-errors.cjs');

const SUPPORTED_PLATFORMS = new Set(['WECHAT', 'XIAOHONGSHU', 'WEIBO']);
const DERIVED_PLATFORMS = new Set(['XIAOHONGSHU', 'WEIBO']);
const IMAGE_LIMITS = Object.freeze({ WECHAT: 12, XIAOHONGSHU: 9, WEIBO: 9 });

function draftAssetView(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    draftId: row.draft_id,
    draftVersionId: row.draft_version_id ?? null,
    assetId: row.asset_id,
    role: row.role,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
  };
}

function draftView(row) {
  const assets = Array.isArray(row.assets_json) ? row.assets_json : [];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    platform: row.platform,
    status: row.status,
    revision: Number(row.revision),
    title: row.title,
    body: row.body,
    visualPlan: row.visual_plan_json ?? {},
    layoutTemplateVersionId: row.layout_template_version_id ?? null,
    sourceDraftVersionId: row.source_draft_version_id ?? null,
    sourceStale: Boolean(row.source_stale),
    currentVersionId: row.current_version_id ?? null,
    assets: assets.map(draftAssetView).sort((left, right) => left.sortOrder - right.sortOrder),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionView(row) {
  const assets = Array.isArray(row.assets_json) ? row.assets_json : [];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    draftId: row.draft_id,
    platform: row.platform,
    versionNumber: Number(row.version_number),
    title: row.title,
    body: row.body,
    visualPlan: row.visual_plan_json ?? {},
    renderedHtml: row.rendered_html ?? null,
    layoutTemplateVersionId: row.layout_template_version_id ?? null,
    sourceDraftVersionId: row.source_draft_version_id ?? null,
    generationRunId: row.generation_run_id ?? null,
    assets: assets.map(draftAssetView).sort((left, right) => left.sortOrder - right.sortOrder),
    createdAt: row.created_at,
  };
}

function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw businessError(400, 'DRAFT_PLATFORM_UNSUPPORTED', `不支持的平台：${platform}`);
}

function assertImageCount(platform, assets) {
  const limit = IMAGE_LIMITS[platform];
  if (assets.length > limit) throw businessError(400, 'DRAFT_IMAGE_LIMIT_EXCEEDED', `${platform} 最多允许 ${limit} 张图片。`, { platform, limit, actual: assets.length });
  const ids = assets.map(({ assetId }) => assetId);
  if (new Set(ids).size !== ids.length) throw businessError(400, 'DRAFT_ASSET_INVALID', '同一草稿不能重复选择同一张图片。');
}

const draftSelect = `SELECT draft.*,
  COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.sort_order) FILTER (WHERE item.id IS NOT NULL), '[]'::jsonb) AS assets_json
  FROM content_drafts draft
  LEFT JOIN content_draft_assets item
    ON item.workspace_id = draft.workspace_id AND item.draft_id = draft.id AND item.draft_version_id IS NULL`;

async function loadDraft(db, workspaceId, draftId, { forUpdate = false } = {}) {
  if (forUpdate) {
    const locked = await db.query(`SELECT draft.* FROM content_drafts draft
      WHERE draft.workspace_id = $1 AND draft.id = $2
      FOR UPDATE OF draft`, [workspaceId, draftId]);
    if (!locked.rows.length) throw businessError(404, 'DRAFT_NOT_FOUND', '没有找到这份草稿。');
    return locked.rows[0];
  }
  const result = await db.query(`${draftSelect}
    WHERE draft.workspace_id = $1 AND draft.id = $2
    GROUP BY draft.id`, [workspaceId, draftId]);
  if (!result.rows.length) throw businessError(404, 'DRAFT_NOT_FOUND', '没有找到这份草稿。');
  return result.rows[0];
}

function createContentDraftStore({ query, transaction, renderWechatDraft } = {}) {
  if (typeof query !== 'function' || typeof transaction !== 'function') throw new TypeError('草稿 Store 需要 query 和 transaction。');

  async function listProject(workspaceId, projectId) {
    const result = await query(`${draftSelect}
      WHERE draft.workspace_id = $1 AND draft.project_id = $2
      GROUP BY draft.id
      ORDER BY CASE draft.platform WHEN 'WECHAT' THEN 0 WHEN 'XIAOHONGSHU' THEN 1 ELSE 2 END`, [workspaceId, projectId]);
    return result.rows.map(draftView);
  }

  async function get(workspaceId, draftId) {
    return draftView(await loadDraft({ query }, workspaceId, draftId));
  }

  async function upsertWechat(workspaceId, projectId, input = {}, client = { query }) {
    const title = String(input.title ?? '');
    const body = String(input.body ?? '');
    const result = await client.query(`INSERT INTO content_drafts (workspace_id, project_id, platform, title, body)
      SELECT $1, project.project_id, 'WECHAT', $3, $4
      FROM content_projects project
      WHERE project.workspace_id = $1 AND project.project_id = $2
      ON CONFLICT (workspace_id, project_id, platform) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        status = 'EDITING',
        revision = content_drafts.revision + 1,
        updated_at = now()
      RETURNING *`, [workspaceId, projectId, title, body]);
    if (!result.rows.length) throw businessError(404, 'PROJECT_NOT_FOUND', '没有找到这个内容项目。');
    return draftView(result.rows[0]);
  }

  async function patchWorkingCopy(workspaceId, draftId, input, client = { query }) {
    const result = await client.query(`UPDATE content_drafts
      SET title = COALESCE($4, title),
        body = COALESCE($5, body),
        visual_plan_json = COALESCE($6::jsonb, visual_plan_json),
        layout_template_version_id = CASE WHEN $7::boolean THEN $8::uuid ELSE layout_template_version_id END,
        status = 'EDITING',
        revision = revision + 1,
        updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND revision = $3
      RETURNING *`, [
      workspaceId,
      draftId,
      input.revision,
      input.title ?? null,
      input.body ?? null,
      input.visualPlan === undefined ? null : JSON.stringify(input.visualPlan),
      Object.hasOwn(input, 'layoutTemplateVersionId'),
      input.layoutTemplateVersionId ?? null,
    ]);
    if (result.rows.length) return draftView(result.rows[0]);
    const existing = await client.query('SELECT id FROM content_drafts WHERE workspace_id = $1 AND id = $2', [workspaceId, draftId]);
    if (!existing.rows.length) throw businessError(404, 'DRAFT_NOT_FOUND', '没有找到这份草稿。');
    throw businessError(409, 'DRAFT_REVISION_CONFLICT', '草稿已在其他页面更新，请刷新后继续。');
  }

  async function replaceWorkingAssets(workspaceId, draftId, input, transactionClient = null) {
    const replace = async (client) => {
      const draft = await loadDraft(client, workspaceId, draftId, { forUpdate: true });
      if (Number(draft.revision) !== Number(input.revision)) throw businessError(409, 'DRAFT_REVISION_CONFLICT', '草稿已在其他页面更新，请刷新后继续。');
      assertImageCount(draft.platform, input.assets);
      const assetIds = input.assets.map(({ assetId }) => assetId);
      if (assetIds.length) {
        const valid = await client.query(`SELECT asset.id
          FROM workspace_assets asset
          JOIN project_asset_links link
            ON link.workspace_id = asset.workspace_id AND link.asset_id = asset.id
          WHERE asset.workspace_id = $1 AND link.project_id = $2
            AND asset.id = ANY($3::uuid[]) AND asset.kind = 'IMAGE' AND asset.status = 'ACTIVE'`, [workspaceId, draft.project_id, assetIds]);
        if (valid.rows.length !== assetIds.length) throw businessError(400, 'DRAFT_ASSET_INVALID', '草稿图片必须是当前项目中正常可用的图片素材。');
      }
      await client.query('DELETE FROM content_draft_assets WHERE workspace_id = $1 AND draft_id = $2 AND draft_version_id IS NULL', [workspaceId, draftId]);
      for (const [sortOrder, asset] of input.assets.entries()) {
        await client.query(`INSERT INTO content_draft_assets (workspace_id, draft_id, asset_id, role, sort_order)
          VALUES ($1, $2, $3, $4, $5)`, [workspaceId, draftId, asset.assetId, asset.role, sortOrder]);
      }
      const updated = await client.query(`UPDATE content_drafts
        SET revision = revision + 1, status = 'EDITING', updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND revision = $3
        RETURNING *`, [workspaceId, draftId, input.revision]);
      if (!updated.rows.length) throw businessError(409, 'DRAFT_REVISION_CONFLICT', '草稿已在其他页面更新，请刷新后继续。');
      updated.rows[0].assets_json = input.assets.map((asset, sortOrder) => ({
        id: null,
        workspace_id: workspaceId,
        draft_id: draftId,
        draft_version_id: null,
        asset_id: asset.assetId,
        role: asset.role,
        sort_order: sortOrder,
        created_at: null,
      }));
      return draftView(updated.rows[0]);
    };
    return transactionClient ? replace(transactionClient) : transaction(replace);
  }

  async function versions(workspaceId, draftId) {
    const result = await query(`SELECT version.*,
      COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.sort_order) FILTER (WHERE item.id IS NOT NULL), '[]'::jsonb) AS assets_json
      FROM content_draft_versions version
      JOIN content_drafts draft ON draft.workspace_id = version.workspace_id AND draft.id = version.draft_id
      LEFT JOIN content_draft_assets item
        ON item.workspace_id = version.workspace_id AND item.draft_version_id = version.id
      WHERE version.workspace_id = $1 AND version.draft_id = $2
      GROUP BY version.id
      ORDER BY version.version_number DESC`, [workspaceId, draftId]);
    if (!result.rows.length) {
      const existing = await query('SELECT id FROM content_drafts WHERE workspace_id = $1 AND id = $2', [workspaceId, draftId]);
      if (!existing.rows.length) throw businessError(404, 'DRAFT_NOT_FOUND', '没有找到这份草稿。');
    }
    return result.rows.map(versionView);
  }

  async function createDerivedWorkingCopy(workspaceId, projectId, platform, sourceDraftVersionId) {
    if (!DERIVED_PLATFORMS.has(platform)) throw businessError(400, 'DRAFT_PLATFORM_UNSUPPORTED', '只能从公众号母稿派生小红书或微博草稿。');
    if (!sourceDraftVersionId) throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '请先完成公众号草稿，再生成平台草稿。');
    return transaction(async (client) => {
      const source = await client.query(`SELECT version.id
        FROM content_draft_versions version
        JOIN content_drafts draft
          ON draft.workspace_id = version.workspace_id AND draft.id = version.draft_id
        WHERE version.workspace_id = $1 AND version.id = $2
          AND version.platform = 'WECHAT' AND draft.project_id = $3
          AND draft.current_version_id = version.id AND draft.status = 'READY'
        FOR UPDATE OF draft`, [workspaceId, sourceDraftVersionId, projectId]);
      if (!source.rows.length) throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '公众号来源版本已变化，请使用当前完成版本重新生成。');
      const inserted = await client.query(`INSERT INTO content_drafts
        (workspace_id, project_id, platform, source_draft_version_id, source_stale)
        VALUES ($1, $2, $3, $4, false)
        ON CONFLICT (workspace_id, project_id, platform) DO NOTHING
        RETURNING *`, [workspaceId, projectId, platform, sourceDraftVersionId]);
      if (inserted.rows.length) return draftView(inserted.rows[0]);
      const existing = await client.query('SELECT * FROM content_drafts WHERE workspace_id = $1 AND project_id = $2 AND platform = $3 FOR UPDATE', [workspaceId, projectId, platform]);
      if (!existing.rows.length) throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '派生草稿状态已变化，请重试。');
      if (existing.rows[0].source_draft_version_id !== sourceDraftVersionId) throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '现有平台草稿来自旧公众号版本，请明确重新生成。');
      return draftView(existing.rows[0]);
    });
  }

  async function markDerivedStale(workspaceId, projectId, client = { query }) {
    await client.query(`UPDATE content_drafts SET source_stale = true, updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND platform IN ('XIAOHONGSHU', 'WEIBO')
        AND source_stale = false`, [workspaceId, projectId]);
  }

  async function renderDraft(client, draft, assets) {
    if (draft.platform !== 'WECHAT') return { html: null, checks: [] };
    if (!draft.layout_template_version_id) throw businessError(400, 'LAYOUT_TEMPLATE_REQUIRED', '请选择公众号排版模板后再完成草稿。');
    if (typeof renderWechatDraft !== 'function') throw businessError(503, 'DRAFT_RENDERER_REQUIRED', '公众号排版渲染服务尚未就绪。');
    const template = await client.query(`SELECT rules_json FROM wechat_layout_template_versions
      WHERE workspace_id = $1 AND id = $2`, [draft.workspace_id, draft.layout_template_version_id]);
    if (!template.rows.length) throw businessError(400, 'LAYOUT_TEMPLATE_NOT_FOUND', '公众号排版模板不存在或不属于当前工作空间。');
    const rendered = await renderWechatDraft({ title: draft.title, body: draft.body, assets: assets.map(draftAssetView), templateRules: template.rows[0].rules_json });
    if (rendered.checks?.some(({ level }) => level === 'ERROR')) throw businessError(400, 'DRAFT_PREFLIGHT_FAILED', '草稿存在必须修正的问题。', { checks: rendered.checks });
    return rendered;
  }

  async function complete(workspaceId, draftId) {
    return transaction(async (client) => {
      const draft = await loadDraft(client, workspaceId, draftId, { forUpdate: true });
      if (!String(draft.body ?? '').trim()) throw businessError(400, 'DRAFT_BODY_REQUIRED', '正文不能为空。');
      if (draft.platform !== 'WECHAT' && (!draft.source_draft_version_id || draft.source_stale)) throw businessError(409, 'DRAFT_SOURCE_VERSION_STALE', '平台草稿来自旧公众号版本，请重新生成后再完成。');
      const assetResult = await client.query(`SELECT item.* FROM content_draft_assets item
        WHERE item.workspace_id = $1 AND item.draft_id = $2 AND item.draft_version_id IS NULL
        ORDER BY item.sort_order`, [workspaceId, draftId]);
      assertImageCount(draft.platform, assetResult.rows.map((row) => ({ assetId: row.asset_id })));
      const rendered = await renderDraft(client, draft, assetResult.rows);
      const next = await client.query(`SELECT COALESCE(max(version_number), 0) + 1 AS next_version
        FROM content_draft_versions WHERE workspace_id = $1 AND draft_id = $2`, [workspaceId, draftId]);
      const inserted = await client.query(`INSERT INTO content_draft_versions
        (workspace_id, draft_id, platform, version_number, title, body, visual_plan_json,
          rendered_html, layout_template_version_id, source_draft_version_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`, [
        workspaceId,
        draftId,
        draft.platform,
        Number(next.rows[0].next_version),
        draft.title,
        draft.body,
        JSON.stringify(draft.visual_plan_json ?? {}),
        rendered.html,
        draft.layout_template_version_id,
        draft.source_draft_version_id,
      ]);
      const version = inserted.rows[0];
      for (const asset of assetResult.rows) {
        await client.query(`INSERT INTO content_draft_assets
          (workspace_id, draft_id, draft_version_id, asset_id, role, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)`, [workspaceId, draftId, version.id, asset.asset_id, asset.role, asset.sort_order]);
      }
      const updated = await client.query(`UPDATE content_drafts SET status = 'READY', current_version_id = $3,
        revision = revision + 1, source_stale = false, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, draftId, version.id]);
      if (draft.platform === 'WECHAT') await markDerivedStale(workspaceId, draft.project_id, client);
      const frozenAssets = assetResult.rows.map((asset) => ({ ...asset, draft_version_id: version.id }));
      return {
        draft: draftView({ ...updated.rows[0], assets_json: assetResult.rows }),
        version: versionView({ ...version, assets_json: frozenAssets }),
      };
    });
  }

  async function preview(workspaceId, draftId) {
    const draft = await loadDraft({ query }, workspaceId, draftId);
    if (draft.platform !== 'WECHAT') throw businessError(400, 'DRAFT_PLATFORM_UNSUPPORTED', '只有公众号草稿需要排版预览。');
    const rendered = await renderDraft({ query }, draft, draft.assets_json ?? []);
    return { draftId, platform: draft.platform, html: rendered.html, checks: rendered.checks ?? [] };
  }

  return {
    listProject,
    get,
    upsertWechat,
    patchWorkingCopy,
    replaceWorkingAssets,
    complete,
    versions,
    preview,
    createDerivedWorkingCopy,
    markDerivedStale,
  };
}

module.exports = { createContentDraftStore, draftAssetView, draftView, versionView };
