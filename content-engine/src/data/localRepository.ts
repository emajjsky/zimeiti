import { projectStageForLegacyStatus, type ContentProject, type IntelligenceItem, type IntelligenceSource, type Platform, type ProjectPlanning, type TopicCandidate } from '../domain/content';
import { webIntelligence, webState } from './webApi';

const key = 'content-engine-prototype-v1';

export interface LocalState {
  workspace: WorkspaceProfile;
  feishuTemplate: FeishuLibraryTemplate;
  sources: IntelligenceSource[];
  intelligence: IntelligenceItem[];
  topics: TopicCandidate[];
  projects: ContentProject[];
}

export interface WorkspaceProfile {
  name: string;
  materialRoot: string;
  primaryTopics: string[];
  accountPositioning?: string;
  targetAudience?: string;
  enabledPlatforms: Platform[];
  setupCompleted: boolean;
}

export interface FeishuLibraryTemplate {
  name: string;
  topicStorage: 'ONE_TABLE' | 'BY_CATEGORY';
  includeSchedule: boolean;
  includeReview: boolean;
  status: 'DRAFT' | 'READY_TO_CREATE' | 'CREATED';
}

export const seedState: LocalState = {
  workspace: {
    name: '我的内容工作室',
    materialRoot: '',
    primaryTopics: ['AI 工具实战'],
    accountPositioning: '',
    targetAudience: '',
    enabledPlatforms: ['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO', 'VIDEO_CHANNEL'],
    setupCompleted: false,
  },
  feishuTemplate: {
    name: '内容引擎内容库',
    topicStorage: 'ONE_TABLE',
    includeSchedule: true,
    includeReview: false,
    status: 'DRAFT',
  },
  sources: [],
  intelligence: [],
  topics: [],
  projects: [],
};

export async function loadState(): Promise<LocalState> {
  if (window.localStorage.getItem('content-engine-web-session-v1')) {
    const result = await webState.load();
    const [sources, intelligence] = await Promise.all([webIntelligence.listSources(), webIntelligence.listItems()]);
    return normalizeState({ ...result.state, sources, intelligence });
  }

  // 仅用于早期原型数据迁移；正式 Web 数据以服务端工作空间为准。
  const value = window.localStorage.getItem(key);
  if (!value) return seedState;
  try { return normalizeState(JSON.parse(value) as LocalState); } catch { return seedState; }
}

function normalizeState(state: LocalState): LocalState {
  const intelligence = dedupeIntelligence((state.intelligence ?? []).map((item) => ({ ...item, title: normalizeText(item.title), summary: normalizeText(item.summary) })));
  const normalizedProjects = (state.projects ?? []).map(normalizeProject);
  const topics = state.topics ?? [];
  for (const topic of topics) {
    const existingIndex = normalizedProjects.findIndex((project) => project.legacyTopicId === topic.id || (topic.status === 'PROJECT_CREATED' && project.title === topic.title));
    if (existingIndex >= 0) normalizedProjects[existingIndex] = mergeTopicProject(normalizedProjects[existingIndex], topic);
    else normalizedProjects.push(projectFromTopic(topic));
  }
  return {
    ...state,
    workspace: {
      ...seedState.workspace,
      ...state.workspace,
      primaryTopics: state.workspace?.primaryTopics ?? seedState.workspace.primaryTopics,
      enabledPlatforms: state.workspace?.enabledPlatforms ?? seedState.workspace.enabledPlatforms,
      setupCompleted: state.workspace?.setupCompleted ?? false,
    },
    feishuTemplate: { ...seedState.feishuTemplate, ...state.feishuTemplate },
    sources: state.sources ?? [],
    intelligence,
    topics: [],
    projects: normalizedProjects,
  };
}

