import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createInviteCode, inviteHash, userView } = require('../server/services/platform-auth.cjs');

test('邀请码只存储不可逆摘要并保留可辨识格式', () => {
  const code = createInviteCode();
  assert.match(code, /^BL-[A-Z0-9_-]{12}$/);
  assert.equal(inviteHash(code), inviteHash(code.toLowerCase()));
  assert.notEqual(inviteHash(code), code);
});

test('会话用户只暴露平台权限和账号状态，不返回密码字段', () => {
  const view = userView({ id: 'u1', email: 'a@example.com', display_name: 'A', platform_role: 'SUPER_ADMIN', status: 'ACTIVE', created_at: 'now', updated_at: 'now', password_hash: 'secret' });
  assert.deepEqual(view, { id: 'u1', email: 'a@example.com', display_name: 'A', platformRole: 'SUPER_ADMIN', status: 'ACTIVE', createdAt: 'now', updatedAt: 'now' });
  assert.equal('password_hash' in view, false);
});

test('注册、用户管理和邀请码接口均由平台认证模块集中实现', async () => {
  const routes = await readFile(new URL('../server/routes/platform-auth.cjs', import.meta.url), 'utf8');
  assert.match(routes, /INVITE_INVALID/);
  assert.match(routes, /requireSuperAdmin/);
  assert.match(routes, /auth_sessions SET revoked_at/);
  assert.match(routes, /ADMIN_SELF_PROTECTION/);
});

test('管理后台入口仅对超级管理员呈现', async () => {
  const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /session\.user\.platformRole === 'SUPER_ADMIN'/);
  assert.match(source, /用户管理后台/);
  assert.match(source, /webAuth\.logout\(\)/);
});
