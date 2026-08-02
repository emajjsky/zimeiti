import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const migration = await readFile(new URL('../server/migrations/028_content_draft_foundation.sql', import.meta.url), 'utf8');
const { draftPreflight, parseOutputDirectory, validateArchiveOutputPath, zhihuProjectRows } = require('../scripts/export-zhihu-archive.cjs');
const { buildVerificationSummary } = require('../scripts/verify-draft-migration.cjs');

test('迁移建立工作空间隔离的草稿、模板、账号和平台草稿任务表', () => {
  assert.match(migration, /CREATE TABLE content_drafts/);
  assert.match(migration, /platform text NOT NULL CHECK \(platform IN \('WECHAT', 'XIAOHONGSHU', 'WEIBO'\)\)/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, project_id\)[\s\S]*REFERENCES content_projects\(workspace_id, project_id\)/);
  assert.match(migration, /UNIQUE \(workspace_id, project_id, platform\)/);
  assert.match(migration, /revision integer NOT NULL DEFAULT 1 CHECK \(revision > 0\)/);
  assert.match(migration, /source_stale boolean NOT NULL DEFAULT false/);
  assert.match(migration, /CREATE TABLE content_draft_versions/);
  assert.match(migration, /UNIQUE \(workspace_id, draft_id, version_number\)/);
  assert.match(migration, /source_draft_version_id uuid/);
  assert.match(migration, /CREATE TABLE content_draft_assets/);
  assert.match(migration, /CREATE UNIQUE INDEX content_draft_assets_working_order_idx/);
  assert.match(migration, /CREATE UNIQUE INDEX content_draft_assets_version_order_idx/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, asset_id\)[\s\S]*REFERENCES workspace_assets\(workspace_id, id\)/);
  assert.match(migration, /CREATE TABLE wechat_layout_template_versions/);
  assert.match(migration, /CREATE TABLE channel_accounts/);
  assert.match(migration, /capabilities_json jsonb NOT NULL/);
  assert.match(migration, /CREATE TABLE platform_draft_tasks/);
  assert.match(migration, /UNIQUE \(workspace_id, idempotency_key\)/);
});

test('模板版本被草稿引用时不能级联删除', () => {
  const draftTemplateReference = migration.match(/ADD CONSTRAINT content_drafts_layout_template_fk[\s\S]*?;/)?.[0] ?? '';
  const versionTemplateReference = migration.match(/ADD CONSTRAINT content_draft_versions_layout_template_fk[\s\S]*?;/)?.[0] ?? '';
  assert.match(draftTemplateReference, /ON DELETE RESTRICT/);
  assert.match(versionTemplateReference, /ON DELETE RESTRICT/);
  assert.doesNotMatch(draftTemplateReference, /ON DELETE CASCADE/);
  assert.doesNotMatch(versionTemplateReference, /ON DELETE CASCADE/);
});

test('迁移把正文与视觉策略一次性切换到显式 Scope', () => {
  assert.match(migration, /WECHAT_COPY_GENERATION/);
  assert.match(migration, /WECHAT_VISUAL_PLANNING/);
  assert.match(migration, /wechat-visual-planning:1\.0\.0/);
  assert.match(migration, /CREATIVE_DRAFT_WECHAT/);
  assert.match(migration, /DELETE FROM agent_model_policies[\s\S]*CONTENT_WRITING[\s\S]*VISUAL_PLANNING/);
});

test('迁移预置六个真实公众号模板并回填三平台版本', () => {
  for (const name of ['清爽阅读', '商务报告', '科技媒体', '人文杂志', '现代报刊', '知识长文']) {
    assert.match(migration, new RegExp(name));
  }
  assert.match(migration, /INSERT INTO content_drafts[\s\S]*platform_content_versions/);
  assert.match(migration, /MIGRATED_CURRENT/);
  assert.match(migration, /source_draft_version_id/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION seed_wechat_layout_templates\(target_workspace_id uuid\)/);
  assert.match(migration, /SELECT seed_wechat_layout_templates\(workspace\.id\)[\s\S]*FROM workspaces workspace/);
  assert.doesNotMatch(migration, /DROP TABLE platform_content_versions/);
  assert.doesNotMatch(migration, /project_json\s*=\s*project_json\s*-\s*'delivery'/);
});

