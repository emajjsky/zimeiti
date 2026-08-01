import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createWorkspaceAccess } = require('../server/services/workspace-context.cjs');

function requestFor(workspaceId = 'workspace-a') {
  return { headers: { 'x-workspace-id': workspaceId }, user: { sub: 'user-1' } };
}

function memberQuery(role = 'EDITOR', status = 'ACTIVE') {
  return async () => ({ rows: [{ id: 'workspace-a', name: '个人账号', role, status }], rowCount: 1 });
}

test('空间请求头缺失时返回稳定错误码', async () => {
  const access = createWorkspaceAccess({ query: async () => ({ rows: [] }), authenticate: async () => {} });
  const request = { headers: {}, user: { sub: 'user-1' } };
  await assert.rejects(() => access.resolve(request, 'VIEWER'), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'WORKSPACE_REQUIRED');
    return true;
  });
});

test('非成员不能借请求头访问其他空间', async () => {
  const access = createWorkspaceAccess({ query: async () => ({ rows: [], rowCount: 0 }), authenticate: async () => {} });
  await assert.rejects(() => access.resolve(requestFor(), 'VIEWER'), (error) => error.statusCode === 403 && error.code === 'WORKSPACE_FORBIDDEN');
});

test('编辑者不能执行 OWNER 操作', async () => {
  const access = createWorkspaceAccess({ query: memberQuery('EDITOR'), authenticate: async () => {} });
  await assert.rejects(() => access.resolve(requestFor(), 'OWNER'), (error) => error.code === 'WORKSPACE_FORBIDDEN');
});

test('删除中的空间拒绝继续读写', async () => {
  const access = createWorkspaceAccess({ query: memberQuery('OWNER', 'DELETING'), authenticate: async () => {} });
  await assert.rejects(() => access.resolve(requestFor(), 'VIEWER'), (error) => error.statusCode === 423 && error.code === 'WORKSPACE_DELETING');
});

test('合法成员解析后只挂载已验证的空间上下文', async () => {
  const access = createWorkspaceAccess({ query: memberQuery('EDITOR'), authenticate: async () => {} });
  const request = requestFor();
  await access.resolve(request, 'VIEWER');
  assert.deepEqual(request.workspace, { id: 'workspace-a', name: '个人账号', role: 'EDITOR', status: 'ACTIVE' });
});

test('角色预处理器先认证再解析空间', () => {
  const authenticate = async () => {};
  const access = createWorkspaceAccess({ query: memberQuery(), authenticate });
  const handlers = access.forRole('EDITOR');
  assert.equal(handlers[0], authenticate);
  assert.equal(typeof handlers[1], 'function');
});
