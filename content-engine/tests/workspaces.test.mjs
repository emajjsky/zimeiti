import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createWorkspaceStore, workspaceView } = require('../server/services/workspaces.cjs');

function sessionDatabase({ memberships = [
  { id: 'workspace-a', name: '个人账号', role: 'OWNER', status: 'ACTIVE' },
  { id: 'workspace-b', name: '客户账号', role: 'EDITOR', status: 'ACTIVE' },
], activeWorkspaceId = 'workspace-b' } = {}) {
  return async (sql) => {
    if (sql.includes('FROM workspace_members')) return { rows: memberships, rowCount: memberships.length };
    if (sql.includes('FROM user_workspace_preferences')) {
      const rows = activeWorkspaceId ? [{ active_workspace_id: activeWorkspaceId }] : [];
      return { rows, rowCount: rows.length };
    }
    throw new Error(`未处理查询：${sql}`);
  };
}

test('登录会话返回全部空间和合法的最后使用空间', async () => {
  const store = createWorkspaceStore({ query: sessionDatabase(), transaction: async () => {}, defaultState: () => ({}) });
  const session = await store.sessionForUser('user-1');
  assert.deepEqual(session.workspaces.map(({ id }) => id), ['workspace-a', 'workspace-b']);
  assert.equal(session.activeWorkspaceId, 'workspace-b');
});

test('没有空间的用户返回空列表而不是隐式报错', async () => {
  const store = createWorkspaceStore({ query: sessionDatabase({ memberships: [], activeWorkspaceId: null }), transaction: async () => {}, defaultState: () => ({}) });
  assert.deepEqual(await store.sessionForUser('user-1'), { workspaces: [], activeWorkspaceId: null });
});

test('失效的最后使用空间不会被服务端替换成列表第一项', async () => {
  const store = createWorkspaceStore({ query: sessionDatabase({ activeWorkspaceId: 'workspace-removed' }), transaction: async () => {}, defaultState: () => ({}) });
  assert.equal((await store.sessionForUser('user-1')).activeWorkspaceId, null);
});

test('空间 DTO 不暴露数据库所有者和时间字段', () => {
  assert.deepEqual(workspaceView({ id: 'workspace-a', name: '个人账号', role: 'OWNER', status: 'ACTIVE', owner_id: 'user-1', created_at: 'secret' }), {
    id: 'workspace-a', name: '个人账号', role: 'OWNER', status: 'ACTIVE',
  });
});

test('创建空间在同一事务写入主体、成员、快照和最后选择', async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('INSERT INTO workspaces')) {
        return { rows: [{ id: 'workspace-new', name: values[0], status: 'ACTIVE' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const store = createWorkspaceStore({
    query: async () => { throw new Error('创建空间不应逃逸事务'); },
    transaction: (callback) => callback(client),
    defaultState: (name) => ({ workspace: { setupCompleted: false }, feishuTemplate: { name: `${name}内容库` } }),
  });

  assert.deepEqual(await store.create('user-1', '  客户账号  '), {
    id: 'workspace-new', name: '客户账号', role: 'OWNER', status: 'ACTIVE',
  });
  assert.equal(statements.length, 4);
  assert.match(statements[0].sql, /INSERT INTO workspaces/);
  assert.match(statements[1].sql, /INSERT INTO workspace_members/);
  assert.match(statements[2].sql, /INSERT INTO workspace_snapshots/);
  assert.match(statements[3].sql, /INSERT INTO user_workspace_preferences/);
});

test('选择空间先校验成员关系再保存最后选择', async () => {
  let selected = null;
  const memberships = [{ id: 'workspace-a', name: '个人账号', role: 'OWNER', status: 'ACTIVE' }];
  const query = async (sql, values) => {
    if (sql.includes('m.workspace_id = $2')) return { rows: memberships, rowCount: 1 };
    if (sql.includes('INSERT INTO user_workspace_preferences')) { selected = values[1]; return { rows: [], rowCount: 1 }; }
    if (sql.includes('FROM workspace_members')) return { rows: memberships, rowCount: 1 };
    if (sql.includes('FROM user_workspace_preferences')) return { rows: [{ active_workspace_id: selected }], rowCount: 1 };
    throw new Error(`未处理查询：${sql}`);
  };
  const store = createWorkspaceStore({ query, transaction: async () => {}, defaultState: () => ({}) });
  assert.equal((await store.select('user-1', 'workspace-a')).activeWorkspaceId, 'workspace-a');
});

test('只有所有者可以重命名活动空间', async () => {
  const query = async (sql, values) => {
    if (sql.includes('FROM workspace_members')) return { rows: [{ id: values[1], name: '旧名称', role: 'OWNER', status: 'ACTIVE' }], rowCount: 1 };
    if (sql.includes('UPDATE workspaces')) return { rows: [{ id: values[1], name: values[2], status: 'ACTIVE' }], rowCount: 1 };
    throw new Error(`未处理查询：${sql}`);
  };
  const store = createWorkspaceStore({ query, transaction: async () => {}, defaultState: () => ({}) });
  assert.deepEqual(await store.rename('user-1', 'workspace-a', '  新名称  '), {
    id: 'workspace-a', name: '新名称', role: 'OWNER', status: 'ACTIVE',
  });
});
