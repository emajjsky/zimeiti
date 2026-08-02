const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseOutputDirectory(argv) {
  const explicit = argumentValue(argv, '--output');
  if (explicit) return explicit;
  const positional = argv.filter((value) => !String(value).startsWith('-'));
  return positional.length === 1 && path.isAbsolute(positional[0]) ? positional[0] : null;
}

async function validateArchiveOutputPath(value, { workspaceRoot = process.cwd() } = {}) {
  const input = String(value ?? '').trim();
  if (!input || !path.isAbsolute(input)) throw new Error('归档输出目录必须使用绝对路径。');
  const resolved = path.resolve(input);
  const driveRoot = path.parse(resolved).root;
  if (resolved === driveRoot) throw new Error('归档输出目录不能是磁盘根目录。');
  if (resolved === path.resolve(workspaceRoot)) throw new Error('归档输出目录不能是项目根目录。');
  const entries = await fs.readdir(resolved).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (entries?.length) throw new Error('归档输出目录是非空目录，拒绝覆盖。');
  return resolved;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function hashFile(filename) {
  const content = await fs.readFile(filename);
  return { sizeBytes: content.byteLength, sha256: sha256Buffer(content) };
}

function safeFilename(value) {
  const normalized = String(value || '未命名项目').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  return (normalized || '未命名项目').slice(0, 80);
}

function collectStringValues(value, output = new Set()) {
  if (typeof value === 'string') output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStringValues(item, output));
  return output;
}

function draftPreflight(projects, versions) {
  const historyByKey = new Map();
  const byKey = new Map();
  for (const row of versions) {
    if (!['WECHAT', 'XIAOHONGSHU', 'WEIBO'].includes(row.platform)) continue;
    const key = `${row.workspace_id}:${row.project_id}:${row.platform}`;
    const history = historyByKey.get(key) ?? [];
    history.push(row);
    historyByKey.set(key, history);
    const candidate = { title: row.title || '', body: row.body || '', versionNumber: Number(row.version_number || 0) };
    const existing = byKey.get(key);
    if (!existing || candidate.versionNumber >= existing.versionNumber) byKey.set(key, { ...candidate, workspaceId: row.workspace_id, projectId: row.project_id, platform: row.platform, versionCount: history.length });
  }
  for (const row of projects) {
    const values = Array.isArray(row.project_json?.versions) ? row.project_json.versions : [];
    values.forEach((version, index) => {
      if (!['WECHAT', 'XIAOHONGSHU', 'WEIBO'].includes(version?.platform)) return;
      const key = `${row.workspace_id}:${row.project_id}:${version.platform}`;
      const history = historyByKey.get(key) ?? [];
      const matchesHistory = history.some((item) => (item.title || '') === (version.title || '') && (item.body || '') === (version.body || ''));
      byKey.set(key, {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        platform: version.platform,
        title: version.title || '',
        body: version.body || '',
        versionNumber: Math.max(Number(byKey.get(key)?.versionNumber || 0) + (matchesHistory ? 0 : 1), index + 1),
        versionCount: history.length + (matchesHistory ? 0 : 1),
      });
    });
    const wechatKey = `${row.workspace_id}:${row.project_id}:WECHAT`;
    if (!byKey.has(wechatKey)) byKey.set(wechatKey, { workspaceId: row.workspace_id, projectId: row.project_id, platform: 'WECHAT', title: '', body: '', versionNumber: 0, versionCount: 0 });
  }
  const drafts = [...byKey.values()].sort((a, b) => `${a.workspaceId}:${a.projectId}:${a.platform}`.localeCompare(`${b.workspaceId}:${b.projectId}:${b.platform}`));
  return drafts.map((draft) => ({
    ...draft,
    titleSha256: sha256Buffer(Buffer.from(draft.title, 'utf8')),
    bodySha256: sha256Buffer(Buffer.from(draft.body, 'utf8')),
  }));
}