test('知乎归档输出目录必须绝对、安全且为空', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'content-engine-archive-'));
  const empty = path.join(root, 'empty');
  const nonEmpty = path.join(root, 'non-empty');
  await mkdir(empty);
  await mkdir(nonEmpty);
  await writeFile(path.join(nonEmpty, 'keep.txt'), 'keep');
  try {
    assert.equal(await validateArchiveOutputPath(empty, { workspaceRoot: process.cwd() }), path.resolve(empty));
    await assert.rejects(() => validateArchiveOutputPath('relative-output', { workspaceRoot: process.cwd() }), /绝对路径/);
    await assert.rejects(() => validateArchiveOutputPath(path.parse(root).root, { workspaceRoot: process.cwd() }), /磁盘根目录/);
    await assert.rejects(() => validateArchiveOutputPath(process.cwd(), { workspaceRoot: process.cwd() }), /项目根目录/);
    await assert.rejects(() => validateArchiveOutputPath(nonEmpty, { workspaceRoot: process.cwd() }), /非空目录/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('知乎归档命令兼容 npm 在 Windows 上只转交绝对路径的行为', () => {
  assert.equal(parseOutputDirectory(['--output', 'C:\\backup\\zhihu']), 'C:\\backup\\zhihu');
  assert.equal(parseOutputDirectory(['C:\\backup\\zhihu']), 'C:\\backup\\zhihu');
  assert.equal(parseOutputDirectory(['relative']), null);
});

test('迁移校验任一计数、引用或文件哈希不一致都会失败', () => {
  const summary = buildVerificationSummary({
    expected: { projects: 56, draftsByPlatform: { WECHAT: 56, XIAOHONGSHU: 56, WEIBO: 7 } },
    actual: { projects: 56, draftsByPlatform: { WECHAT: 56, XIAOHONGSHU: 55, WEIBO: 7 } },
    brokenReferences: 0,
    missingFiles: [],
    hashMismatches: [{ assetId: 'asset-1' }],
    orphanDerivedDrafts: 0,
    activeZhihuRows: 0,
    legacyProjectJsonRows: 0,
  });
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.failures.map(({ code }) => code), ['DRAFT_COUNT_MISMATCH', 'ASSET_HASH_MISMATCH']);
});

test('预检版本数会为不同于历史最新版的项目当前稿增加一个迁移版本', () => {
  const projects = [{
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    project_json: { versions: [{ platform: 'WECHAT', title: '当前标题', body: '当前正文' }] },
  }];
  const versions = [
    { workspace_id: 'workspace-1', project_id: 'project-1', platform: 'WECHAT', version_number: 1, title: '标题 1', body: '正文 1' },
    { workspace_id: 'workspace-1', project_id: 'project-1', platform: 'WECHAT', version_number: 2, title: '标题 2', body: '正文 2' },
  ];
  assert.equal(draftPreflight(projects, versions)[0].versionCount, 3);
  projects[0].project_json.versions[0] = { platform: 'WECHAT', title: '标题 2', body: '正文 2' };
  assert.equal(draftPreflight(projects, versions)[0].versionCount, 2);
});

test('知乎归档只识别结构化平台数据，不因正文提到知乎而误收项目', () => {
  const data = {
    projects: [
      { workspace_id: 'w', project_id: 'mentioned', project_json: { versions: [{ platform: 'WECHAT', body: '这段正文提到知乎。' }] } },
      { workspace_id: 'w', project_id: 'structured', project_json: { delivery: { platforms: { ZHIHU: { stage: 'COPY' } } } } },
    ],
    versions: [], strategies: [], artifacts: [], summaries: [],
  };
  assert.deepEqual(zhihuProjectRows(data).map(({ project_id }) => project_id), ['structured']);
});
