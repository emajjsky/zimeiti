const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { z } = require('zod');
const { businessError } = require('./business-errors.cjs');

const SESSION_DAYS = 7;
const passwordInput = z.string().min(8).max(200);

function inviteHash(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

function createInviteCode() {
  return `BL-${randomBytes(9).toString('base64url').toUpperCase()}`;
}

function userView(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    platformRole: row.platform_role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createPlatformAuth({ app, query, transaction, hashPassword, verifyPassword, workspaceStore, defaultState, initializeWorkspace }) {
  async function sessionForUser(user, sessionId) {
    return {
      user: userView(user),
      ...await workspaceStore.sessionForUser(user.id),
      accessToken: app.jwt.sign({ sub: user.id, email: user.email, sid: sessionId }, { expiresIn: `${SESSION_DAYS}d` }),
    };
  }

  async function issueSession(user) {
    const sessionId = randomUUID();
    await query(`INSERT INTO auth_sessions (id, user_id, expires_at)
      VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sessionId, user.id]);
    return sessionForUser(user, sessionId);
  }

  async function authenticate(request) {
    await request.jwtVerify();
    const result = await query(`SELECT u.id, u.email, u.display_name, u.platform_role, u.status, u.created_at, u.updated_at
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`, [request.user.sid, request.user.sub]);
    if (!result.rows.length || result.rows[0].status !== 'ACTIVE') throw businessError(401, 'AUTH_INVALID', '登录状态已失效，请重新登录。');
    request.account = userView(result.rows[0]);
    await query('UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1', [request.user.sid]);
  }

  async function requireSuperAdmin(request) {
    await authenticate(request);
    if (request.account.platformRole !== 'SUPER_ADMIN') throw businessError(403, 'ADMIN_FORBIDDEN', '仅超级管理员可以访问管理后台。');
  }

  async function createOwnedWorkspace(client, user, workspaceName) {
    const workspace = await client.query('INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id, name, status', [workspaceName, user.id]);
    await client.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')", [workspace.rows[0].id, user.id]);
    await client.query('INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2)', [workspace.rows[0].id, JSON.stringify(defaultState(workspaceName))]);
    await initializeWorkspace(client, workspace.rows[0].id);
    await client.query('INSERT INTO user_workspace_preferences (user_id, active_workspace_id) VALUES ($1, $2)', [user.id, workspace.rows[0].id]);
    return workspace.rows[0];
  }

  async function audit(client, actorId, action, targetType, targetId, details = {}) {
    await client.query(`INSERT INTO admin_audit_logs (actor_user_id, action, target_type, target_id, details_json)
      VALUES ($1, $2, $3, $4, $5)`, [actorId, action, targetType, targetId ?? null, JSON.stringify(details)]);
  }

  return { authenticate, requireSuperAdmin, issueSession, sessionForUser, createOwnedWorkspace, audit };
}

module.exports = { createPlatformAuth, createInviteCode, inviteHash, passwordInput, userView };

