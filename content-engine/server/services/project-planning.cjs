const { randomUUID } = require('node:crypto');

const DEFAULT_PLATFORMS = ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'];
const PROJECT_STAGES = new Set([
  'PLANNING',
  'RESEARCH',
  'MASTER_WRITING',
  'PLATFORM_ADAPTATION',
  'VISUAL',
  'LAYOUT',
  'REVIEW',
  'COMPLETED',
]);

function stableTimestamp(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function uniquePlatforms(values, fallback = []) {
  const platforms = Array.isArray(values) ? values : fallback;
  return [...new Set(platforms.filter((value) => DEFAULT_PLATFORMS.includes(value)))];
}

function mapProjectStatusToStage(status) {
  return {
    BRIEF: 'PLANNING',
    WRITING: 'MASTER_WRITING',
    VISUAL: 'VISUAL',
    VIDEO: 'VISUAL',
    REVIEW: 'REVIEW',
    SCHEDULED: 'REVIEW',
    PARTIALLY_PUBLISHED: 'COMPLETED',
    PUBLISHED: 'COMPLETED',
    RETROSPECTIVE: 'COMPLETED',
    ARCHIVED: 'COMPLETED',
  }[status] ?? 'PLANNING';
}

function timingForUrgency(urgency) {
  if (urgency === '高') return 'TODAY';
  if (urgency === '中') return 'ONE_WEEK';
  return 'EVERGREEN';
}

function planningDraft(input = {}) {
  return {
    title: String(input.title ?? '').trim(),
    category: String(input.category ?? '').trim(),
    angle: String(input.angle ?? '').trim(),
    objective: String(input.objective ?? '').trim(),
    targetAudience: String(input.targetAudience ?? '').trim(),
    coreMessage: String(input.coreMessage ?? '').trim(),
    targetPlatforms: uniquePlatforms(input.targetPlatforms),
    timing: ['TODAY', 'THREE_DAYS', 'ONE_WEEK', 'EVERGREEN'].includes(input.timing) ? input.timing : 'EVERGREEN',
    ...(input.plannedPublishAt ? { plannedPublishAt: String(input.plannedPublishAt) } : {}),
    sourceRequirements: String(input.sourceRequirements ?? '').trim(),
    constraints: String(input.constraints ?? '').trim(),
  };
}

function planningWithDefaults(input = {}) {
  const planning = planningDraft(input);
  const title = planning.title || '这项内容';
  const category = planning.category || '相关领域';
  return {
    ...planning,
    angle: planning.angle || `从普通读者视角解释“${title}”的变化与实际价值。`,
    objective: planning.objective || `帮助读者清晰理解“${title}”，并形成可行动的判断。`,
    targetAudience: planning.targetAudience || `关注${category}的普通读者。`,
    coreMessage: planning.coreMessage || `“${title}”值得被清晰、可信地理解。`,
  };
}

function normalizeProject(project, now) {
  const versions = Array.isArray(project?.versions) ? project.versions : [];
  const planning = planningDraft({
    title: project?.planning?.title ?? project?.title,
    category: project?.planning?.category ?? project?.category,
    angle: project?.planning?.angle,
    objective: project?.planning?.objective,
    targetAudience: project?.planning?.targetAudience,
    coreMessage: project?.planning?.coreMessage ?? project?.coreViewpoint,
    targetPlatforms: project?.planning?.targetPlatforms ?? versions.map((version) => version.platform),
    timing: project?.planning?.timing,
    plannedPublishAt: project?.planning?.plannedPublishAt,
    sourceRequirements: project?.planning?.sourceRequirements ?? (project?.factChecks ?? []).join('；'),
    constraints: project?.planning?.constraints,
  });
  const createdAt = stableTimestamp(project?.createdAt ?? project?.updatedAt, now);
  const updatedAt = stableTimestamp(project?.updatedAt ?? project?.createdAt, createdAt);
  return {
    ...project,
    id: String(project?.id ?? `project-${randomUUID()}`),
    title: planning.title || '未命名创作',
    originType: ['HOTSPOT', 'MANUAL', 'DRAFT', 'IMPORT', 'LEGACY'].includes(project?.originType) ? project.originType : 'LEGACY',
    stage: PROJECT_STAGES.has(project?.stage) ? project.stage : mapProjectStatusToStage(project?.status),
    status: project?.status ?? 'BRIEF',
    planning,
    planningVersion: Number.isInteger(project?.planningVersion) && project.planningVersion >= 0 ? project.planningVersion : (project?.planningConfirmedAt ? 1 : 0),
    coreViewpoint: String(project?.coreViewpoint ?? planning.coreMessage),
    factChecks: Array.isArray(project?.factChecks) ? project.factChecks : [],
    versions,
    sourceSnapshot: project?.sourceSnapshot && typeof project.sourceSnapshot === 'object' ? project.sourceSnapshot : {},
    createdAt,
    updatedAt,
  };
}

function projectFromLegacyTopic(topic, now) {
  const sourceIds = Array.isArray(topic?.sourceIds) ? topic.sourceIds : [];
  const targetPlatforms = uniquePlatforms(topic?.platforms, DEFAULT_PLATFORMS);
  const project = {
    id: `project-${randomUUID()}`,
    title: String(topic?.title ?? '').trim() || '未命名创作',
    originType: sourceIds.length ? 'HOTSPOT' : 'MANUAL',
    ...(sourceIds[0] ? { originReferenceId: sourceIds[0] } : {}),
    legacyTopicId: String(topic?.id ?? ''),
    stage: 'PLANNING',
    status: 'BRIEF',
    planning: planningDraft({
      title: topic?.title,
      category: topic?.category,
      angle: topic?.analysisSnapshot?.reason,
      targetAudience: topic?.targetAudience,
      coreMessage: topic?.coreViewpoint,
      targetPlatforms,
      timing: topic?.analysisSnapshot?.timingWindow ?? timingForUrgency(topic?.urgency),
      plannedPublishAt: topic?.plannedDate,
      sourceRequirements: (topic?.factsToVerify ?? []).join('；'),
    }),
    planningVersion: 0,
    coreViewpoint: String(topic?.coreViewpoint ?? ''),
    factChecks: Array.isArray(topic?.factsToVerify) ? topic.factsToVerify : [],
    versions: [],
    sourceSnapshot: sourceIds.length ? { intelligenceIds: sourceIds, analysis: topic?.analysisSnapshot ?? null } : {},
    createdAt: now,
    updatedAt: now,
  };
  return normalizeProject(project, now);
}

function mergeTopicIntoProject(project, topic, now) {
  const sourceIds = Array.isArray(topic?.sourceIds) ? topic.sourceIds : [];
  const planning = planningDraft({
    ...project.planning,
    category: project.planning.category || topic?.category,
    angle: project.planning.angle || topic?.analysisSnapshot?.reason,
    targetAudience: project.planning.targetAudience || topic?.targetAudience,
    coreMessage: project.planning.coreMessage || topic?.coreViewpoint,
    targetPlatforms: project.planning.targetPlatforms.length ? project.planning.targetPlatforms : topic?.platforms,
    timing: project.planning.timing === 'EVERGREEN' ? (topic?.analysisSnapshot?.timingWindow ?? timingForUrgency(topic?.urgency)) : project.planning.timing,
    sourceRequirements: project.planning.sourceRequirements || (topic?.factsToVerify ?? []).join('；'),
  });
  return normalizeProject({
    ...project,
    originType: sourceIds.length ? 'HOTSPOT' : project.originType,
    originReferenceId: project.originReferenceId ?? sourceIds[0],
    legacyTopicId: project.legacyTopicId ?? topic?.id,
    planning,
    factChecks: project.factChecks.length ? project.factChecks : (topic?.factsToVerify ?? []),
    sourceSnapshot: Object.keys(project.sourceSnapshot ?? {}).length ? project.sourceSnapshot : { intelligenceIds: sourceIds, analysis: topic?.analysisSnapshot ?? null },
  }, now);
}

function migrateLegacyCreativeState(state = {}, now = new Date().toISOString()) {
  const normalizedNow = stableTimestamp(now, new Date().toISOString());
  const topics = Array.isArray(state?.topics) ? state.topics : [];
  const projects = (Array.isArray(state?.projects) ? state.projects : []).map((project) => normalizeProject(project, normalizedNow));

  for (const topic of topics) {
    const matchIndex = projects.findIndex((project) => project.legacyTopicId === topic.id || (topic.status === 'PROJECT_CREATED' && project.title === topic.title));
    if (matchIndex >= 0) projects[matchIndex] = mergeTopicIntoProject(projects[matchIndex], topic, normalizedNow);
    else projects.push(projectFromLegacyTopic(topic, normalizedNow));
  }

  const { topics: _topics, ...rest } = state ?? {};
  return { ...rest, projects };
}

function createBlankProject(input = {}, now = new Date().toISOString()) {
  const timestamp = stableTimestamp(now, new Date().toISOString());
  const originType = ['MANUAL', 'DRAFT', 'IMPORT'].includes(input.originType) ? input.originType : 'MANUAL';
  const title = String(input.title ?? '').trim() || (originType === 'DRAFT' ? '未命名草稿' : originType === 'IMPORT' ? '未命名导入内容' : '未命名创作');
  return normalizeProject({
    id: `project-${randomUUID()}`,
    title,
    originType,
    stage: 'PLANNING',
    status: 'BRIEF',
    planning: planningDraft({
      title,
      category: input.category,
      targetPlatforms: input.targetPlatforms,
    }),
    planningVersion: 0,
    coreViewpoint: '',
    factChecks: [],
    versions: [],
    sourceSnapshot: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  }, timestamp);
}

function createProjectFromIntelligence(item, analysis, angleIndex = 0, now = new Date().toISOString()) {
  const timestamp = stableTimestamp(now, new Date().toISOString());
  const angle = analysis?.angles?.[angleIndex];
  const title = String(angle?.title ?? item?.title ?? '').trim() || '未命名热点创作';
  return normalizeProject({
    id: `project-${randomUUID()}`,
    title,
    originType: 'HOTSPOT',
    originReferenceId: String(item?.id ?? ''),
    stage: 'PLANNING',
    status: 'BRIEF',
    planning: planningDraft({
      title,
      category: item?.category,
      angle: analysis?.decisionReason,
      targetAudience: angle?.targetAudience,
      coreMessage: angle?.coreViewpoint ?? item?.summary,
      targetPlatforms: ['WECHAT'],
      timing: analysis?.timingWindow,
      sourceRequirements: (analysis?.factsToVerify ?? []).join('；'),
    }),
    planningVersion: 0,
    coreViewpoint: String(angle?.coreViewpoint ?? item?.summary ?? ''),
    factChecks: Array.isArray(analysis?.factsToVerify) ? analysis.factsToVerify : [],
    versions: [],
    sourceSnapshot: { intelligence: item, analysis: analysis ?? null, angleIndex },
    createdAt: timestamp,
    updatedAt: timestamp,
  }, timestamp);
}

async function loadCreativeState(client, workspaceId, now = new Date().toISOString()) {
  const snapshot = await client.query(
    'SELECT state_json FROM workspace_snapshots WHERE workspace_id = $1',
    [workspaceId],
  );
  const projectRows = await client.query(
    'SELECT project_json FROM content_projects WHERE workspace_id = $1 ORDER BY position, updated_at DESC',
    [workspaceId],
  );
  const base = migrateLegacyCreativeState(snapshot.rows[0]?.state_json ?? {}, now);
  return { ...base, projects: projectRows.rows.filter((row) => !row.project_json?.archivedAt).map((row) => normalizeProject(row.project_json, now)) };
}

async function lockedCreativeState(client, workspaceId, now) {
  const snapshot = await client.query(
    'SELECT state_json FROM workspace_snapshots WHERE workspace_id = $1 FOR UPDATE',
    [workspaceId],
  );
  if (!snapshot.rowCount) throw new Error('工作空间状态不存在。');
  const projectRows = await client.query(
    'SELECT project_json, position FROM content_projects WHERE workspace_id = $1 ORDER BY position, updated_at DESC FOR UPDATE',
    [workspaceId],
  );
  const base = migrateLegacyCreativeState(snapshot.rows[0].state_json ?? {}, now);
  return {
    state: { ...base, projects: projectRows.rows.filter((row) => !row.project_json?.archivedAt).map((row) => normalizeProject(row.project_json, now)) },
    positions: new Map(projectRows.rows.filter((row) => !row.project_json?.archivedAt).map((row) => [String(row.project_json.id), Number(row.position)])),
  };
}

async function updateCreativeProjects(client, workspaceId, mutate, now = new Date().toISOString()) {
  const locked = await lockedCreativeState(client, workspaceId, now);
  const current = locked.state;
  const next = await mutate(current);
  if (!next || !Array.isArray(next.projects)) throw new Error('项目状态更新结果无效。');
  const normalizedProjects = next.projects.map((project) => normalizeProject(project, now));
  const currentById = new Map(current.projects.map((project) => [project.id, project]));
  const currentIds = new Set(currentById.keys());
  const nextIds = normalizedProjects.map((project) => project.id);
  if (new Set(nextIds).size !== nextIds.length) throw new Error('项目状态包含重复 ID。');
  const missingIds = [...currentIds].filter((id) => !nextIds.includes(id));
  if (missingIds.length) throw new Error('禁止通过状态更新删除项目。');

  for (const [position, normalized] of normalizedProjects.entries()) {
    const currentProject = currentById.get(normalized.id);
    const projectChanged = !currentProject || JSON.stringify(currentProject) !== JSON.stringify(normalized);
    const positionChanged = locked.positions.get(normalized.id) !== position;
    if (!projectChanged && !positionChanged) continue;
    if (!projectChanged) {
      await client.query(
        'UPDATE content_projects SET position = $3 WHERE workspace_id = $1 AND project_id = $2',
        [workspaceId, normalized.id, position],
      );
      continue;
    }
    await client.query(
      `INSERT INTO content_projects (workspace_id, project_id, project_json, position, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (workspace_id, project_id) DO UPDATE SET
          project_json = excluded.project_json,
          position = excluded.position,
          revision = content_projects.revision + CASE
            WHEN content_projects.project_json IS DISTINCT FROM excluded.project_json THEN 1
            ELSE 0
          END,
          updated_at = excluded.updated_at`,
      [workspaceId, normalized.id, JSON.stringify(normalized), position, normalized.createdAt, normalized.updatedAt],
    );
    if (normalized.legacyTopicId) {
      await client.query(
        `INSERT INTO legacy_topic_project_mappings (workspace_id, legacy_topic_id, project_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (workspace_id, legacy_topic_id) DO UPDATE SET project_id = excluded.project_id`,
        [workspaceId, normalized.legacyTopicId, normalized.id],
      );
    }
  }
  return { ...current, ...next, projects: normalizedProjects };
}

async function saveWorkspacePreferences(client, workspaceId, patch) {
  const result = await client.query(
    'SELECT state_json FROM workspace_snapshots WHERE workspace_id = $1 FOR UPDATE',
    [workspaceId],
  );
  if (!result.rowCount) throw new Error('工作空间状态不存在。');
  const current = result.rows[0].state_json ?? {};
  const preferences = {
    ...(current.workspace ? { workspace: current.workspace } : {}),
    ...(current.feishuTemplate ? { feishuTemplate: current.feishuTemplate } : {}),
    ...(patch.workspace ? { workspace: patch.workspace } : {}),
    ...(patch.feishuTemplate ? { feishuTemplate: patch.feishuTemplate } : {}),
  };
  const updated = await client.query(
    `UPDATE workspace_snapshots
      SET state_json = $2, revision = revision + 1, updated_at = now()
      WHERE workspace_id = $1 AND state_json IS DISTINCT FROM $2::jsonb
      RETURNING revision, updated_at`,
    [workspaceId, JSON.stringify(preferences)],
  );
  if (updated.rowCount) return updated.rows[0];
  const unchanged = await client.query(
    'SELECT revision, updated_at FROM workspace_snapshots WHERE workspace_id = $1',
    [workspaceId],
  );
  return unchanged.rows[0];
}

function saveProjectPlanning(project, input, now = new Date().toISOString()) {
  const timestamp = stableTimestamp(now, new Date().toISOString());
  const nextPlanning = planningWithDefaults(input);
  return normalizeProject({
    ...project,
    title: nextPlanning.title || project.title,
    planning: nextPlanning,
    coreViewpoint: nextPlanning.coreMessage,
    updatedAt: timestamp,
  }, timestamp);
}

function validatePlanningForConfirmation(value) {
  const required = [
    ['title', '选题标题'],
    ['angle', '创作角度'],
    ['objective', '创作目标'],
    ['targetAudience', '目标受众'],
    ['coreMessage', '核心表达'],
  ];
  for (const [field, label] of required) {
    if (!String(value?.[field] ?? '').trim()) throw new Error(`请先填写${label}。`);
  }
  if (!Array.isArray(value?.targetPlatforms) || value.targetPlatforms.length === 0) throw new Error('请至少选择一个目标平台。');
}

function confirmProjectPlanning(project, input, now = new Date().toISOString()) {
  const timestamp = stableTimestamp(now, new Date().toISOString());
  const saved = saveProjectPlanning(project, input, timestamp);
  validatePlanningForConfirmation(saved.planning);
  const titleText = saved.planning.title.replace(/[\s\p{P}\p{S}]/gu, '');
  const unsafeTitle = saved.factChecks.some((fact) => {
    const claim = String(fact ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
    return titleText.length >= 12 && claim.length >= 12 && (titleText.includes(claim) || claim.includes(titleText));
  });
  if (unsafeTitle) throw new Error('规划标题包含待核验主张，请先改成问题导向或完成事实核验。');
  const versions = [...saved.versions];
  for (const platform of saved.planning.targetPlatforms) {
    if (versions.some((version) => version.platform === platform)) continue;
    versions.push({
      id: `${saved.id}-${platform.toLowerCase()}-${randomUUID()}`,
      platform,
      status: 'DRAFT',
      title: saved.planning.title,
      body: '',
      updatedAt: timestamp,
    });
  }
  const requestedChecks = saved.planning.sourceRequirements
    .split(/[；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return normalizeProject({
    ...saved,
    title: saved.planning.title,
    stage: 'RESEARCH',
    planningVersion: saved.planningVersion + 1,
    planningConfirmedAt: timestamp,
    coreViewpoint: saved.planning.coreMessage,
    factChecks: saved.factChecks.length ? saved.factChecks : requestedChecks,
    versions,
    updatedAt: timestamp,
  }, timestamp);
}

async function writePlanningVersion(client, input) {
  const latest = await client.query(
    `SELECT id, version_number, status, planning_json, created_at, confirmed_at
      FROM project_planning_versions
      WHERE workspace_id = $1 AND project_id = $2
      ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, input.projectId],
  );
  const previous = latest.rows[0];
  if (previous && previous.status === input.status && JSON.stringify(previous.planning_json) === JSON.stringify(input.planning)) return previous;
  const versionNumber = Number(previous?.version_number ?? 0) + 1;
  const inserted = await client.query(
    `INSERT INTO project_planning_versions
      (workspace_id, project_id, version_number, status, planning_json, source_snapshot_json, confirmed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, version_number, status, planning_json, created_at, confirmed_at`,
    [
      input.workspaceId,
      input.projectId,
      versionNumber,
      input.status,
      JSON.stringify(input.planning),
      JSON.stringify(input.sourceSnapshot ?? {}),
      input.status === 'CONFIRMED' ? (input.confirmedAt ?? new Date().toISOString()) : null,
    ],
  );
  return inserted.rows[0];
}

module.exports = {
  confirmProjectPlanning,
  createBlankProject,
  createProjectFromIntelligence,
  mapProjectStatusToStage,
  migrateLegacyCreativeState,
  normalizeProject,
  planningDraft,
  planningWithDefaults,
  saveProjectPlanning,
  saveWorkspacePreferences,
  loadCreativeState,
  updateCreativeProjects,
  validatePlanningForConfirmation,
  writePlanningVersion,
};