async function loadArchiveData(query) {
  const [projects, versions, strategies, artifacts, summaries, assets] = await Promise.all([
    query('SELECT workspace_id, project_id, project_json, created_at, updated_at FROM content_projects ORDER BY workspace_id, position, project_id'),
    query('SELECT * FROM platform_content_versions ORDER BY workspace_id, project_id, platform, version_number'),
    query("SELECT * FROM platform_strategies WHERE platform = 'ZHIHU' ORDER BY workspace_id, project_id"),
    query("SELECT * FROM project_artifacts WHERE platform = 'ZHIHU' ORDER BY workspace_id, project_id, created_at"),
    query("SELECT * FROM project_stage_summaries WHERE platform = 'ZHIHU' ORDER BY workspace_id, project_id, version"),
    query('SELECT id, workspace_id, title, original_filename, mime_type, size_bytes, sha256, storage_key FROM workspace_assets ORDER BY workspace_id, id'),
  ]);
  return {
    projects: projects.rows,
    versions: versions.rows,
    strategies: strategies.rows,
    artifacts: artifacts.rows,
    summaries: summaries.rows,
    assets: assets.rows,
  };
}

function zhihuProjectRows(data) {
  const keys = new Set();
  data.versions.filter((row) => row.platform === 'ZHIHU').forEach((row) => keys.add(`${row.workspace_id}:${row.project_id}`));
  data.strategies.forEach((row) => keys.add(`${row.workspace_id}:${row.project_id}`));
  data.artifacts.forEach((row) => keys.add(`${row.workspace_id}:${row.project_id}`));
  data.summaries.forEach((row) => keys.add(`${row.workspace_id}:${row.project_id}`));
  data.projects.filter((row) => {
    const project = row.project_json ?? {};
    const versions = Array.isArray(project.versions) ? project.versions : [];
    const targets = Array.isArray(project.planning?.targetPlatforms) ? project.planning.targetPlatforms : [];
    const deliveryPlatforms = project.delivery?.platforms;
    return project.platform === 'ZHIHU'
      || versions.some((version) => version?.platform === 'ZHIHU')
      || targets.includes('ZHIHU')
      || Boolean(deliveryPlatforms && typeof deliveryPlatforms === 'object' && Object.hasOwn(deliveryPlatforms, 'ZHIHU'));
  }).forEach((row) => keys.add(`${row.workspace_id}:${row.project_id}`));
  return data.projects.filter((row) => keys.has(`${row.workspace_id}:${row.project_id}`));
}

