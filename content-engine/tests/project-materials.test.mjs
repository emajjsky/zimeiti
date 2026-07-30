import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectMaterialStore, deriveProjectInputTitle, inputView, referenceView } from '../server/services/projectMaterials.cjs';
import { MIME_EXTENSIONS, safePath } from '../server/services/projectUploadStorage.cjs';
import { creativeStages, planningFieldNames } from '../src/domain/creative-flow.mjs';

test('项目资料迁移建立输入、参考和文件元数据表', () => {
  const migration = fs.readFileSync(new URL('../server/migrations/013_project_materials.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE project_inputs/);
  assert.match(migration, /CREATE TABLE project_references/);
  assert.match(migration, /workspace_id uuid NOT NULL REFERENCES workspaces/);
  assert.match(migration, /'FACT'.*'OPINION'.*'STRUCTURE'.*'VOICE'.*'HOOK'.*'VISUAL'.*'NEGATIVE'/s);
  assert.match(migration, /source_type = 'FILE'.*storage_key IS NOT NULL/s);
});

test('项目输入和参考 DTO 不暴露服务端存储键', () => {
  const input = inputView({ id: 'input-id', project_id: 'project-id', kind: 'DRAFT', title: '原稿', body: '正文', scope: 'WRITING', platforms_json: ['WECHAT'], created_at: 'created', updated_at: 'updated' });
  assert.deepEqual(input.platforms, ['WECHAT']);
  const reference = referenceView({ id: 'reference-id', project_id: 'project-id', source_type: 'FILE', role: 'VISUAL', title: '参考图', notes: '', storage_key: 'private/path.png', original_filename: 'reference.png', mime_type: 'image/png', size_bytes: '128', sha256: 'hash', scope: 'IMAGING', platforms_json: [], created_at: 'created', updated_at: 'updated' });
  assert.equal(reference.sizeBytes, 128);
  assert.equal('storageKey' in reference, false);
});

test('新增项目内容从正文首行生成标题，用户无需先填写标题', () => {
  assert.equal(deriveProjectInputTitle('  # 普通人如何使用 AI\n后续正文', 'IDEA'), '普通人如何使用 AI');
  assert.equal(deriveProjectInputTitle('第一行很长但仍然是标题\n第二行', 'DRAFT'), '第一行很长但仍然是标题');
  assert.equal(deriveProjectInputTitle('   \n   ', 'NOTE'), '未命名笔记');
});

test('项目资料列表始终按工作空间和项目隔离', async () => {
  const calls = [];
  const store = createProjectMaterialStore({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } });
  const result = await store.list('workspace-a', 'project-a');
  assert.deepEqual(result, { inputs: [], references: [] });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => /workspace_id = \$1 AND project_id = \$2/.test(call.sql)));
  assert.ok(calls.every((call) => call.params[0] === 'workspace-a' && call.params[1] === 'project-a'));
});

test('更新其它工作空间不存在的资料会返回 404', async () => {
  const store = createProjectMaterialStore({ query: async () => ({ rowCount: 0, rows: [] }) });
  await assert.rejects(() => store.updateInput('workspace-a', '11111111-1111-4111-8111-111111111111', { kind: 'IDEA', title: '标题', body: '正文', scope: 'PROJECT', platforms: [] }), (error) => error.statusCode === 404);
  await assert.rejects(() => store.updateReference('workspace-a', '22222222-2222-4222-8222-222222222222', { role: 'FACT', title: '来源', notes: '', scope: 'RESEARCH', platforms: [] }), (error) => error.statusCode === 404);
});

test('上传目录拒绝路径穿越且只开放声明的媒体类型', () => {
  const root = path.resolve('temporary-upload-root');
  assert.throws(() => safePath(root, '..\\outside.txt'), /路径无效/);
  assert.equal(safePath(root, path.join('workspace', 'project', 'file.png')), path.join(root, 'workspace', 'project', 'file.png'));
  assert.equal(MIME_EXTENSIONS.get('image/png'), '.png');
  assert.equal(MIME_EXTENSIONS.has('text/html'), false);
});

test('项目资料 API 提供完整 CRUD、鉴权下载和 50MB 限制', () => {
  const source = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/v1\/creative\/projects\/:projectId\/materials'/);
  assert.match(source, /app\.post\('\/api\/v1\/creative\/projects\/:projectId\/inputs'/);
  assert.match(source, /app\.post\('\/api\/v1\/creative\/projects\/:projectId\/references'/);
  assert.match(source, /app\.post\('\/api\/v1\/creative\/projects\/:projectId\/files'/);
  assert.match(source, /app\.get\('\/api\/v1\/creative\/project-files\/:id\/content', \{ preHandler: authenticate \}/);
  assert.match(source, /fileSize: 50 \* 1024 \* 1024/);
});

test('研究是创作中的按需入口，篇幅只在写作策略出现', () => {
  const copy = fs.readFileSync(new URL('../src/workspaces/create/CopyWorkspace.tsx', import.meta.url), 'utf8');
  const materials = fs.readFileSync(new URL('../src/workspaces/create/ProjectMaterials.tsx', import.meta.url), 'utf8');
  const workspace = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.deepEqual(creativeStages.slice(0, 2).map(({ id }) => id), ['planning', 'master']);
  assert.equal(planningFieldNames.some((name) => /篇幅/.test(name)), false);
  assert.match(copy, /目标篇幅/);
  assert.match(copy, /补充研究/);
  assert.match(workspace, /onOpenResearch=\{\(\) => onStage\('research'\)\}/);
  assert.match(materials, /我的内容[\s\S]*参考链接[\s\S]*素材文件/);
  assert.match(materials, /webCreative\.createInput[\s\S]*webCreative\.createReference[\s\S]*webCreative\.uploadFile/);
  assert.match(materials, /!inputItem[\s\S]*正文/);
  assert.match(materials, /const canSave = isInput[\s\S]*body\.trim\(\)[\s\S]*!inputItem/);
});
