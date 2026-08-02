const { businessError } = require('./business-errors.cjs');

const roleRank = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

function workspaceView(row) {
  return { id: row.id, name: row.name, role: row.role, status: row.status };
}

async function resolveWorkspaceMembership(query, userId, workspaceId, minimumRole = 'VIEWER') {
  if (!(minimumRole in roleRank)) throw new TypeError(`未知工作空间角色：${minimumRole}`);
  const result = await query(`SELECT w.id, w.name, w.status, m.role
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = $1 AND m.workspace_id = $2`, [userId, workspaceId]);
  if (!result.rows.length) throw businessError(403, 'WORKSPACE_FORBIDDEN', '你无权访问这个工作空间。');
  const workspace = workspaceView(result.rows[0]);
  if (workspace.status !== 'ACTIVE') throw businessError(423, 'WORKSPACE_DELETING', '这个工作空间正在删除，不能继续操作。');
  if (roleRank[workspace.role] < roleRank[minimumRole]) throw businessError(403, 'WORKSPACE_FORBIDDEN', '当前角色无权执行这个操作。');
  return workspace;
}

function createWorkspaceStore({ query, transaction, defaultState, initializeWorkspace }) {
  const assertMembership = (userId, workspaceId, minimumRole = 'VIEWER') => (
    resolveWorkspaceMembership(query, userId, workspaceId, minimumRole)
  );

  async function sessionForUser(userId) {
    const memberships = await query(`SELECT w.id, w.name, w.status, m.role
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND w.status = 'ACTIVE'
      ORDER BY w.created_at, w.id`, [userId]);
    const preference = await query(
      'SELECT active_workspace_id FROM user_workspace_preferences WHERE user_id = $1',
      [userId],
    );
    const workspaces = memberships.rows.map(workspaceView);
    const allowed = new Set(workspaces.map(({ id }) => id));
    const preferred = preference.rows[0]?.active_workspace_id ?? null;
    return { workspaces, activeWorkspaceId: allowed.has(preferred) ? preferred : null };
  }

  async function select(userId, workspaceId) {
    await assertMembership(userId, workspaceId, 'VIEWER');
    await query(`INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE
      SET active_workspace_id = excluded.active_workspace_id, updated_at = now()`, [userId, workspaceId]);
    return sessionForUser(userId);
  }

  async function create(userId, name) {
    const normalizedName = String(name ?? '').trim();
    if (!normalizedName) throw businessError(400, 'WORKSPACE_NAME_REQUIRED', '请输入工作空间名称。');
    if (typeof initializeWorkspace !== 'function') throw new TypeError('工作空间初始化器未配置。');
    return transaction(async (client) => {
      const workspace = await client.query(
        'INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id, name, status',
        [normalizedName, userId],
      );
      const created = workspace.rows[0];
      await client.query(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')",
        [created.id, userId],
      );
      await client.query(
        'INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2)',
        [created.id, JSON.stringify(defaultState(created.name))],
      );
      await initializeWorkspace(client, created.id);
      await client.query(`INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
        SET active_workspace_id = excluded.active_workspace_id, updated_at = now()`, [userId, created.id]);
      return workspaceView({ ...created, role: 'OWNER' });
    });
  }

  async function rename(userId, workspaceId, name) {
    const normalizedName = String(name ?? '').trim();
    if (!normalizedName) throw businessError(400, 'WORKSPACE_NAME_REQUIRED', '请输入工作空间名称。');
    await assertMembership(userId, workspaceId, 'OWNER');
    const result = await query(`UPDATE workspaces
      SET name = $3, updated_at = now()
      WHERE owner_id = $1 AND id = $2 AND status = 'ACTIVE'
      RETURNING id, name, status`, [userId, workspaceId, normalizedName]);
    if (!result.rows.length) throw businessError(404, 'WORKSPACE_NOT_FOUND', '没有找到可重命名的工作空间。');
    return workspaceView({ ...result.rows[0], role: 'OWNER' });
  }

  async function deletionImpact(userId, workspaceId) {
    await assertMembership(userId, workspaceId, 'OWNER');
    const tables = {
      projects: 'content_projects',
      assets: 'workspace_assets',
      channelAccounts: 'channel_accounts',
      publications: 'publications',
      metricSnapshots: 'metric_snapshots',
      retrospectives: 'retrospectives',
    };
    const impact = {};
    for (const [key, table] of Object.entries(tables)) {
      const exists = await query('SELECT to_regclass($1) AS table_name', [table]);
      const value = exists.rows[0]?.table_name ?? exists.rows[0]?.exists;
      if (!value) { impact[key] = 0; continue; }
      const result = await query(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
      impact[key] = Number(result.rows[0]?.count ?? 0);
    }
    return impact;
  }

  async function requestDeletion(userId, workspaceId, confirmationName) {
    const workspace = await assertMembership(userId, workspaceId, 'OWNER');
    if (String(confirmationName ?? '') !== workspace.name) throw businessError(400, 'WORKSPACE_DELETE_CONFIRMATION_MISMATCH', '请输入完整的工作空间名称确认删除。');
    return transaction(async (client) => {
      const updated = await client.query("UPDATE workspaces SET status = 'DELETING', updated_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING id, name, status", [workspaceId]);
      if (!updated.rows.length) throw businessError(409, 'WORKSPACE_DELETE_IN_PROGRESS', '工作空间已经在删除流程中。');
      const deletion = await client.query(`INSERT INTO storage_deletion_jobs
        (workspace_id, target_type, target_id, storage_key, status, requested_by)
        VALUES ($1, 'WORKSPACE', $1, $2, 'PENDING', $3) RETURNING *`, [workspaceId, workspaceId, userId]);
      const queued = await client.query(`INSERT INTO jobs (workspace_id, job_type, payload_json)
        VALUES ($1, 'STORAGE_DELETE', $2) RETURNING *`, [workspaceId, JSON.stringify({ deletionJobId: deletion.rows[0].id })]);
      return { workspace: workspaceView({ ...updated.rows[0], role: 'OWNER' }), deletionJob: deletion.rows[0], job: queued.rows[0] };
    });
  }

  return { sessionForUser, create, rename, select, assertMembership, deletionImpact, requestDeletion };
}

module.exports = { createWorkspaceStore, resolveWorkspaceMembership, workspaceView };
