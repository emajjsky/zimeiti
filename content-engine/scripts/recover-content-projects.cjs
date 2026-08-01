const { query, transaction, close } = require('../server/db.cjs');
const { normalizeProject, planningWithDefaults } = require('../server/services/project-planning.cjs');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function timestamp(value) {
  return value ? new Date(value).toISOString() : null;
}

function titleFromBrief(brief, fallback) {
  const objective = String(brief?.objective ?? '');
  return objective.match(/围绕[“"](.+?)[”"]/)?.[1]?.trim() || fallback;
}

function latestByPlatform(rows) {
  const latest = new Map();
  for (const row of rows) if (!latest.has(row.platform)) latest.set(row.platform, row);
  return [...latest.values()];
}

function visualStyle(assets) {
  return assets.some((asset) => String(asset.title).includes('纸张拼贴')) ? 'PAPER_COLLAGE' : 'FRESH_EDITORIAL';
}

function uniqueVisualAssets(assets) {
  const seen = new Set();
  return assets.filter((asset) => {
    const key = String(asset.sha256 || asset.asset_id).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function recoverProject(workspaceId, projectId, buildVisualPlan, visualPlanVersion) {
  const [planningRows, briefRows, platformRows, artifactRows, referenceRows, assetRows, masterRows] = await Promise.all([
    query(`SELECT version_number, status, planning_json, source_snapshot_json, created_at, confirmed_at
      FROM project_planning_versions WHERE workspace_id = $1 AND project_id = $2 ORDER BY version_number DESC`, [workspaceId, projectId]),
    query(`SELECT objective, target_audience, core_message, source_requirements, length_target,
      selected_platforms_json, notes, account_voice_profile_id, voice_offset, created_at, updated_at
      FROM writing_briefs WHERE workspace_id = $1 AND project_id = $2 ORDER BY updated_at DESC`, [workspaceId, projectId]),
    query(`SELECT id, platform, version_number, title, body, facts_to_verify_json, created_at
      FROM platform_content_versions WHERE workspace_id = $1 AND project_id = $2 ORDER BY platform, version_number DESC`, [workspaceId, projectId]),
    query(`SELECT artifact_type, stage, platform, status, title, metadata_json, created_at, updated_at
      FROM project_artifacts WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC`, [workspaceId, projectId]),
    query(`SELECT id, source_type, role, title, notes, url, platforms_json, created_at, updated_at
      FROM project_references WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at`, [workspaceId, projectId]),
    query(`SELECT link.id AS link_id, asset.id AS asset_id, link.role, link.scope, link.title, link.notes, link.platforms_json,
        asset.kind, asset.origin, asset.original_filename, asset.mime_type, asset.size_bytes, asset.sha256, asset.created_at, asset.updated_at
      FROM project_asset_links link
      JOIN workspace_assets asset ON asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
      WHERE link.workspace_id = $1 AND link.project_id = $2 AND asset.status = 'ACTIVE'
      ORDER BY link.sort_order, link.created_at`, [workspaceId, projectId]),
    query(`SELECT thesis, facts_to_verify_json, created_at FROM content_master_versions
      WHERE workspace_id = $1 AND project_id = $2 ORDER BY version_number DESC`, [workspaceId, projectId]),
  ]);

  const latestPlanning = planningRows.rows[0];
  const latestBrief = briefRows.rows[0];
  const platformVersions = latestByPlatform(platformRows.rows);
  const latestArtifact = artifactRows.rows[0];
  const latestMaster = masterRows.rows[0];
  const fallbackTitle = platformVersions[0]?.title || latestArtifact?.title || `恢复项目 ${projectId}`;
  const title = latestPlanning?.planning_json?.title || titleFromBrief(latestBrief, fallbackTitle);
  const targetPlatforms = latestPlanning?.planning_json?.targetPlatforms
    || latestBrief?.selected_platforms_json
    || platformVersions.map((version) => version.platform);
  const planning = planningWithDefaults(latestPlanning?.planning_json || {
    title,
    category: '',
    objective: latestBrief?.objective,
    targetAudience: latestBrief?.target_audience,
    coreMessage: latestBrief?.core_message || latestMaster?.thesis,
    targetPlatforms,
    timing: 'EVERGREEN',
    sourceRequirements: latestBrief?.source_requirements,
    constraints: latestBrief?.notes,
  });
  const confirmedAt = planningRows.rows.find((row) => row.status === 'CONFIRMED')?.confirmed_at;
  const allTimes = [
    ...planningRows.rows.flatMap((row) => [row.created_at, row.confirmed_at]),
    ...briefRows.rows.flatMap((row) => [row.created_at, row.updated_at]),
    ...platformRows.rows.map((row) => row.created_at),
    ...artifactRows.rows.flatMap((row) => [row.created_at, row.updated_at]),
    ...referenceRows.rows.flatMap((row) => [row.created_at, row.updated_at]),
    ...assetRows.rows.flatMap((row) => [row.created_at, row.updated_at]),
    ...masterRows.rows.map((row) => row.created_at),
  ].filter(Boolean).map((value) => new Date(value).getTime());
  const createdAt = new Date(Math.min(...allTimes)).toISOString();
  const updatedAt = new Date(Math.max(...allTimes)).toISOString();
  const versions = platformVersions.map((row) => ({
    id: String(row.id),
    platform: row.platform,
    status: 'DRAFT',
    title: row.title,
    body: row.body,
    updatedAt: timestamp(row.created_at),
  }));
  for (const platform of targetPlatforms) {
    if (versions.some((version) => version.platform === platform)) continue;
    versions.push({ id: `${projectId}-${platform.toLowerCase()}-recovered`, platform, status: 'DRAFT', title, body: '', updatedAt });
  }

  const delivery = { platforms: {} };
  for (const version of versions.filter((item) => item.platform !== 'VIDEO_CHANNEL')) {
    const assets = assetRows.rows.filter((asset) => asset.kind === 'IMAGE' && (!asset.platforms_json?.length || asset.platforms_json.includes(version.platform)));
    if (!assets.length) {
      delivery.platforms[version.platform] = { stage: 'COPY', visual: null, review: null };
      continue;
    }
    const assignableAssets = uniqueVisualAssets(assets);
    const bodyItemCount = version.platform === 'WEIBO' ? assets.length : Math.max(0, assets.length - 1);
    const plan = buildVisualPlan({ title: version.title || title, body: version.body, category: planning.category, coreMessage: planning.coreMessage }, version.platform, { bodyItemCount });
    for (const [index, item] of plan.entries()) item.assetId = assignableAssets[index]?.asset_id ?? null;
    const assigned = plan.filter((item) => item.assetId);
    const coverAssetId = assigned.find((item) => item.role === 'COVER' || item.role === 'MAIN')?.assetId ?? assigned[0]?.assetId ?? null;
    delivery.platforms[version.platform] = {
      stage: 'VISUAL',
      visual: {
        planVersion: visualPlanVersion,
        styleProfile: { preset: visualStyle(assets), customPrompt: '' },
        coverAssetId,
        assetIds: assigned.map((item) => item.assetId),
        assets: assigned.map((item) => {
          const asset = assignableAssets.find((candidate) => candidate.asset_id === item.assetId);
          return { assetId: item.assetId, title: asset?.title ?? item.title, role: item.role === 'COVER' || item.role === 'MAIN' ? 'COVER' : 'BODY', url: null, planItemId: item.id, placement: item.placement, purpose: item.purpose };
        }),
        plan,
        updatedAt,
      },
      review: null,
    };
  }

  const hasVisuals = assetRows.rows.some((asset) => asset.kind === 'IMAGE');
  const hasVersions = platformVersions.some((version) => String(version.body).trim());
  const stage = hasVisuals ? 'PLATFORM_ADAPTATION' : hasVersions ? 'PLATFORM_ADAPTATION' : confirmedAt ? 'RESEARCH' : latestBrief ? 'MASTER_WRITING' : 'PLANNING';
  const status = hasVisuals ? 'VISUAL' : hasVersions || latestBrief ? 'WRITING' : 'BRIEF';
  const factChecks = [...new Set([
    ...(latestMaster?.facts_to_verify_json ?? []),
    ...platformVersions.flatMap((version) => version.facts_to_verify_json ?? []),
  ].map(String).filter(Boolean))];
  const sourceSnapshot = latestPlanning?.source_snapshot_json ?? {};
  return normalizeProject({
    id: projectId,
    title,
    originType: sourceSnapshot.intelligence ? 'HOTSPOT' : 'LEGACY',
    ...(sourceSnapshot.intelligence?.id ? { originReferenceId: sourceSnapshot.intelligence.id } : {}),
    stage,
    status,
    planning,
    planningVersion: Number(latestPlanning?.version_number ?? 0),
    ...(confirmedAt ? { planningConfirmedAt: timestamp(confirmedAt) } : {}),
    coreViewpoint: planning.coreMessage,
    factChecks,
    versions,
    sourceSnapshot,
    delivery,
    createdAt,
    updatedAt,
  }, updatedAt);
}

async function main() {
  const workspaceId = option('--workspace');
  const apply = process.argv.includes('--apply');
  if (!workspaceId) throw new Error('请使用 --workspace 指定工作空间 ID。');
  const { buildVisualPlan, VISUAL_PLAN_VERSION } = await import('../src/domain/visual-plan.mjs');
  const ids = await query(`WITH ids AS (
    SELECT project_id FROM project_planning_versions WHERE workspace_id = $1
    UNION SELECT project_id FROM writing_briefs WHERE workspace_id = $1
    UNION SELECT project_id FROM platform_content_versions WHERE workspace_id = $1
    UNION SELECT project_id FROM project_artifacts WHERE workspace_id = $1
    UNION SELECT project_id FROM project_references WHERE workspace_id = $1
    UNION SELECT project_id FROM project_asset_links WHERE workspace_id = $1
    UNION SELECT project_id FROM content_master_versions WHERE workspace_id = $1
  ) SELECT project_id FROM ids ORDER BY project_id`, [workspaceId]);
  const projects = [];
  for (const row of ids.rows) projects.push(await recoverProject(workspaceId, row.project_id, buildVisualPlan, VISUAL_PLAN_VERSION));
  projects.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const summary = projects.map((project) => ({ id: project.id, title: project.title, stage: project.stage, versions: project.versions.length, visuals: Object.values(project.delivery?.platforms ?? {}).reduce((count, item) => count + (item.visual?.assetIds.length ?? 0), 0) }));
  if (!apply) {
    console.log(JSON.stringify({ apply: false, workspaceId, projects: summary }, null, 2));
    return;
  }
  await transaction(async (client) => {
    const existing = await client.query('SELECT count(*)::int count FROM content_projects WHERE workspace_id = $1', [workspaceId]);
    if (existing.rows[0].count > 0) throw new Error('目标工作空间已有项目，拒绝覆盖恢复。');
    for (const [position, project] of projects.entries()) {
      await client.query(`INSERT INTO content_projects (workspace_id, project_id, project_json, position, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [workspaceId, project.id, JSON.stringify(project), position, project.createdAt, project.updatedAt]);
    }
  });
  console.log(JSON.stringify({ apply: true, workspaceId, projects: summary }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(close);
}

module.exports = { recoverProject, uniqueVisualAssets };
