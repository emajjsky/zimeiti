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
    originalFilename: row.original_filename ?? null,
    mimeType: row.mime_type ?? null,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    sha256: row.sha256 ?? null,
    scope: row.scope,
    platforms: row.platforms_json ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createProjectMaterialStore({ query }) {
  async function list(workspaceId, projectId) {
    const [inputs, references] = await Promise.all([
      query('SELECT * FROM project_inputs WHERE workspace_id = $1 AND project_id = $2 ORDER BY updated_at DESC', [workspaceId, projectId]),
      query('SELECT * FROM project_references WHERE workspace_id = $1 AND project_id = $2 ORDER BY updated_at DESC', [workspaceId, projectId]),
    ]);
    return { inputs: inputs.rows.map(inputView), references: references.rows.map(referenceView) };
  }

  async function createInput(workspaceId, projectId, input) {
    const result = await query(`INSERT INTO project_inputs
      (workspace_id, project_id, kind, title, body, scope, platforms_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`, [workspaceId, projectId, input.kind, input.title.trim(), input.body.trim(), input.scope, JSON.stringify(input.platforms)]);
    return inputView(result.rows[0]);
  }

  async function updateInput(workspaceId, id, input) {
    const result = await query(`UPDATE project_inputs SET
      kind = $3, title = $4, body = $5, scope = $6, platforms_json = $7, updated_at = now()
      WHERE workspace_id = $1 AND id = $2 RETURNING *`, [workspaceId, id, input.kind, input.title.trim(), input.body.trim(), input.scope, JSON.stringify(input.platforms)]);
    if (!result.rowCount) { const error = new Error('未找到这条项目内容。'); error.statusCode = 404; throw error; }
    return inputView(result.rows[0]);
  }

  async function removeInput(workspaceId, id) {
    const result = await query('DELETE FROM project_inputs WHERE workspace_id = $1 AND id = $2 RETURNING id', [workspaceId, id]);
    if (!result.rowCount) { const error = new Error('未找到这条项目内容。'); error.statusCode = 404; throw error; }
  }

  async function createReference(workspaceId, projectId, input) {
    const result = await query(`INSERT INTO project_references
      (workspace_id, project_id, source_type, role, title, notes, url, storage_key, original_filename, mime_type, size_bytes, sha256, scope, platforms_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`, [workspaceId, projectId, input.sourceType, input.role, input.title.trim(), input.notes?.trim() ?? '', input.url ?? null, input.storageKey ?? null, input.originalFilename ?? null, input.mimeType ?? null, input.sizeBytes ?? null, input.sha256 ?? null, input.scope, JSON.stringify(input.platforms)]);
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

  return { list, createInput, updateInput, removeInput, createReference, updateReference, getReference, removeReference };
}

module.exports = { createProjectMaterialStore, inputView, referenceView };
