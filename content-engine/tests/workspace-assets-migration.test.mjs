import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../server/migrations/027_workspace_asset_foundation.sql', import.meta.url),
  'utf8',
);

test('工作空间与素材迁移建立正式领域表和跨空间约束', () => {
  assert.match(migration, /ALTER TABLE workspaces[\s\S]*status text NOT NULL DEFAULT 'ACTIVE'/);
  assert.match(migration, /CREATE TABLE user_workspace_preferences/);
  assert.match(migration, /CREATE TABLE workspace_assets/);
  assert.match(migration, /UNIQUE \(workspace_id, sha256\)/);
  assert.match(migration, /CREATE TABLE project_asset_links/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, asset_id\)/);
  assert.match(migration, /CREATE TABLE storage_deletion_jobs/);
});

test('文件参考迁入空间素材并删除旧所有权字段', () => {
  assert.match(migration, /INSERT INTO workspace_assets/);
  assert.match(migration, /INSERT INTO project_asset_links/);
  assert.match(migration, /assetReferenceId/);
  assert.match(migration, /assetId/);
  assert.match(migration, /ADD COLUMN asset_link_id/);
  assert.match(migration, /DELETE FROM project_references[\s\S]*source_type = 'FILE'/);
  assert.match(migration, /DROP COLUMN storage_key/);
  assert.match(migration, /DROP COLUMN original_filename/);
  assert.match(migration, /DROP COLUMN mime_type/);
  assert.match(migration, /DROP COLUMN size_bytes/);
  assert.match(migration, /DROP COLUMN sha256/);
});

test('迁移清理快照中的重复空间名称和无效素材目录', () => {
  assert.match(migration, /UPDATE workspace_snapshots/);
  assert.match(migration, /#- '\{workspace,name\}'/);
  assert.match(migration, /#- '\{workspace,materialRoot\}'/);
});
