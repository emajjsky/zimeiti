import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProjectMaterialStore, deriveProjectInputTitle, inputView, referenceView } from '../server/services/projectMaterials.cjs';
import { creativeStages, planningFieldNames } from '../src/domain/creative-flow.mjs';

test('项目资料迁移建立输入、参考和文件元数据表', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/013_project_materials.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE project_inputs/);
  assert.match(migration, /CREATE TABLE project_references/);
  assert.match(migration, /workspace_id uuid NOT NULL REFERENCES workspaces/);
  assert.match(migration, /'FACT'.*'OPINION'.*'STRUCTURE'.*'VOICE'.*'HOOK'.*'VISUAL'.*'NEGATIVE'/s);
  assert.match(migration, /source_type = 'FILE'.*storage_key IS NOT NULL/s);
});

test('项目输入和外链参考 DTO 不暴露文件所有权字段', () => {
  const input = inputView({ id: 'input-id', project_id: 'project-id', kind: 'DRAFT', title: '原稿', body: '正文', scope: 'WRITING', platforms_json: ['WECHAT'], created_at: 'created', updated_at: 'updated' });
  assert.deepEqual(input.platforms, ['WECHAT']);
  const reference = referenceView({ id: 'reference-id', project_id: 'project-id', source_type: 'LINK', role: 'FACT', title: '官方来源', notes: '', url: 'https://example.com', scope: 'RESEARCH', platforms_json: [], created_at: 'created', updated_at: 'updated' });
  assert.equal(reference.sourceType, 'LINK');
  assert.equal(reference.url, 'https://example.com');
  assert.equal('originalFilename' in reference, false);
  assert.equal('mimeType' in reference, false);
  assert.equal('sha256' in reference, false);
});

test('新增项目内容从正文首行生成标题，用户无需先填写标题', () => {
  assert.equal(deriveProjectInputTitle('  # 普通人如何使用 AI\n后续正文', 'IDEA'), '普通人如何使用 AI');
  assert.equal(deriveProjectInputTitle('第一行很长但仍然是标题\n第二行', 'DRAFT'), '第一行很长但仍然是标题');
  assert.equal(deriveProjectInputTitle('   \n   ', 'NOTE'), '未命名笔记');
});

test('项目资料列表始终按工作空间和项目隔离', async () => {
  const calls = [];
  const store = createProjectMaterialStore({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (/project_asset_links/.test(sql)) return { rows: [{
      id: 'asset-id', asset_id: 'asset-id', link_id: 'link-id', project_id: 'project-a', kind: 'IMAGE', origin: 'UPLOAD', status: 'ACTIVE',
      title: '参考图', original_filename: 'reference.png', mime_type: 'image/png', size_bytes: '128', sha256: 'a'.repeat(64), source_url: null,
      source_note: '', copyright_status: 'OWNED', project_count: 1, role: 'VISUAL', scope: 'IMAGING', platforms_json: [], notes: '', created_at: 'created', updated_at: 'updated',
    }] };
    return { rows: [] };
  } });
  const result = await store.list('workspace-a', 'project-a');
  assert.deepEqual(Object.keys(result).sort(), ['assets', 'inputs', 'references']);
  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.references, []);
  assert.equal(result.assets[0].id, 'asset-id');
  assert.equal(result.assets[0].linkId, 'link-id');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => /workspace_id/.test(call.sql) && /project_id/.test(call.sql)));
  assert.ok(calls.every((call) => call.params[0] === 'workspace-a' && call.params[1] === 'project-a'));
});

test('更新其它工作空间不存在的资料会返回 404', async () => {
  const store = createProjectMaterialStore({ query: async () => ({ rowCount: 0, rows: [] }) });
  await assert.rejects(() => store.updateInput('workspace-a', '11111111-1111-4111-8111-111111111111', { kind: 'IDEA', title: '标题', body: '正文', scope: 'PROJECT', platforms: [] }), (error) => error.statusCode === 404);
  await assert.rejects(() => store.updateReference('workspace-a', '22222222-2222-4222-8222-222222222222', { role: 'FACT', title: '来源', notes: '', scope: 'RESEARCH', platforms: [] }), (error) => error.statusCode === 404);
});

test('项目资料 API 使用空间素材上传、导入、读取和项目关联边界', () => {
  const source = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/v1\/creative\/projects\/:projectId\/materials'/);
  assert.match(source, /app\.post\('\/api\/v1\/creative\/projects\/:projectId\/inputs'/);
  assert.match(source, /app\.post\('\/api\/v1\/creative\/projects\/:projectId\/references'/);
  assert.match(source, /app\.post\('\/api\/v1\/assets'/);
  assert.match(source, /app\.post\('\/api\/v1\/assets\/import'/);
  assert.match(source, /app\.get\('\/api\/v1\/assets\/:assetId\/content'/);
  assert.match(source, /app\.post\('\/api\/v1\/projects\/:projectId\/assets\/:assetId'/);
});

test('研究在内容准备页按需执行，篇幅只在写作策略出现', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const materials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
  const preparation = fs.readFileSync(new URL('../src/workspaces/create/PreparationWorkspace.tsx', import.meta.url), 'utf8');
  assert.deepEqual(creativeStages.slice(0, 2).map(({ id }) => id), ['preparation', 'copy']);
  assert.equal(planningFieldNames.some((name) => /篇幅/.test(name)), false);
  assert.match(copy, /目标篇幅/);
  assert.doesNotMatch(copy, /补充研究/);
  assert.match(preparation, /stage="RESEARCH"/);
  assert.match(materials, /我的内容[\s\S]*参考链接[\s\S]*项目素材/);
  assert.match(materials, /webCreative\.createInput[\s\S]*webCreative\.createReference[\s\S]*webAssets\.upload[\s\S]*webAssets\.link/);
  assert.match(materials, /!inputItem[\s\S]*正文/);
  assert.match(materials, /const canSave = isInput[\s\S]*body\.trim\(\)[\s\S]*!inputItem/);
});
