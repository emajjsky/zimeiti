const { z } = require('zod');
const { businessError } = require('../services/business-errors.cjs');
const { createInviteCode, inviteHash, passwordInput, userView } = require('../services/platform-auth.cjs');

const emailInput = z.string().email().max(320).transform((value) => value.trim().toLowerCase());
const registrationInput = z.object({
  email: emailInput,
  password: passwordInput,
  displayName: z.string().trim().min(1).max(80),
  workspaceName: z.string().trim().min(1).max(80),
  inviteCode: z.string().trim().min(6).max(100),
});

function registerPlatformAuthRoutes(app, dependencies) {
  const { query, transaction, hashPassword, verifyPassword, platformAuth } = dependencies;

  app.post('/api/v1/auth/register', async (request, reply) => {
    const input = registrationInput.parse(request.body);
    const created = await transaction(async (client) => {
      const invite = await client.query(`SELECT * FROM registration_invites
        WHERE code_hash = $1 FOR UPDATE`, [inviteHash(input.inviteCode)]);
      const row = invite.rows[0];
      if (!row || row.status !== 'ACTIVE' || row.used_count >= row.max_uses || (row.expires_at && new Date(row.expires_at) <= new Date())) {
        throw businessError(400, 'INVITE_INVALID', '邀请码无效、已停用或已过期。');
      }
      if ((await client.query('SELECT 1 FROM users WHERE email = $1', [input.email])).rowCount) throw businessError(409, 'EMAIL_EXISTS', '该邮箱已注册，请直接登录。');
      const result = await client.query(`INSERT INTO users (email, password_hash, display_name)
        VALUES ($1, $2, $3) RETURNING *`, [input.email, hashPassword(input.password), input.displayName]);
      const user = result.rows[0];
      await platformAuth.createOwnedWorkspace(client, user, input.workspaceName);
      await client.query('UPDATE registration_invites SET used_count = used_count + 1, updated_at = now() WHERE id = $1', [row.id]);
      return user;
    });
    reply.code(201).send(await platformAuth.issueSession(created));
  });

  app.post('/api/v1/auth/login', async (request) => {
    const input = z.object({ email: emailInput, password: passwordInput }).parse(request.body);
    const result = await query('SELECT * FROM users WHERE email = $1', [input.email]);
    if (!result.rowCount || !verifyPassword(input.password, result.rows[0].password_hash)) throw businessError(401, 'AUTH_FAILED', '邮箱或密码错误。');
    if (result.rows[0].status !== 'ACTIVE') throw businessError(403, 'ACCOUNT_DISABLED', '账号已被停用，请联系管理员。');
    return platformAuth.issueSession(result.rows[0]);
  });

  app.get('/api/v1/auth/me', { preHandler: platformAuth.authenticate }, async (request) => {
    const result = await query('SELECT * FROM users WHERE id = $1', [request.user.sub]);
    return platformAuth.sessionForUser(result.rows[0], request.user.sid);
  });

  app.post('/api/v1/auth/logout', { preHandler: platformAuth.authenticate }, async (request, reply) => {
    await query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [request.user.sid]);
    reply.code(204).send();
  });

  app.put('/api/v1/auth/password', { preHandler: platformAuth.authenticate }, async (request, reply) => {
    const input = z.object({ currentPassword: passwordInput, newPassword: passwordInput }).parse(request.body);
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [request.user.sub]);
    if (!verifyPassword(input.currentPassword, result.rows[0]?.password_hash)) throw businessError(400, 'PASSWORD_INCORRECT', '当前密码不正确。');
    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [request.user.sub, hashPassword(input.newPassword)]);
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [request.user.sub, request.user.sid]);
    });
    reply.code(204).send();
  });

  app.get('/api/v1/admin/users', { preHandler: platformAuth.requireSuperAdmin }, async () => {
    const result = await query(`SELECT u.*, count(DISTINCT w.id)::int AS workspace_count
      FROM users u LEFT JOIN workspaces w ON w.owner_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC`);
    return { users: result.rows.map((row) => ({ ...userView(row), workspaceCount: row.workspace_count })) };
  });

  app.post('/api/v1/admin/users', { preHandler: platformAuth.requireSuperAdmin }, async (request, reply) => {
    const input = z.object({ email: emailInput, password: passwordInput, displayName: z.string().trim().min(1).max(80), workspaceName: z.string().trim().min(1).max(80), platformRole: z.enum(['SUPER_ADMIN', 'USER']).default('USER') }).parse(request.body);
    const user = await transaction(async (client) => {
      if ((await client.query('SELECT 1 FROM users WHERE email = $1', [input.email])).rowCount) throw businessError(409, 'EMAIL_EXISTS', '该邮箱已存在。');
      const created = await client.query(`INSERT INTO users (email, password_hash, display_name, platform_role)
        VALUES ($1, $2, $3, $4) RETURNING *`, [input.email, hashPassword(input.password), input.displayName, input.platformRole]);
      await platformAuth.createOwnedWorkspace(client, created.rows[0], input.workspaceName);
      await platformAuth.audit(client, request.user.sub, 'USER_CREATE', 'USER', created.rows[0].id, { email: input.email, platformRole: input.platformRole });
      return created.rows[0];
    });
    reply.code(201).send({ user: userView(user) });
  });

  app.patch('/api/v1/admin/users/:userId', { preHandler: platformAuth.requireSuperAdmin }, async (request) => {
    const userId = z.string().uuid().parse(request.params.userId);
    const input = z.object({ displayName: z.string().trim().min(1).max(80).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(), platformRole: z.enum(['SUPER_ADMIN', 'USER']).optional() }).refine((value) => Object.keys(value).length > 0).parse(request.body);
    if (userId === request.user.sub && (input.status === 'DISABLED' || input.platformRole === 'USER')) throw businessError(400, 'ADMIN_SELF_PROTECTION', '不能停用自己或移除自己的超级管理员身份。');
    const updated = await transaction(async (client) => {
      const result = await client.query(`UPDATE users SET
        display_name = COALESCE($2, display_name), status = COALESCE($3, status), platform_role = COALESCE($4, platform_role), updated_at = now()
        WHERE id = $1 RETURNING *`, [userId, input.displayName ?? null, input.status ?? null, input.platformRole ?? null]);
      if (!result.rows.length) throw businessError(404, 'USER_NOT_FOUND', '用户不存在。');
      if (input.status === 'DISABLED') await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await platformAuth.audit(client, request.user.sub, 'USER_UPDATE', 'USER', userId, input);
      return result.rows[0];
    });
    return { user: userView(updated) };
  });

  app.put('/api/v1/admin/users/:userId/password', { preHandler: platformAuth.requireSuperAdmin }, async (request, reply) => {
    const userId = z.string().uuid().parse(request.params.userId);
    const input = z.object({ password: passwordInput }).parse(request.body);
    await transaction(async (client) => {
      const result = await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING email', [userId, hashPassword(input.password)]);
      if (!result.rows.length) throw businessError(404, 'USER_NOT_FOUND', '用户不存在。');
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await platformAuth.audit(client, request.user.sub, 'USER_PASSWORD_RESET', 'USER', userId);
    });
    reply.code(204).send();
  });

  app.delete('/api/v1/admin/users/:userId', { preHandler: platformAuth.requireSuperAdmin }, async (request, reply) => {
    const userId = z.string().uuid().parse(request.params.userId);
    if (userId === request.user.sub) throw businessError(400, 'ADMIN_SELF_PROTECTION', '不能删除当前登录的管理员账号。');
    await transaction(async (client) => {
      const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING email', [userId]);
      if (!result.rows.length) throw businessError(404, 'USER_NOT_FOUND', '用户不存在。');
      await platformAuth.audit(client, request.user.sub, 'USER_DELETE', 'USER', userId, { email: result.rows[0].email });
    });
    reply.code(204).send();
  });

  app.get('/api/v1/admin/invites', { preHandler: platformAuth.requireSuperAdmin }, async () => {
    const result = await query(`SELECT id, code_hint, label, max_uses, used_count, expires_at, status, created_at
      FROM registration_invites ORDER BY created_at DESC`);
    return { invites: result.rows };
  });

  app.post('/api/v1/admin/invites', { preHandler: platformAuth.requireSuperAdmin }, async (request, reply) => {
    const input = z.object({ label: z.string().trim().max(100).default(''), maxUses: z.number().int().min(1).max(100).default(1), expiresAt: z.string().datetime().nullable().default(null) }).parse(request.body);
    const code = createInviteCode();
    const result = await transaction(async (client) => {
      const created = await client.query(`INSERT INTO registration_invites (code_hash, code_hint, label, max_uses, expires_at, created_by)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, code_hint, label, max_uses, used_count, expires_at, status, created_at`, [inviteHash(code), `${code.slice(0, 6)}...${code.slice(-4)}`, input.label, input.maxUses, input.expiresAt, request.user.sub]);
      await platformAuth.audit(client, request.user.sub, 'INVITE_CREATE', 'INVITE', created.rows[0].id, { label: input.label, maxUses: input.maxUses });
      return created.rows[0];
    });
    reply.code(201).send({ invite: result, code });
  });

  app.patch('/api/v1/admin/invites/:inviteId', { preHandler: platformAuth.requireSuperAdmin }, async (request) => {
    const inviteId = z.string().uuid().parse(request.params.inviteId);
    const input = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).parse(request.body);
    const result = await query('UPDATE registration_invites SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, code_hint, label, max_uses, used_count, expires_at, status, created_at', [inviteId, input.status]);
    if (!result.rows.length) throw businessError(404, 'INVITE_NOT_FOUND', '邀请码不存在。');
    return { invite: result.rows[0] };
  });
}

module.exports = { registerPlatformAuthRoutes };
