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

function createWorkspaceStore({ query, transaction, defaultState }) {
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

  return { sessionForUser, create, rename, select, assertMembership };
}

module.exports = { createWorkspaceStore, resolveWorkspaceMembership, workspaceView };
