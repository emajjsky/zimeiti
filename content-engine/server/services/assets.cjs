const { businessError } = require('./business-errors.cjs');

function assetView(row) {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    status: row.status,
    title: row.title,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    sourceUrl: row.source_url ?? null,
    sourceNote: row.source_note,
    copyrightStatus: row.copyright_status,
    projectCount: Number(row.project_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectAssetView(row) {
  return {
    ...assetView({ ...row, id: row.asset_id ?? row.id }),
    linkId: row.link_id ?? row.id,
    projectId: row.project_id,
    role: row.role,
    scope: row.scope,
    platforms: row.platforms_json ?? [],
    notes: row.notes,
  };
}

function createAssetStore({ query, transaction, removeStoredFile = async () => {} }) {
  async function list(workspaceId, filters = {}) {
    const values = [workspaceId];
    const conditions = ['asset.workspace_id = $1'];
    if (filters.status) { values.push(filters.status); conditions.push(`asset.status = $${values.length}`); }
    if (filters.kind) { values.push(filters.kind); conditions.push(`asset.kind = $${values.length}`); }
    if (filters.origin) { values.push(filters.origin); conditions.push(`asset.origin = $${values.length}`); }
    if (filters.query) { values.push(`%${filters.query}%`); conditions.push(`(asset.title ILIKE $${values.length} OR asset.original_filename ILIKE $${values.length} OR asset.source_note ILIKE $${values.length})`); }
    const result = await query(`SELECT asset.*, count(link.id)::int AS project_count
      FROM workspace_assets asset
      LEFT JOIN project_asset_links link ON link.workspace_id = asset.workspace_id AND link.asset_id = asset.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY asset.id
      ORDER BY asset.updated_at DESC, asset.id`, values);
    return result.rows.map(assetView);
  }

  async function getStored(workspaceId, assetId) {
    const result = await query(`SELECT asset.*, count(link.id)::int AS project_count
      FROM workspace_assets asset
      LEFT JOIN project_asset_links link ON link.workspace_id = asset.workspace_id AND link.asset_id = asset.id
      WHERE asset.workspace_id = $1 AND asset.id = $2
      GROUP BY asset.id`, [workspaceId, assetId]);
    if (!result.rows.length) throw businessError(404, 'ASSET_NOT_FOUND', '没有找到这份素材。');
    return result.rows[0];
  }

  async function get(workspaceId, assetId) {
    return assetView(await getStored(workspaceId, assetId));
  }

  async function createFromStoredFile(workspaceId, userId, storedFile, metadata) {
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))", [workspaceId, storedFile.sha256]);
      const existing = await client.query(`SELECT asset.*, (SELECT count(*) FROM project_asset_links link WHERE link.workspace_id = asset.workspace_id AND link.asset_id = asset.id)::int AS project_count
        FROM workspace_assets asset
        WHERE asset.workspace_id = $1 AND asset.sha256 = $2 AND asset.status <> 'DELETING'
        FOR UPDATE`, [workspaceId, storedFile.sha256]);
      if (existing.rows.length) return { created: false, asset: assetView(existing.rows[0]) };
      const inserted = await client.query(`INSERT INTO workspace_assets
        (workspace_id, kind, origin, title, original_filename, mime_type, size_bytes, sha256, storage_key, source_url, source_note, copyright_status, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *, 0::int AS project_count`, [
        workspaceId,
        storedFile.kind,
        metadata.origin,
        metadata.title.trim(),
        storedFile.originalFilename,
        storedFile.mimeType,
        storedFile.sizeBytes,
        storedFile.sha256.toLowerCase(),
        storedFile.storageKey,
        metadata.sourceUrl ?? storedFile.sourceUrl ?? null,
        metadata.sourceNote?.trim() ?? '',
        metadata.copyrightStatus ?? 'PENDING',
        userId,
      ]);
      return { created: true, asset: assetView(inserted.rows[0]) };
    });
    if (!result.created) await removeStoredFile(storedFile.storageKey);
    return result;
  }

  async function update(workspaceId, assetId, input) {
    const result = await query(`UPDATE workspace_assets asset SET
      title = $3, source_note = $4, copyright_status = $5, status = $6, updated_at = now()
      WHERE asset.workspace_id = $1 AND asset.id = $2 AND asset.status <> 'DELETING'
      RETURNING asset.*, (SELECT count(*) FROM project_asset_links link WHERE link.workspace_id = asset.workspace_id AND link.asset_id = asset.id)::int AS project_count`, [workspaceId, assetId, input.title.trim(), input.sourceNote?.trim() ?? '', input.copyrightStatus, input.status]);
    if (!result.rows.length) throw businessError(404, 'ASSET_NOT_FOUND', '没有找到可编辑的素材。');
    return assetView(result.rows[0]);
  }

  async function listProject(workspaceId, projectId) {
    const result = await query(`SELECT asset.*, link.id AS link_id, link.project_id, link.role, link.scope, link.platforms_json, link.notes,
      (SELECT count(*) FROM project_asset_links usage WHERE usage.workspace_id = asset.workspace_id AND usage.asset_id = asset.id)::int AS project_count
      FROM project_asset_links link
      JOIN workspace_assets asset ON asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
      WHERE link.workspace_id = $1 AND link.project_id = $2
      ORDER BY link.sort_order, link.updated_at DESC`, [workspaceId, projectId]);
    return result.rows.map(projectAssetView);
  }

  async function linkToProject(workspaceId, projectId, assetId, input) {
    const project = await query('SELECT project_id FROM content_projects WHERE workspace_id = $1 AND project_id = $2', [workspaceId, projectId]);
    if (!project.rows.length) throw businessError(404, 'PROJECT_NOT_FOUND', '没有找到这个内容项目。');
    const assetResult = await query('SELECT *, 0::int AS project_count FROM workspace_assets WHERE id = $1', [assetId]);
    if (!assetResult.rows.length) throw businessError(404, 'ASSET_NOT_FOUND', '没有找到这份素材。');
    const asset = assetResult.rows[0];
    if (asset.workspace_id !== workspaceId) throw businessError(403, 'WORKSPACE_FORBIDDEN', '素材不属于当前工作空间。');
    if (asset.status !== 'ACTIVE') throw businessError(409, 'ASSET_NOT_ACTIVE', '只有正常状态的素材可以关联项目。');
    const title = String(input.title ?? '').trim() || asset.title;
    const link = await query(`WITH linked AS (
        INSERT INTO project_asset_links
          (workspace_id, project_id, asset_id, role, scope, title, notes, platforms_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (workspace_id, project_id, asset_id) DO UPDATE SET
          role = excluded.role, scope = excluded.scope, title = excluded.title, notes = excluded.notes,
          platforms_json = excluded.platforms_json, updated_at = now()
        RETURNING *
      )
      SELECT asset.*, linked.id AS link_id, linked.project_id, linked.role, linked.scope, linked.platforms_json, linked.notes,
        (SELECT count(*) FROM project_asset_links usage WHERE usage.workspace_id = asset.workspace_id AND usage.asset_id = asset.id)::int AS project_count
      FROM linked
      JOIN workspace_assets asset ON asset.workspace_id = linked.workspace_id AND asset.id = linked.asset_id`, [workspaceId, projectId, assetId, input.role, input.scope, title, input.notes?.trim() ?? '', JSON.stringify(input.platforms ?? [])]);
    return projectAssetView(link.rows[0]);
  }

  async function unlinkFromProject(workspaceId, projectId, assetId) {
    const result = await query('DELETE FROM project_asset_links WHERE workspace_id = $1 AND project_id = $2 AND asset_id = $3 RETURNING id', [workspaceId, projectId, assetId]);
    if (!result.rows.length) throw businessError(404, 'PROJECT_ASSET_NOT_FOUND', '这个项目没有关联该素材。');
  }

  return { list, get, getStored, createFromStoredFile, update, listProject, linkToProject, unlinkFromProject };
}

module.exports = { assetView, projectAssetView, createAssetStore };
