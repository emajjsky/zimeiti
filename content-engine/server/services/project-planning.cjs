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
      coreMessage: originType === 'DRAFT' ? input.draftText : '',
      targetPlatforms: input.targetPlatforms,
    }),
    planningVersion: 0,
    coreViewpoint: '',
    factChecks: [],
    versions: [],
    sourceSnapshot: {
      ...(input.draftText ? { draftText: String(input.draftText) } : {}),
      ...(input.importUrl ? { importUrl: String(input.importUrl) } : {}),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }, timestamp);
}

function createProjectFromIntelligence(item, analysis, angleIndex = 0, now = new Date().toISOString()) {
  const timestamp = stableTimestamp(now, new Date().toISOString());
  const angle = analysis?.angles?.[angleIndex];
  const title = String(angle?.title ?? item?.title ?? '').trim() || '未命名热点创作';
  const platforms = uniquePlatforms(analysis?.selectedPlatforms, DEFAULT_PLATFORMS);
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
      targetPlatforms: platforms,
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

module.exports = {
  createBlankProject,
  createProjectFromIntelligence,
  mapProjectStatusToStage,
  migrateLegacyCreativeState,
  normalizeProject,
  planningDraft,
};
