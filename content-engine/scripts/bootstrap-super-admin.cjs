const { hashPassword } = require('../server/crypto.cjs');
const { query, transaction, close } = require('../server/db.cjs');

const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD ?? '');
const displayName = String(process.env.ADMIN_DISPLAY_NAME ?? '平台管理员').trim();

if (!email || !email.includes('@')) throw new Error('请通过 ADMIN_EMAIL 提供管理员邮箱。');
if (password.length < 12) throw new Error('ADMIN_PASSWORD 至少需要 12 位。');

async function bootstrap() {
  const result = await transaction(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email]);
    if (existing.rows.length) {
      await client.query(`UPDATE users SET password_hash = $2, display_name = $3,
        platform_role = 'SUPER_ADMIN', status = 'ACTIVE', updated_at = now() WHERE id = $1`, [existing.rows[0].id, hashPassword(password), displayName]);
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [existing.rows[0].id]);
      return { id: existing.rows[0].id, created: false };
    }
    const user = await client.query(`INSERT INTO users (email, password_hash, display_name, platform_role)
      VALUES ($1, $2, $3, 'SUPER_ADMIN') RETURNING id`, [email, hashPassword(password), displayName]);
    const workspaceName = `${displayName}工作室`;
    const workspace = await client.query('INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id', [workspaceName, user.rows[0].id]);
    await client.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')", [workspace.rows[0].id, user.rows[0].id]);
    await client.query('INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2)', [workspace.rows[0].id, JSON.stringify({ workspace: { primaryTopics: [], enabledPlatforms: ['WECHAT'], setupCompleted: false }, feishuTemplate: { name: `${workspaceName}内容库`, topicStorage: 'ONE_TABLE', includeSchedule: true, includeReview: false, status: 'DRAFT' }, sources: [], intelligence: [], projects: [] })]);
    await client.query('SELECT seed_wechat_layout_templates($1)', [workspace.rows[0].id]);
    await client.query('INSERT INTO user_workspace_preferences (user_id, active_workspace_id) VALUES ($1, $2)', [user.rows[0].id, workspace.rows[0].id]);
    return { id: user.rows[0].id, created: true };
  });
  process.stdout.write(`${result.created ? 'created' : 'updated'}:${result.id}\n`);
}

bootstrap().finally(close).catch((error) => { console.error(error); process.exitCode = 1; });

