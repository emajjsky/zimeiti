import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStorageDeletionService } = require('../server/services/storageDeletion.cjs');
const { createWorkspaceStore } = require('../server/services/workspaces.cjs');

test('空间删除影响预览返回项目、素材和已接入域的数量', async () => {
  const queries = [];
  const query = async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM workspace_members')) return { rows: [{ id: 'workspace-a', name: '客户 A', status: 'ACTIVE', role: 'OWNER' }], rowCount: 1 };
    if (sql.includes('to_regclass')) return { rows: [{ exists: true }], rowCount: 1 };
    if (sql.includes('workspace_assets')) return { rows: [{ count: '33' }], rowCount: 1 };
    if (sql.includes('content_projects')) return { rows: [{ count: '8' }], rowCount: 1 };
    return { rows: [{ count: '0' }], rowCount: 1 };
  };
  const store = createWorkspaceStore({ query, transaction: async (callback) => callback({ query }), defaultState: () => ({}) });
  assert.deepEqual(await store.deletionImpact('owner-1', 'workspace-a'), { projects: 8, assets: 33, channelAccounts: 0, publications: 0, metricSnapshots: 0, retrospectives: 0 });
  assert.ok(queries.some((sql) => sql.includes('workspace_assets')));
});

test('名称不匹配时不标记工作空间删除', async () => {
  const statements = [];
  const query = async (sql) => {
    if (sql.includes('FROM workspace_members')) return { rows: [{ id: 'workspace-a', name: '客户 A', status: 'ACTIVE', role: 'OWNER' }], rowCount: 1 };
    throw new Error(`不应执行：${sql}`);
  };
  const store = createWorkspaceStore({ query, transaction: async (callback) => callback({ query: async (sql) => { statements.push(sql); return { rows: [] }; } }), defaultState: () => ({}) });
  await assert.rejects(() => store.requestDeletion('owner-1', 'workspace-a', '错误名称'), (error) => error.code === 'WORKSPACE_DELETE_CONFIRMATION_MISMATCH');
  assert.equal(statements.length, 0);
});

test('物理存储删除成功后才删除数据库主体', async () => {
  const calls = [];
  const service = createStorageDeletionService({
    uploadRoot: 'F:/uploads',
    removeAssetFile: async () => calls.push('remove-files'),
    removeWorkspaceDirectory: async () => calls.push('remove-files'),
    query: async (sql) => sql.includes('UPDATE storage_deletion_jobs') ? { rows: [{ id: 'job-1', target_type: 'WORKSPACE', workspace_id: 'workspace-a', target_id: 'workspace-a', storage_key: 'workspace-a' }], rowCount: 1 } : { rows: [], rowCount: 0 },
    transaction: async (callback) => callback({ query: async (sql) => { calls.push(sql.includes('DELETE FROM workspaces') ? 'delete-workspace' : 'complete-job'); return { rows: [] }; } }),
  });
  await service.execute({ id: 'job-1', target_type: 'WORKSPACE', workspace_id: 'workspace-a', target_id: 'workspace-a', storage_key: 'workspace-a' });
  assert.deepEqual(calls, ['remove-files', 'complete-job', 'delete-workspace']);
});