async function createArchive({ outputDirectory, query, uploadRoot }) {
  const output = await validateArchiveOutputPath(outputDirectory);
  await fs.mkdir(output, { recursive: true });
  const data = await loadArchiveData(query);
  const zhihuProjects = zhihuProjectRows(data);
  const projectKeys = new Set(zhihuProjects.map((row) => `${row.workspace_id}:${row.project_id}`));
  const referencedStrings = new Set();
  zhihuProjects.forEach((row) => collectStringValues(row.project_json, referencedStrings));
  const zhihuAssets = data.assets.filter((asset) => referencedStrings.has(asset.id));
  const allAssetFiles = [];
  for (const asset of data.assets) {
    const filename = path.resolve(uploadRoot, asset.storage_key);
    const root = path.resolve(uploadRoot);
    if (!filename.startsWith(`${root}${path.sep}`)) throw new Error(`素材路径越界：${asset.id}`);
    const actual = await hashFile(filename).catch((error) => {
      throw new Error(`素材文件缺失或不可读：${asset.id}（${error.code || error.message}）`);
    });
    if (actual.sizeBytes !== Number(asset.size_bytes) || actual.sha256 !== asset.sha256) throw new Error(`素材文件校验失败：${asset.id}`);
    allAssetFiles.push({ assetId: asset.id, workspaceId: asset.workspace_id, storageKey: asset.storage_key, ...actual });
  }
  const archiveProjects = zhihuProjects.map((project) => ({
    workspaceId: project.workspace_id,
    projectId: project.project_id,
    project: project.project_json,
    versions: data.versions.filter((row) => row.workspace_id === project.workspace_id && row.project_id === project.project_id && row.platform === 'ZHIHU'),
    strategies: data.strategies.filter((row) => row.workspace_id === project.workspace_id && row.project_id === project.project_id),
    artifacts: data.artifacts.filter((row) => row.workspace_id === project.workspace_id && row.project_id === project.project_id),
    summaries: data.summaries.filter((row) => row.workspace_id === project.workspace_id && row.project_id === project.project_id),
  }));
  const drafts = draftPreflight(data.projects, data.versions);
  const draftsByPlatform = Object.fromEntries(['WECHAT', 'XIAOHONGSHU', 'WEIBO'].map((platform) => [platform, drafts.filter((draft) => draft.platform === platform).length]));
  const assetManifest = zhihuAssets.map((asset) => ({
    assetId: asset.id,
    workspaceId: asset.workspace_id,
    title: asset.title,
    originalFilename: asset.original_filename,
    mimeType: asset.mime_type,
    sizeBytes: Number(asset.size_bytes),
    sha256: asset.sha256,
    storageKey: asset.storage_key,
  }));
  const writtenFiles = [];
  async function writeJson(name, value) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    await fs.writeFile(path.join(output, name), content, { flag: 'wx' });
    writtenFiles.push({ name, sizeBytes: Buffer.byteLength(content), sha256: sha256Buffer(Buffer.from(content)) });
  }
  await writeJson('zhihu-projects.json', archiveProjects);
  await writeJson('asset-manifest.json', assetManifest);
  const markdownDir = path.join(output, 'projects');
  await fs.mkdir(markdownDir);
  for (const [index, project] of archiveProjects.entries()) {
    const title = project.project?.title || project.projectId;
    const sections = project.versions.map((version) => `## 版本 ${version.version_number}\n\n### ${version.title || '无标题'}\n\n${version.body || ''}`);
    const content = `# ${title}\n\n- 工作空间：${project.workspaceId}\n- 项目：${project.projectId}\n- 归档平台：知乎\n\n${sections.join('\n\n')}\n`;
    const name = `${String(index + 1).padStart(3, '0')}-${safeFilename(title)}.md`;
    await fs.writeFile(path.join(markdownDir, name), content, { flag: 'wx' });
    writtenFiles.push({ name: `projects/${name}`, sizeBytes: Buffer.byteLength(content), sha256: sha256Buffer(Buffer.from(content)) });
  }
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    counts: {
      projects: data.projects.length,
      zhihuProjects: archiveProjects.length,
      zhihuVersions: data.versions.filter((row) => row.platform === 'ZHIHU').length,
      zhihuStrategies: data.strategies.length,
      zhihuArtifacts: data.artifacts.length,
      zhihuSummaries: data.summaries.length,
      assets: data.assets.length,
    },
    expected: { projects: data.projects.length, draftsByPlatform, draftVersions: drafts.reduce((sum, draft) => sum + draft.versionCount, 0) },
    drafts,
    assetFiles: allAssetFiles,
    archiveFiles: writtenFiles,
    archiveDigest: sha256Buffer(Buffer.from(stableJson({ archiveProjects, assetManifest, drafts }))),
  };
  await writeJson('manifest.json', manifest);
  return { outputDirectory: output, manifest, projectKeys: [...projectKeys] };
}

async function main() {
  const outputDirectory = parseOutputDirectory(process.argv.slice(2));
  if (!outputDirectory) throw new Error('请使用 --output 指定绝对归档目录。');
  const { query, close } = require('../server/db.cjs');
  const { uploadRoot } = require('../server/config.cjs');
  try {
    const result = await createArchive({ outputDirectory, query, uploadRoot });
    process.stdout.write(`${JSON.stringify({ ok: true, outputDirectory: result.outputDirectory, counts: result.manifest.counts }, null, 2)}\n`);
  } finally {
    await close();
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { parseOutputDirectory, validateArchiveOutputPath, createArchive, draftPreflight, zhihuProjectRows };
