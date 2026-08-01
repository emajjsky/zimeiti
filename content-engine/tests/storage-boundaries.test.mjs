import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [server, projectRepository, webApi, main, migration, timestampMigration, assetMigration, recovery] = await Promise.all([
  readFile(new URL('../server/index.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../server/services/project-planning.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/data/webApi.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../server/migrations/025_normalized_content_projects.sql', import.meta.url), 'utf8'),
  readFile(new URL('../server/migrations/026_normalize_content_project_timestamps.sql', import.meta.url), 'utf8'),
  readFile(new URL('../server/migrations/027_workspace_asset_foundation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/recover-content-projects.cjs', import.meta.url), 'utf8'),
]);

test('正式 Web 不再暴露整份工作空间覆盖接口', () => {
  assert.doesNotMatch(server, /app\.put\('\/api\/v1\/workspace\/state'/);
  assert.doesNotMatch(webApi, /workspace\/state[^\n]+method:\s*'PUT'/);
  assert.doesNotMatch(main, /persistState\s*\(/);
  assert.match(webApi, /savePreferences/);
  assert.match(webApi, /updateVersion/);
});

test('项目写入与偏好写入使用独立存储边界', () => {
  assert.doesNotMatch(server, /UPDATE workspace_snapshots SET state_json/);
  assert.match(server, /saveWorkspacePreferences/);
  assert.match(server, /updateCreativeProjects/);
  assert.match(projectRepository, /INSERT INTO content_projects/);
  assert.match(projectRepository, /state_json IS DISTINCT FROM \$2::jsonb/);
  assert.doesNotMatch(projectRepository, /const \{ projects: _projects/);
});

test('项目迁移移出快照且恢复脚本默认只预演并拒绝覆盖', () => {
  assert.match(migration, /CREATE TABLE content_projects/);
  assert.match(migration, /jsonb_array_elements\(COALESCE\(snapshot\.state_json->'projects'/);
  assert.match(migration, /state_json - 'projects' - 'sources' - 'intelligence' - 'topics'/);
  assert.match(timestampMigration, /pg_input_is_valid/);
  assert.match(timestampMigration, /jsonb_array_elements\(COALESCE\(project\.project_json->'versions'/);
  assert.match(recovery, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(recovery, /目标工作空间已有项目，拒绝覆盖恢复/);
  assert.match(recovery, /uniqueVisualReferences\(references\)/);
  assert.match(recovery, /item\.assetReferenceId = assignableReferences\[index\]\?\.id \?\? null/);
});

test('空间素材成为文件唯一所有者且项目只保留引用关系', () => {
  assert.match(assetMigration, /CREATE TABLE workspace_assets/);
  assert.match(assetMigration, /CREATE TABLE project_asset_links/);
  assert.match(assetMigration, /DELETE FROM project_references[\s\S]*source_type = 'FILE'/);
  assert.match(assetMigration, /ALTER TABLE project_references[\s\S]*DROP COLUMN storage_key/);
  const projectAssetTable = assetMigration.match(/CREATE TABLE project_asset_links \(([\s\S]*?)\n\);/)?.[1] ?? '';
  assert.doesNotMatch(projectAssetTable, /storage_key/);
});