function timestamp(value?: string) {
  if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function projectId() {
  return `project-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function planning(input: Partial<ProjectPlanning> & Pick<ProjectPlanning, 'title'>): ProjectPlanning {
  return {
    title: input.title.trim(),
    category: input.category?.trim() ?? '',
    angle: input.angle?.trim() ?? '',
    objective: input.objective?.trim() ?? '',
    targetAudience: input.targetAudience?.trim() ?? '',
    coreMessage: input.coreMessage?.trim() ?? '',
    targetPlatforms: [...new Set(input.targetPlatforms ?? [])],
    timing: input.timing ?? 'EVERGREEN',
    ...(input.plannedPublishAt ? { plannedPublishAt: input.plannedPublishAt } : {}),
    sourceRequirements: input.sourceRequirements?.trim() ?? '',
    constraints: input.constraints?.trim() ?? '',
  };
}

function normalizeProject(project: ContentProject): ContentProject {
  const createdAt = timestamp(project.createdAt ?? project.updatedAt);
  const nextPlanning = planning({
    title: project.planning?.title ?? project.title,
    category: project.planning?.category,
    angle: project.planning?.angle,
    objective: project.planning?.objective,
    targetAudience: project.planning?.targetAudience,
    coreMessage: project.planning?.coreMessage ?? project.coreViewpoint,
    targetPlatforms: project.planning?.targetPlatforms ?? project.versions.map((version) => version.platform),
    timing: project.planning?.timing,
    plannedPublishAt: project.planning?.plannedPublishAt,
    sourceRequirements: project.planning?.sourceRequirements ?? project.factChecks.join('；'),
    constraints: project.planning?.constraints,
  });
  return {
    ...project,
    title: nextPlanning.title || '未命名创作',
    originType: project.originType ?? 'LEGACY',
    stage: project.stage ?? projectStageForLegacyStatus(project.status),
    planning: nextPlanning,
    planningVersion: project.planningVersion ?? (project.planningConfirmedAt ? 1 : 0),
    sourceSnapshot: project.sourceSnapshot ?? {},
    createdAt,
    updatedAt: timestamp(project.updatedAt ?? createdAt),
  };
}

function projectFromTopic(topic: TopicCandidate): ContentProject {
  const now = new Date().toISOString();
  return normalizeProject({
    id: projectId(),
    title: topic.title,
    originType: topic.sourceIds.length ? 'HOTSPOT' : 'MANUAL',
    originReferenceId: topic.sourceIds[0],
    legacyTopicId: topic.id,
    stage: 'PLANNING',
    status: 'BRIEF',
    planning: planning({
      title: topic.title,
      category: topic.category,
      angle: topic.analysisSnapshot?.reason,
      targetAudience: topic.targetAudience,
      coreMessage: topic.coreViewpoint,
      targetPlatforms: topic.platforms,
      timing: topic.analysisSnapshot?.timingWindow ?? (topic.urgency === '高' ? 'TODAY' : topic.urgency === '中' ? 'ONE_WEEK' : 'EVERGREEN'),
      plannedPublishAt: topic.plannedDate,
      sourceRequirements: (topic.factsToVerify ?? []).join('；'),
    }),
    planningVersion: 0,
    coreViewpoint: topic.coreViewpoint,
    factChecks: topic.factsToVerify ?? [],
    versions: [],
    sourceSnapshot: topic.sourceIds.length ? { intelligenceIds: topic.sourceIds, analysis: topic.analysisSnapshot ?? null } : {},
    createdAt: now,
    updatedAt: now,
  });
}

function mergeTopicProject(project: ContentProject, topic: TopicCandidate): ContentProject {
  return normalizeProject({
    ...project,
    originType: topic.sourceIds.length ? 'HOTSPOT' : project.originType,
    originReferenceId: project.originReferenceId ?? topic.sourceIds[0],
    legacyTopicId: project.legacyTopicId ?? topic.id,
    planning: planning({
      ...project.planning,
      category: project.planning.category || topic.category,
      angle: project.planning.angle || topic.analysisSnapshot?.reason,
      targetAudience: project.planning.targetAudience || topic.targetAudience,
      coreMessage: project.planning.coreMessage || topic.coreViewpoint,
      targetPlatforms: project.planning.targetPlatforms.length ? project.planning.targetPlatforms : topic.platforms,
      sourceRequirements: project.planning.sourceRequirements || (topic.factsToVerify ?? []).join('；'),
    }),
  });
}

export function intelligenceKey(item: Pick<IntelligenceItem, 'title' | 'source'>) {
  return `${item.source.trim().toLocaleLowerCase()}::${normalizeText(item.title).toLocaleLowerCase()}`;
}

function dedupeIntelligence(items: IntelligenceItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = intelligenceKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);?/gi, (_match, entity) => {
    const raw = String(entity);
    const code = raw.toLowerCase().startsWith('x') ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
  }).replace(/&(amp|quot|apos|lt|gt);/gi, (_match, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[String(entity).toLowerCase()] ?? _match).replace(/\s+/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/'\s+/g, "'").trim();
}
