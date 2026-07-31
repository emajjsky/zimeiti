async function loadContentMasterState(client, workspaceId, projectId) {
  const lockKey = `content-master:${workspaceId}:${projectId}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
  const result = await client.query(`SELECT
      (ARRAY_AGG(m.id ORDER BY m.version_number DESC) FILTER (WHERE a.status = 'ACCEPTED'))[1] AS accepted_master_id,
      COALESCE(MAX(m.version_number), 0) + 1 AS next_master_version,
      (ARRAY_AGG(m.id ORDER BY m.version_number DESC))[1] AS parent_master_version_id
    FROM content_master_versions m
    JOIN project_artifacts a ON a.id = m.artifact_id
    WHERE m.workspace_id = $1 AND m.project_id = $2`, [workspaceId, projectId]);
  const row = result.rows[0] ?? {};
  return {
    acceptedMasterId: row.accepted_master_id ?? null,
    nextVersion: Number(row.next_master_version ?? 1),
    parentVersionId: row.parent_master_version_id ?? null,
  };
}

module.exports = { loadContentMasterState };
