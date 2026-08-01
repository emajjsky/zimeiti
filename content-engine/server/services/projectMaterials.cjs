const { projectAssetView } = require('./assets.cjs');

function inputView(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    scope: row.scope,
    platforms: row.platforms_json ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function referenceView(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    role: row.role,
    title: row.title,
    notes: row.notes,
    url: row.url ?? null,
    scope: row.scope,
    platforms: row.platforms_json ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const inputKindLabels = {
  IDEA: '想法',
  DRAFT: '草稿',
  NOTE: '笔记',
  TRANSCRIPT: '转写',
};

function deriveProjectInputTitle(body, kind) {
  const firstLine = String(body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const normalized = firstLine?.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '').trim();
  return normalized ? normalized.slice(0, 160) : `未命名${inputKindLabels[kind] ?? '内容'}`;
}

function createProjectMaterialStore({ query }) {
  async function list(workspaceId, projectId) {
    const [inputs, references, assets] = await Promise.all([
      query('SELECT * FROM project_inputs WHERE workspace_id = $1 AND project_id = $2 ORDER BY updated_at DESC', [workspaceId, projectId]),
      query("SELECT * FROM project_references WHERE workspace_id = $1 AND project_id = $2 AND source_type = 'LINK' ORDER BY updated_at DESC", [workspaceId, projectId]),
      query(`SELECT asset.*, link.id AS link_id, link.project_id, link.role, link.scope, link.platforms_json, link.notes,
        (SELECT count(*) FROM project_asset_links usage WHERE usage.workspace_id = asset.workspace_id AND usage.asset_id = asset.id)::int AS project_count
        FROM project_asset_links link
        JOIN workspace_assets asset ON asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
        WHERE link.workspace_id = $1 AND link.project_id = $2
        ORDER BY link.sort_order, link.updated_at DESC`, [workspaceId, projectId]),
    ]);
    return { inputs: inputs.rows.map(inputView), references: references.rows.map(referenceView), assets: assets.rows.map(projectAssetView) };
  }

  async function createInput(workspaceId, projectId, input) {
    const title = String(input.title ?? '').trim() || deriveProjectInputTitle(input.body, input.kind);
    const result = await query(`INSERT INTO project_inputs
      (workspace_id, project_id, kind, title, body, scope, platforms_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`, [workspaceId, projectId, input.kind, title, input.body.trim(), input.scope, JSON.stringify(input.platforms)]);
    return inputView(result.rows[0]);
  }

  async function updateInput(workspaceId, id, input) {
    const title = String(input.title ?? '').trim() || deriveProjectInputTitle(input.body, input.kind);
    const result = await query(`UPDATE project_inputs SET
      kind = $3, title = $4, body = $5, scope = $6, platforms_json = $7, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, id, input.kind, title, input.body.trim(), input.scope, JSON.stringify(input.platforms)]);
    if (!result.rowCount) { const error = new Error('未找到这条项目内容。'); error.statusCode = 404; throw error; }
    return inputView(result.rows[0]);
  }

  async function removeInput(workspaceId, id) {
    const result = await query('DELETE FROM project_inputs WHERE workspace_id = $1 AND id = $2 RETURNING id', [workspaceId, id]);
    if (!result.rowCount) { const error = new Error('未找到这条项目内容。'); error.statusCode = 404; throw error; }
  }

  async function createReference(workspaceId, projectId, input) {
    const result = await query(`INSERT INTO project_references
      (workspace_id, project_id, source_type, role, title, notes, url, scope, platforms_json)
      VALUES ($1, $2, 'LINK', $3, $4, $5, $6, $7, $8)
      RETURNING *`, [workspaceId, projectId, input.role, input.title.trim(), input.notes?.trim() ?? '', input.url, input.scope, JSON.stringify(input.platforms)]);
    return referenceView(result.rows[0]);
  }

  async function updateReference(workspaceId, id, input) {
    const result = await query(`UPDATE project_references SET
      role = $3, title = $4, notes = $5, scope = $6, platforms_json = $7, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, id, input.role, input.title.trim(), input.notes?.trim() ?? '', input.scope, JSON.stringify(input.platforms)]);
    if (!result.rowCount) { const error = new Error('未找到这条参考资料。'); error.statusCode = 404; throw error; }
    return referenceView(result.rows[0]);
  }

  async function getReference(workspaceId, id) {
    const result = await query('SELECT * FROM project_references WHERE workspace_id = $1 AND id = $2', [workspaceId, id]);
    if (!result.rowCount) { const error = new Error('未找到这条参考资料。'); error.statusCode = 404; throw error; }
    return result.rows[0];
  }

  async function removeReference(workspaceId, id) {
    const result = await query('DELETE FROM project_references WHERE workspace_id = $1 AND id = $2 RETURNING *', [workspaceId, id]);
    if (!result.rowCount) { const error = new Error('未找到这条参考资料。'); error.statusCode = 404; throw error; }
    return result.rows[0];
  }

  async function researchSnapshot(workspaceId, projectId, inputIds, referenceIds, assetIds = []) {
    const [inputs, references, assets] = await Promise.all([
      inputIds.length ? query('SELECT * FROM project_inputs WHERE workspace_id = $1 AND project_id = $2 AND id = ANY($3::uuid[]) ORDER BY updated_at DESC', [workspaceId, projectId, inputIds]) : { rows: [] },
      referenceIds.length ? query("SELECT * FROM project_references WHERE workspace_id = $1 AND project_id = $2 AND source_type = 'LINK' AND id = ANY($3::uuid[]) ORDER BY updated_at DESC", [workspaceId, projectId, referenceIds]) : { rows: [] },
      assetIds.length ? query(`SELECT link.id, asset.id AS asset_id, 'ASSET' AS source_type, link.role, link.scope, link.title, link.notes,
        asset.mime_type, asset.storage_key, asset.original_filename
        FROM project_asset_links link
        JOIN workspace_assets asset ON asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
        WHERE link.workspace_id = $1 AND link.project_id = $2 AND link.id = ANY($3::uuid[])
        ORDER BY link.updated_at DESC`, [workspaceId, projectId, assetIds]) : { rows: [] },
    ]);
    if (inputs.rows.length !== inputIds.length || references.rows.length !== referenceIds.length || assets.rows.length !== assetIds.length) {
      const error = new Error('部分项目资料不存在或不属于当前项目。'); error.statusCode = 400; throw error;
    }
    return { inputs: inputs.rows, references: references.rows, assets: assets.rows };
  }

  return { list, createInput, updateInput, removeInput, createReference, updateReference, getReference, removeReference, researchSnapshot };
}

module.exports = { createProjectMaterialStore, deriveProjectInputTitle, inputView, referenceView };
