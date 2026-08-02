const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseManifestPath(argv) {
  const explicit = argumentValue(argv, '--manifest');
  if (explicit) return explicit;
  const positional = argv.filter((value) => !String(value).startsWith('-'));
  return positional.length === 1 && path.isAbsolute(positional[0]) ? positional[0] : null;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function buildVerificationSummary(input) {
  const failures = [];
  const expectedPlatforms = input.expected?.draftsByPlatform ?? {};
  const actualPlatforms = input.actual?.draftsByPlatform ?? {};
  if (Number(input.expected?.projects ?? 0) !== Number(input.actual?.projects ?? 0)) failures.push({ code: 'PROJECT_COUNT_MISMATCH', expected: input.expected?.projects, actual: input.actual?.projects });
  for (const platform of ['WECHAT', 'XIAOHONGSHU', 'WEIBO']) {
    if (Number(expectedPlatforms[platform] ?? 0) !== Number(actualPlatforms[platform] ?? 0)) {
      failures.push({ code: 'DRAFT_COUNT_MISMATCH', platform, expected: expectedPlatforms[platform] ?? 0, actual: actualPlatforms[platform] ?? 0 });
    }
  }
  if (input.expected?.draftVersions !== undefined && Number(input.expected.draftVersions) !== Number(input.actual?.draftVersions ?? 0)) failures.push({ code: 'DRAFT_VERSION_COUNT_MISMATCH', expected: input.expected.draftVersions, actual: input.actual?.draftVersions ?? 0 });
  if (Number(input.brokenReferences ?? 0) > 0) failures.push({ code: 'BROKEN_REFERENCE', count: Number(input.brokenReferences) });
  if (input.missingFiles?.length) failures.push({ code: 'ASSET_FILE_MISSING', count: input.missingFiles.length, assets: input.missingFiles });
  if (input.hashMismatches?.length) failures.push({ code: 'ASSET_HASH_MISMATCH', count: input.hashMismatches.length, assets: input.hashMismatches });
  if (Number(input.orphanDerivedDrafts ?? 0) > 0) failures.push({ code: 'ORPHAN_DERIVED_DRAFT', count: Number(input.orphanDerivedDrafts) });
  if (Number(input.activeZhihuRows ?? 0) > 0) failures.push({ code: 'ACTIVE_ZHIHU_ROW', count: Number(input.activeZhihuRows) });
  if (Number(input.legacyProjectJsonRows ?? 0) > 0) failures.push({ code: 'LEGACY_PROJECT_JSON', count: Number(input.legacyProjectJsonRows) });
  if (input.currentContentMismatches?.length) failures.push({ code: 'CURRENT_CONTENT_MISMATCH', count: input.currentContentMismatches.length, drafts: input.currentContentMismatches });
  return { ok: failures.length === 0, failures };
}

async function hashFile(filename) {
  const content = await fs.readFile(filename);
  return { sizeBytes: content.byteLength, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

async function tableExists(query, tableName) {
  const result = await query('SELECT to_regclass($1) AS name', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.name);
}

async function collectDatabaseState(query) {
  const [projects, drafts, versions, broken, orphan, legacy] = await Promise.all([
    query('SELECT count(*)::int AS count FROM content_projects'),
    query('SELECT platform, count(*)::int AS count FROM content_drafts GROUP BY platform'),
    query('SELECT count(*)::int AS count FROM content_draft_versions'),
    query(`SELECT count(*)::int AS count FROM content_draft_assets item
      LEFT JOIN content_drafts draft ON draft.workspace_id = item.workspace_id AND draft.id = item.draft_id
      LEFT JOIN workspace_assets asset ON asset.workspace_id = item.workspace_id AND asset.id = item.asset_id
      LEFT JOIN content_draft_versions version ON version.workspace_id = item.workspace_id AND version.id = item.draft_version_id
      WHERE draft.id IS NULL OR asset.id IS NULL OR (item.draft_version_id IS NOT NULL AND version.id IS NULL)`),
    query(`SELECT count(*)::int AS count FROM content_draft_versions version
      WHERE version.platform IN ('XIAOHONGSHU', 'WEIBO')
        AND (version.source_draft_version_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM content_draft_versions source
          WHERE source.workspace_id = version.workspace_id AND source.id = version.source_draft_version_id AND source.platform = 'WECHAT'
        ))`),
    query("SELECT count(*)::int AS count FROM content_projects WHERE project_json ? 'versions' OR project_json ? 'delivery'"),
  ]);
  let activeZhihuRows = Number((await query("SELECT count(*)::int AS count FROM content_projects WHERE project_json::text ~ 'ZHIHU|知乎'")).rows[0]?.count ?? 0);
  for (const table of ['platform_content_versions', 'platform_strategies', 'project_artifacts', 'project_stage_summaries']) {
    if (await tableExists(query, table)) {
      const result = await query(`SELECT count(*)::int AS count FROM ${table} WHERE platform = 'ZHIHU'`);
      activeZhihuRows += Number(result.rows[0]?.count ?? 0);
    }
  }
  return {
    projects: Number(projects.rows[0]?.count ?? 0),
    draftsByPlatform: Object.fromEntries(drafts.rows.map((row) => [row.platform, Number(row.count)])),
    draftVersions: Number(versions.rows[0]?.count ?? 0),
    brokenReferences: Number(broken.rows[0]?.count ?? 0),
    orphanDerivedDrafts: Number(orphan.rows[0]?.count ?? 0),
    activeZhihuRows,
    legacyProjectJsonRows: Number(legacy.rows[0]?.count ?? 0),
  };
}

async function verifyCurrentContent(query, expectedDrafts) {
  const result = await query(`SELECT draft.workspace_id, draft.project_id, draft.platform, version.title, version.body
    FROM content_drafts draft
    LEFT JOIN content_draft_versions version ON version.workspace_id = draft.workspace_id AND version.id = draft.current_version_id`);
  const actual = new Map(result.rows.map((row) => [`${row.workspace_id}:${row.project_id}:${row.platform}`, row]));
  return expectedDrafts.flatMap((draft) => {
    const row = actual.get(`${draft.workspaceId}:${draft.projectId}:${draft.platform}`);
    if (!row || sha256Text(row.title) !== draft.titleSha256 || sha256Text(row.body) !== draft.bodySha256) return [{ workspaceId: draft.workspaceId, projectId: draft.projectId, platform: draft.platform }];
    return [];
  });
}

async function verifyAssetFiles(uploadRoot, assetFiles) {
  const root = path.resolve(uploadRoot);
  const missingFiles = [];
  const hashMismatches = [];
  for (const asset of assetFiles) {
    const filename = path.resolve(root, asset.storageKey);
    if (!filename.startsWith(`${root}${path.sep}`)) {
      hashMismatches.push({ assetId: asset.assetId, reason: 'PATH_OUTSIDE_UPLOAD_ROOT' });
      continue;
    }
    const actual = await hashFile(filename).catch((error) => {
      missingFiles.push({ assetId: asset.assetId, error: error.code || error.message });
      return null;
    });
    if (actual && (actual.sizeBytes !== Number(asset.sizeBytes) || actual.sha256 !== asset.sha256)) hashMismatches.push({ assetId: asset.assetId, expected: { sizeBytes: asset.sizeBytes, sha256: asset.sha256 }, actual });
  }
  return { missingFiles, hashMismatches };
}

async function verifyMigration({ manifestPath, query, uploadRoot }) {
  if (!path.isAbsolute(manifestPath)) throw new Error('迁移清单必须使用绝对路径。');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const actual = await collectDatabaseState(query);
  const files = await verifyAssetFiles(uploadRoot, manifest.assetFiles ?? []);
  const currentContentMismatches = await verifyCurrentContent(query, manifest.drafts ?? []);
  const summary = buildVerificationSummary({ expected: manifest.expected, actual, ...actual, ...files, currentContentMismatches });
  return { ...summary, expected: manifest.expected, actual, checkedAssetFiles: (manifest.assetFiles ?? []).length };
}

async function main() {
  const manifestPath = parseManifestPath(process.argv.slice(2));
  if (!manifestPath) throw new Error('请使用 --manifest 指定绝对迁移清单。');
  const { query, close } = require('../server/db.cjs');
  const { uploadRoot } = require('../server/config.cjs');
  try {
    const summary = await verifyMigration({ manifestPath, query, uploadRoot });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.ok) process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { buildVerificationSummary, parseManifestPath, verifyMigration };
